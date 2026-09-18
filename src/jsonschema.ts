/**
 * A JSON Schema (draft 2020-12) validator, limited to the keywords Typed
 * Markdown needs. Supported keywords are listed in SUPPORTED_KEYWORDS.
 * Anything else is ignored on purpose, see the README.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { [key: string]: Json };

export const SUPPORTED_KEYWORDS = [
  "type",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "prefixItems",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "format",
  "$defs",
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
] as const;

/** Keywords we read but never validate against. */
export const ANNOTATION_KEYWORDS = [
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
] as const;

export interface ValidationIssue {
  /** `required` is reported as E002, everything else as E003. */
  kind: "required" | "other";
  /** Instance path segments, `[]` is the root object. */
  path: (string | number)[];
  /** The field the problem is about, when there is one. */
  field: string | null;
  message: string;
  hint: string | null;
}

export interface RefSite {
  path: (string | number)[];
  field: string;
  value: string;
  /** Allowed target types from `x-tmd-ref`, undefined means any type. */
  allowed: string[] | undefined;
  allowSelf: boolean;
  description: string | null;
}

export interface DeprecatedSite {
  path: (string | number)[];
  field: string;
  date: string;
}

export interface ValidateResult {
  issues: ValidationIssue[];
  refs: RefSite[];
  deprecated: DeprecatedSite[];
}

const FORMATS: { [name: string]: RegExp } = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:\S*$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
};

export function pathToField(path: (string | number)[]): string | null {
  if (path.length === 0) return null;
  return path.map((p) => String(p)).join(".");
}

export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (typeof value === "object") return "object";
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  return `${typeof value} ${String(value)}`;
}

export function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

function asSchema(value: Json | undefined): Schema | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Schema;
  return null;
}

function str(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: Json | undefined): number | null {
  return typeof value === "number" ? value : null;
}

/** Resolve a local `#/...` JSON pointer inside the root schema. */
export function resolvePointer(root: Schema, ref: string): Schema | null {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return null;
  let node: Json = root;
  for (const rawPart of ref.slice(2).split("/")) {
    const part = decodeURIComponent(rawPart).replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object" || Array.isArray(node)) return null;
    const next: Json | undefined = (node as { [key: string]: Json })[part];
    if (next === undefined) return null;
    node = next;
  }
  return asSchema(node);
}

/** The `x-tmd` block of a schema, if any. */
export function xTmd(schema: Schema): { [key: string]: Json } {
  const block = asSchema(schema["x-tmd"]);
  return block ?? {};
}

function deprecationDate(schema: Schema): string | null {
  const direct = str(schema["x-tmd-deprecated"]);
  if (direct) return direct;
  const block = xTmd(schema);
  return str(block["deprecated"]);
}

class Validator {
  private readonly root: Schema;
  issues: ValidationIssue[] = [];
  refs: RefSite[] = [];
  deprecated: DeprecatedSite[] = [];

  constructor(root: Schema) {
    this.root = root;
  }

  private add(issue: ValidationIssue): void {
    this.issues.push(issue);
  }

  private deref(schema: Schema): Schema {
    let current = schema;
    for (let hops = 0; hops < 16; hops++) {
      const ref = str(current["$ref"]);
      if (ref === null) return current;
      const target = resolvePointer(this.root, ref);
      if (target === null) {
        this.add({
          kind: "other",
          path: [],
          field: null,
          message: `schema reference "${ref}" cannot be resolved`,
          hint: "only local references like #/$defs/name are supported",
        });
        return {};
      }
      const { $ref: _drop, ...rest } = current;
      current = { ...target, ...rest };
    }
    return current;
  }

  validate(schema: Schema, value: Json, path: (string | number)[]): void {
    const node = this.deref(schema);
    const field = pathToField(path);

    const typeKeyword = node["type"];
    if (typeKeyword !== undefined) {
      const types = Array.isArray(typeKeyword) ? typeKeyword.map((t) => String(t)) : [String(typeKeyword)];
      if (!types.some((t) => matchesType(value, t))) {
        this.add({
          kind: "other",
          path,
          field,
          message: `expected ${types.join(" or ")}, got ${describe(value)}`,
          hint: this.fieldHint(node),
        });
        return;
      }
    }

    if (node["const"] !== undefined && !deepEqual(value, node["const"])) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected the constant ${JSON.stringify(node["const"])}, got ${describe(value)}`,
        hint: this.fieldHint(node),
      });
    }

    const enumValues = node["enum"];
    if (Array.isArray(enumValues) && !enumValues.some((allowed) => deepEqual(value, allowed))) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected one of ${enumValues.map((v) => JSON.stringify(v)).join(", ")}, got ${describe(value)}`,
        hint: this.fieldHint(node),
      });
    }

    if (typeof value === "number") this.validateNumber(node, value, path, field);
    if (typeof value === "string") this.validateString(node, value, path, field);
    if (Array.isArray(value)) this.validateArray(node, value, path);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      this.validateObject(node, value as { [key: string]: Json }, path);
    }

    this.validateCombinators(node, value, path, field);
  }

  private fieldHint(node: Schema): string | null {
    const description = str(node["description"]);
    return description === null ? null : description;
  }

  private validateNumber(node: Schema, value: number, path: (string | number)[], field: string | null): void {
    const min = num(node["minimum"]);
    if (min !== null && value < min) {
      this.add({ kind: "other", path, field, message: `expected a value >= ${min}, got ${value}`, hint: this.fieldHint(node) });
    }
    const max = num(node["maximum"]);
    if (max !== null && value > max) {
      this.add({ kind: "other", path, field, message: `expected a value <= ${max}, got ${value}`, hint: this.fieldHint(node) });
    }
    const exMin = num(node["exclusiveMinimum"]);
    if (exMin !== null && value <= exMin) {
      this.add({ kind: "other", path, field, message: `expected a value > ${exMin}, got ${value}`, hint: this.fieldHint(node) });
    }
    const exMax = num(node["exclusiveMaximum"]);
    if (exMax !== null && value >= exMax) {
      this.add({ kind: "other", path, field, message: `expected a value < ${exMax}, got ${value}`, hint: this.fieldHint(node) });
    }
  }

  private validateString(node: Schema, value: string, path: (string | number)[], field: string | null): void {
    const minLength = num(node["minLength"]);
    if (minLength !== null && [...value].length < minLength) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected at least ${minLength} character${minLength === 1 ? "" : "s"}, got ${[...value].length}`,
        hint: this.fieldHint(node),
      });
    }
    const maxLength = num(node["maxLength"]);
    if (maxLength !== null && [...value].length > maxLength) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected at most ${maxLength} character${maxLength === 1 ? "" : "s"}, got ${[...value].length}`,
        hint: this.fieldHint(node),
      });
    }
    const pattern = str(node["pattern"]);
    if (pattern !== null) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(pattern, "u");
      } catch {
        re = null;
      }
      if (re === null) {
        this.add({ kind: "other", path, field, message: `the schema pattern "${pattern}" is not a valid regular expression`, hint: null });
      } else if (!re.test(value)) {
        this.add({
          kind: "other",
          path,
          field,
          message: `expected a value matching /${pattern}/, got ${JSON.stringify(value)}`,
          hint: this.fieldHint(node),
        });
      }
    }
    const format = str(node["format"]);
    if (format === "tmd-ref") {
      const allowedRaw = node["x-tmd-ref"];
      const allowed =
        typeof allowedRaw === "string"
          ? [allowedRaw]
          : Array.isArray(allowedRaw)
            ? allowedRaw.map((t) => String(t))
            : undefined;
      this.refs.push({
        path,
        field: field ?? "",
        value,
        allowed,
        allowSelf: node["x-tmd-ref-self"] === true,
        description: str(node["description"]),
      });
    } else if (format !== null) {
      const re = FORMATS[format];
      if (re !== undefined && !re.test(value)) {
        this.add({
          kind: "other",
          path,
          field,
          message: `expected a ${format} value, got ${JSON.stringify(value)}`,
          hint: this.fieldHint(node),
        });
      }
    }
  }

  private validateArray(node: Schema, value: Json[], path: (string | number)[]): void {
    const field = pathToField(path);
    const minItems = num(node["minItems"]);
    if (minItems !== null && value.length < minItems) {
      this.add({ kind: "other", path, field, message: `expected at least ${minItems} items, got ${value.length}`, hint: this.fieldHint(node) });
    }
    const maxItems = num(node["maxItems"]);
    if (maxItems !== null && value.length > maxItems) {
      this.add({ kind: "other", path, field, message: `expected at most ${maxItems} items, got ${value.length}`, hint: this.fieldHint(node) });
    }
    if (node["uniqueItems"] === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = 0; j < i; j++) {
          if (deepEqual(value[i], value[j])) {
            this.add({
              kind: "other",
              path,
              field,
              message: `expected all items to be different, item ${i + 1} repeats ${describe(value[i])}`,
              hint: this.fieldHint(node),
            });
            break;
          }
        }
      }
    }
    const prefixItems = node["prefixItems"];
    let offset = 0;
    if (Array.isArray(prefixItems)) {
      for (let i = 0; i < prefixItems.length && i < value.length; i++) {
        const itemSchema = asSchema(prefixItems[i]);
        if (itemSchema) this.validate(itemSchema, value[i]!, [...path, i]);
      }
      offset = prefixItems.length;
    }
    const items = node["items"];
    if (items === false && value.length > offset) {
      this.add({ kind: "other", path, field, message: `expected at most ${offset} items, got ${value.length}`, hint: null });
      return;
    }
    const itemSchema = asSchema(items);
    if (itemSchema) {
      for (let i = offset; i < value.length; i++) this.validate(itemSchema, value[i]!, [...path, i]);
    }
  }

  private validateObject(node: Schema, value: { [key: string]: Json }, path: (string | number)[]): void {
    const properties = asSchema(node["properties"]) ?? {};
    const required = node["required"];
    if (Array.isArray(required)) {
      for (const rawName of required) {
        const name = String(rawName);
        if (Object.hasOwn(value, name)) continue;
        const propSchema = asSchema(properties[name]) ?? {};
        const resolved = this.deref(propSchema);
        const typeName = resolved["type"] === undefined ? "any" : String(resolved["type"]);
        const description = str(resolved["description"]);
        this.add({
          kind: "required",
          path: [...path, name],
          field: pathToField([...path, name]),
          message: `missing required field "${name}" (${typeName}${description ? `, ${description}` : ""})`,
          hint: `add ${name}: <${typeName}> to the frontmatter`,
        });
      }
    }
    for (const [key, propValue] of Object.entries(value)) {
      const propSchema = asSchema(properties[key]);
      if (propSchema) {
        const resolved = this.deref(propSchema);
        const date = deprecationDate(resolved) ?? deprecationDate(propSchema);
        if (date !== null) this.deprecated.push({ path: [...path, key], field: pathToField([...path, key])!, date });
        this.validate(propSchema, propValue!, [...path, key]);
        continue;
      }
      const additional = node["additionalProperties"];
      if (additional === false) {
        const known = Object.keys(properties);
        const suggestion = nearest(key, known);
        this.add({
          kind: "other",
          path: [...path, key],
          field: pathToField([...path, key]),
          message: `unknown field "${key}", this type does not allow extra fields`,
          hint: suggestion ? `did you mean "${suggestion}"?` : known.length > 0 ? `known fields: ${known.join(", ")}` : null,
        });
        continue;
      }
      const additionalSchema = asSchema(additional);
      if (additionalSchema) this.validate(additionalSchema, propValue!, [...path, key]);
    }
  }

  private validateCombinators(node: Schema, value: Json, path: (string | number)[], field: string | null): void {
    const allOf = node["allOf"];
    if (Array.isArray(allOf)) {
      for (const branch of allOf) {
        const schema = asSchema(branch);
        if (schema) this.validate(schema, value, path);
      }
    }
    const anyOf = node["anyOf"];
    if (Array.isArray(anyOf)) this.runBranches(anyOf, value, path, field, "anyOf");
    const oneOf = node["oneOf"];
    if (Array.isArray(oneOf)) this.runBranches(oneOf, value, path, field, "oneOf");
    const not = asSchema(node["not"]);
    if (not) {
      const probe = new Validator(this.root);
      probe.validate(not, value, path);
      if (probe.issues.length === 0) {
        this.add({ kind: "other", path, field, message: `expected a value that does not match the "not" schema, got ${describe(value)}`, hint: null });
      }
    }
  }

  private runBranches(branches: Json[], value: Json, path: (string | number)[], field: string | null, keyword: "anyOf" | "oneOf"): void {
    const passing: Validator[] = [];
    const failures: string[] = [];
    for (const branch of branches) {
      const schema = asSchema(branch);
      if (!schema) continue;
      const probe = new Validator(this.root);
      probe.validate(schema, value, path);
      if (probe.issues.length === 0) passing.push(probe);
      else failures.push(probe.issues[0]!.message);
    }
    if (passing.length === 0) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected a value matching one of the ${keyword} shapes, got ${describe(value)}`,
        hint: failures.length > 0 ? `each shape failed: ${failures.join("; ")}` : null,
      });
      return;
    }
    if (keyword === "oneOf" && passing.length > 1) {
      this.add({
        kind: "other",
        path,
        field,
        message: `expected a value matching exactly one oneOf shape, ${passing.length} of them matched`,
        hint: null,
      });
      return;
    }
    const winner = passing[0]!;
    this.refs.push(...winner.refs);
    this.deprecated.push(...winner.deprecated);
  }
}

/** Edit distance, used for "did you mean" hints. */
export function distance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  const first = rows[0]!;
  for (let j = 0; j <= b.length; j++) first[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const row = rows[i]!;
    const prev = rows[i - 1]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

export function nearest(needle: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(needle.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(needle.length / 3));
  return best !== null && bestScore <= limit ? best : null;
}

export function validate(schema: Schema, value: Json): ValidateResult {
  const validator = new Validator(schema);
  validator.validate(schema, value, []);
  return { issues: validator.issues, refs: validator.refs, deprecated: validator.deprecated };
}

/** Structural check of a schema file itself. Returns a list of problems. */
export function checkSchema(schema: Json): string[] {
  const problems: string[] = [];
  const root = asSchema(schema);
  if (!root) return ["the schema must be a JSON object"];
  const seen = new Set<Schema>();

  const walk = (node: Json, where: string): void => {
    const current = asSchema(node);
    if (!current || seen.has(current)) return;
    seen.add(current);
    const ref = current["$ref"];
    if (ref !== undefined) {
      if (typeof ref !== "string") problems.push(`${where}: $ref must be a string`);
      else if (!ref.startsWith("#")) problems.push(`${where}: only local $ref values are supported, found "${ref}"`);
      else if (resolvePointer(root, ref) === null) problems.push(`${where}: $ref "${ref}" cannot be resolved`);
    }
    const type = current["type"];
    if (type !== undefined) {
      const names = Array.isArray(type) ? type : [type];
      for (const name of names) {
        if (typeof name !== "string" || !["object", "array", "string", "number", "integer", "boolean", "null"].includes(name)) {
          problems.push(`${where}: "${String(name)}" is not a JSON Schema type`);
        }
      }
    }
    const required = current["required"];
    if (required !== undefined) {
      if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) {
        problems.push(`${where}: required must be a list of field names`);
      }
    }
    const properties = current["properties"];
    if (properties !== undefined) {
      const props = asSchema(properties);
      if (!props) problems.push(`${where}: properties must be an object`);
      else {
        for (const [key, value] of Object.entries(props)) walk(value!, `${where}.properties.${key}`);
      }
    }
    const pattern = current["pattern"];
    if (typeof pattern === "string") {
      try {
        new RegExp(pattern, "u");
      } catch {
        problems.push(`${where}: pattern "${pattern}" is not a valid regular expression`);
      }
    }
    const enumValues = current["enum"];
    if (enumValues !== undefined && !Array.isArray(enumValues)) problems.push(`${where}: enum must be a list`);
    for (const key of ["items", "additionalProperties", "not"]) {
      const child = current[key];
      if (child !== undefined && typeof child !== "boolean") walk(child, `${where}.${key}`);
    }
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
      const child = current[key];
      if (child === undefined) continue;
      if (!Array.isArray(child)) {
        problems.push(`${where}: ${key} must be a list of schemas`);
        continue;
      }
      child.forEach((item, i) => walk(item!, `${where}.${key}[${i}]`));
    }
    const defs = asSchema(current["$defs"]);
    if (defs) for (const [key, value] of Object.entries(defs)) walk(value!, `${where}.$defs.${key}`);
  };

  walk(root, "schema");
  return problems;
}
