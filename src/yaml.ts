/**
 * A small YAML parser for the subset that Typed Markdown frontmatter needs.
 *
 * Supported: block mappings (any nesting), block sequences, flow mappings,
 * flow sequences, single and double quoted strings, plain scalars, integers,
 * floats, booleans, null, comments and blank lines.
 *
 * Not supported, and reported as a clear error instead of being mis-parsed:
 * block scalars (`|` and `>`), anchors and aliases (`&`, `*`), merge keys
 * (`<<`), tags (`!`), explicit keys (`?`), multiple documents, and flow
 * collections that span more than one line.
 *
 * Every mapping key and every sequence item gets a line number, keyed by its
 * dotted path (`specs.power.value`, `owners.0`), so the linter can point at
 * the line that is wrong.
 */

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "YamlError";
    this.line = line;
  }
}

export interface YamlParseResult {
  /** The parsed document. */
  value: YamlValue;
  /** Dotted path to 1-based line number. */
  lines: Map<string, number>;
}

interface PhysicalLine {
  n: number;
  indent: number;
  content: string;
}

const UNSUPPORTED: Array<{ test: RegExp; message: string }> = [
  { test: /^[|>][-+]?\d*\s*$/, message: "block scalars (| and >) are not supported" },
  { test: /^&\S/, message: "anchors (&name) are not supported" },
  { test: /^\*\S/, message: "aliases (*name) are not supported" },
  { test: /^!!?\S/, message: "tags (!type) are not supported" },
];

/** Remove a trailing `# comment`, honouring quotes. */
export function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && raw[i + 1] === "'") i++;
      else if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function significantLines(text: string, startLine: number): PhysicalLine[] {
  const out: PhysicalLine[] = [];
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!.replace(/\r$/, "");
    const n = startLine + i;
    const trimmedStart = raw.replace(/^[ \t]*/, "");
    const indentText = raw.slice(0, raw.length - trimmedStart.length);
    if (indentText.includes("\t")) {
      if (trimmedStart !== "") throw new YamlError("tabs cannot be used to indent YAML, use spaces", n);
      continue;
    }
    const content = stripComment(trimmedStart).trimEnd();
    if (content === "") continue;
    if (content === "---" || content === "...") {
      throw new YamlError("multiple YAML documents are not supported", n);
    }
    if (content.startsWith("? ")) {
      throw new YamlError("explicit keys (? key) are not supported", n);
    }
    out.push({ n, indent: indentText.length, content });
  }
  return out;
}

function unquoteDouble(raw: string, line: number): string {
  let out = "";
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "0": out += "\0"; break;
      case '"': out += '"'; break;
      case "\\": out += "\\"; break;
      case "/": out += "/"; break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new YamlError(`bad \\u escape in double quoted string`, line);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        throw new YamlError(`unknown escape "\\${next ?? ""}" in double quoted string`, line);
    }
  }
  return out;
}

/** Turn a plain (unquoted) scalar into a JS value. */
export function plainScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (/^[-+]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
    return s;
  }
  if (/^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)$/.test(s) || /^[-+]?(?:\d+\.\d*|\.\d+)$/.test(s)) {
    return Number(s);
  }
  return s;
}

class Parser {
  private readonly lines: PhysicalLine[];
  private i = 0;
  readonly positions = new Map<string, number>();

  constructor(lines: PhysicalLine[]) {
    this.lines = lines;
  }

  parseDocument(): YamlValue {
    if (this.lines.length === 0) return {};
    const first = this.lines[0]!;
    const value = this.parseNode(first.indent, "");
    if (this.i < this.lines.length) {
      throw new YamlError("unexpected indentation", this.lines[this.i]!.n);
    }
    return value;
  }

  private at(): PhysicalLine | undefined {
    return this.lines[this.i];
  }

  private parseNode(indent: number, path: string): YamlValue {
    const line = this.at();
    if (!line) return null;
    if (line.content === "-" || line.content.startsWith("- ")) return this.parseSequence(indent, path);
    return this.parseMapping(indent, path);
  }

  private parseMapping(indent: number, path: string): YamlValue {
    const obj: { [key: string]: YamlValue } = {};
    while (this.i < this.lines.length) {
      const line = this.at()!;
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamlError("unexpected indentation", line.n);
      if (line.content === "-" || line.content.startsWith("- ")) break;
      const { key, rest } = this.splitKey(line);
      if (Object.hasOwn(obj, key)) throw new YamlError(`duplicate key "${key}"`, line.n);
      const childPath = path === "" ? key : `${path}.${key}`;
      this.positions.set(childPath, line.n);
      this.i++;
      if (rest === "") {
        const next = this.at();
        if (next && next.indent > indent) {
          obj[key] = this.parseNode(next.indent, childPath);
        } else if (next && next.indent === indent && (next.content === "-" || next.content.startsWith("- "))) {
          obj[key] = this.parseSequence(indent, childPath);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = this.parseInline(rest, line.n, childPath);
      }
    }
    return obj;
  }

  private parseSequence(indent: number, path: string): YamlValue {
    const arr: YamlValue[] = [];
    while (this.i < this.lines.length) {
      const line = this.at()!;
      if (line.indent !== indent) break;
      if (line.content !== "-" && !line.content.startsWith("- ")) break;
      const childPath = `${path}.${arr.length}`;
      this.positions.set(childPath, line.n);
      if (line.content === "-") {
        this.i++;
        const next = this.at();
        if (next && next.indent > indent) arr.push(this.parseNode(next.indent, childPath));
        else arr.push(null);
        continue;
      }
      const afterDash = line.content.slice(1);
      const lead = afterDash.length - afterDash.replace(/^ +/, "").length;
      const itemIndent = indent + 1 + lead;
      const rest = afterDash.slice(lead);
      if (rest === "-" || rest.startsWith("- ")) {
        this.lines[this.i] = { n: line.n, indent: itemIndent, content: rest };
        arr.push(this.parseSequence(itemIndent, childPath));
        continue;
      }
      if (this.looksLikeKey(rest)) {
        this.lines[this.i] = { n: line.n, indent: itemIndent, content: rest };
        arr.push(this.parseMapping(itemIndent, childPath));
        continue;
      }
      this.i++;
      arr.push(this.parseInline(rest, line.n, childPath));
    }
    return arr;
  }

  /** Does this text start a `key: value` pair outside of quotes and flow markers? */
  private looksLikeKey(text: string): boolean {
    try {
      this.findColon(text);
      return true;
    } catch {
      return false;
    }
  }

  private findColon(text: string): number {
    if (text.startsWith("{") || text.startsWith("[")) throw new Error("flow");
    let i = 0;
    if (text[0] === '"' || text[0] === "'") {
      const quote = text[0]!;
      i = 1;
      while (i < text.length) {
        const ch = text[i]!;
        if (quote === '"' && ch === "\\") i += 2;
        else if (ch === quote && !(quote === "'" && text[i + 1] === "'")) break;
        else if (ch === quote) i += 2;
        else i++;
      }
      i++;
      if (text[i] === ":" && (i + 1 === text.length || text[i + 1] === " ")) return i;
      throw new Error("no colon");
    }
    for (; i < text.length; i++) {
      if (text[i] === ":" && (i + 1 === text.length || text[i + 1] === " ")) return i;
    }
    throw new Error("no colon");
  }

  private splitKey(line: PhysicalLine): { key: string; rest: string } {
    let colon: number;
    try {
      colon = this.findColon(line.content);
    } catch {
      throw new YamlError(`expected "key: value", found "${line.content}"`, line.n);
    }
    const rawKey = line.content.slice(0, colon).trim();
    if (rawKey === "") throw new YamlError("mapping key cannot be empty", line.n);
    if (rawKey === "<<") throw new YamlError("merge keys (<<) are not supported", line.n);
    let key: string;
    if (rawKey.startsWith('"') && rawKey.endsWith('"') && rawKey.length > 1) key = unquoteDouble(rawKey, line.n);
    else if (rawKey.startsWith("'") && rawKey.endsWith("'") && rawKey.length > 1) key = rawKey.slice(1, -1).replaceAll("''", "'");
    else key = rawKey;
    return { key, rest: line.content.slice(colon + 1).trim() };
  }

  private parseInline(text: string, lineNo: number, path: string): YamlValue {
    for (const rule of UNSUPPORTED) {
      if (rule.test.test(text)) throw new YamlError(rule.message, lineNo);
    }
    const cursor = { i: 0 };
    const value = this.parseFlowValue(text, cursor, lineNo, path, true);
    const tail = text.slice(cursor.i).trim();
    if (tail !== "") throw new YamlError(`unexpected text after value: "${tail}"`, lineNo);
    return value;
  }

  private parseFlowValue(text: string, cursor: { i: number }, lineNo: number, path: string, top: boolean): YamlValue {
    skipSpace(text, cursor);
    const ch = text[cursor.i];
    if (ch === undefined) return null;
    if (ch === "{") return this.parseFlowMapping(text, cursor, lineNo, path);
    if (ch === "[") return this.parseFlowSequence(text, cursor, lineNo, path);
    if (ch === '"' || ch === "'") return this.parseQuoted(text, cursor, lineNo);
    const start = cursor.i;
    while (cursor.i < text.length) {
      const c = text[cursor.i]!;
      if (!top && (c === "," || c === "}" || c === "]")) break;
      cursor.i++;
    }
    const raw = text.slice(start, cursor.i).trim();
    if (raw.includes(": ") || raw.endsWith(":")) {
      throw new YamlError(`unexpected ":" in value "${raw}", quote the value if it is text`, lineNo);
    }
    return plainScalar(raw);
  }

  private parseQuoted(text: string, cursor: { i: number }, lineNo: number): string {
    const quote = text[cursor.i]!;
    const start = cursor.i;
    cursor.i++;
    while (cursor.i < text.length) {
      const c = text[cursor.i]!;
      if (quote === '"' && c === "\\") {
        cursor.i += 2;
        continue;
      }
      if (c === quote) {
        if (quote === "'" && text[cursor.i + 1] === "'") {
          cursor.i += 2;
          continue;
        }
        cursor.i++;
        const raw = text.slice(start, cursor.i);
        return quote === '"' ? unquoteDouble(raw, lineNo) : raw.slice(1, -1).replaceAll("''", "'");
      }
      cursor.i++;
    }
    throw new YamlError("unterminated quoted string", lineNo);
  }

  private parseFlowMapping(text: string, cursor: { i: number }, lineNo: number, path: string): YamlValue {
    const obj: { [key: string]: YamlValue } = {};
    cursor.i++;
    skipSpace(text, cursor);
    if (text[cursor.i] === "}") {
      cursor.i++;
      return obj;
    }
    for (;;) {
      skipSpace(text, cursor);
      let key: string;
      const ch = text[cursor.i];
      if (ch === undefined) throw new YamlError("unterminated flow mapping, it must close on the same line", lineNo);
      if (ch === '"' || ch === "'") key = this.parseQuoted(text, cursor, lineNo);
      else {
        const start = cursor.i;
        while (cursor.i < text.length && text[cursor.i] !== ":") cursor.i++;
        key = text.slice(start, cursor.i).trim();
      }
      skipSpace(text, cursor);
      if (text[cursor.i] !== ":") throw new YamlError(`expected ":" after key "${key}" in flow mapping`, lineNo);
      cursor.i++;
      if (Object.hasOwn(obj, key)) throw new YamlError(`duplicate key "${key}"`, lineNo);
      const childPath = path === "" ? key : `${path}.${key}`;
      this.positions.set(childPath, lineNo);
      obj[key] = this.parseFlowValue(text, cursor, lineNo, childPath, false);
      skipSpace(text, cursor);
      const sep = text[cursor.i];
      if (sep === ",") {
        cursor.i++;
        skipSpace(text, cursor);
        if (text[cursor.i] === "}") {
          cursor.i++;
          return obj;
        }
        continue;
      }
      if (sep === "}") {
        cursor.i++;
        return obj;
      }
      throw new YamlError("unterminated flow mapping, it must close on the same line", lineNo);
    }
  }

  private parseFlowSequence(text: string, cursor: { i: number }, lineNo: number, path: string): YamlValue {
    const arr: YamlValue[] = [];
    cursor.i++;
    skipSpace(text, cursor);
    if (text[cursor.i] === "]") {
      cursor.i++;
      return arr;
    }
    for (;;) {
      const childPath = `${path}.${arr.length}`;
      this.positions.set(childPath, lineNo);
      arr.push(this.parseFlowValue(text, cursor, lineNo, childPath, false));
      skipSpace(text, cursor);
      const sep = text[cursor.i];
      if (sep === ",") {
        cursor.i++;
        skipSpace(text, cursor);
        if (text[cursor.i] === "]") {
          cursor.i++;
          return arr;
        }
        continue;
      }
      if (sep === "]") {
        cursor.i++;
        return arr;
      }
      throw new YamlError("unterminated flow sequence, it must close on the same line", lineNo);
    }
  }
}

function skipSpace(text: string, cursor: { i: number }): void {
  while (cursor.i < text.length && (text[cursor.i] === " " || text[cursor.i] === "\t")) cursor.i++;
}

/**
 * Parse a YAML document. `startLine` is the file line number of the first line
 * of `text`, so reported line numbers match the file.
 */
export function parseYaml(text: string, startLine = 1): YamlParseResult {
  const parser = new Parser(significantLines(text, startLine));
  const value = parser.parseDocument();
  return { value, lines: parser.positions };
}

/** Write a scalar the way this parser reads it back. */
export function emitScalar(value: YamlValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => emitScalar(v)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${k}: ${emitScalar(v)}`).join(", ")} }`;
  }
  if (value === "") return '""';
  const needsQuotes =
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s/.test(value) ||
    value.endsWith(":") ||
    /\s#/.test(value) ||
    /[\n\r\t]/.test(value) ||
    value !== value.trim() ||
    plainScalar(value) !== value;
  if (!needsQuotes) return value;
  return JSON.stringify(value);
}

/** Write a value as YAML block style, used by `tmd new` and `--fix`. */
export function emitYaml(value: YamlValue, indent = 0): string {
  const pad = " ".repeat(indent);
  if (value === null || typeof value !== "object") return `${pad}${emitScalar(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    let out = "";
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length > 0) {
        const block = emitYaml(item, indent + 2);
        out += `${pad}-${block.slice(indent + 1)}`;
      } else {
        out += `${pad}- ${emitScalar(item)}\n`;
      }
    }
    return out;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return `${pad}{}\n`;
  let out = "";
  for (const [key, val] of entries) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length > 0) {
      out += `${pad}${key}:\n${emitYaml(val, indent + 2)}`;
    } else if (Array.isArray(val) && val.some((v) => v !== null && typeof v === "object")) {
      out += `${pad}${key}:\n${emitYaml(val, indent)}`;
    } else {
      out += `${pad}${key}: ${emitScalar(val)}\n`;
    }
  }
  return out;
}
