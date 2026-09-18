/** Splitting a markdown file into frontmatter and body. */

import { parseYaml, YamlError, type YamlValue } from "./yaml.ts";

export interface Frontmatter {
  /** Parsed mapping, or null when the block is missing or is not a mapping. */
  data: { [key: string]: YamlValue } | null;
  /** Dotted field path to 1-based line number. */
  lines: Map<string, number>;
  /** The raw text between the two `---` fences. */
  raw: string;
  /** 1-based line number of the first line of the YAML block. */
  startLine: number;
  /** 1-based line number of the closing `---`. */
  endLine: number;
  /** Everything after the closing fence. */
  body: string;
  /** Set when the block is missing, unparsable, or not a mapping. */
  error: { message: string; line: number } | null;
}

const FENCE = /^---[ \t]*$/;

export function parseFrontmatter(text: string): Frontmatter {
  const empty: Frontmatter = {
    data: null,
    lines: new Map(),
    raw: "",
    startLine: 1,
    endLine: 1,
    body: text,
    error: null,
  };
  const withoutBom = text.startsWith("﻿") ? text.slice(1) : text;
  const rows = withoutBom.split("\n");
  if (rows.length === 0 || !FENCE.test(rows[0] ?? "")) {
    return { ...empty, error: { message: "frontmatter is missing, the file must start with a --- fence on line 1", line: 1 } };
  }
  let close = -1;
  for (let i = 1; i < rows.length; i++) {
    if (FENCE.test(rows[i] ?? "")) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return { ...empty, error: { message: "frontmatter is never closed, add a --- line after the fields", line: 1 } };
  }
  const raw = rows.slice(1, close).join("\n");
  const body = rows.slice(close + 1).join("\n");
  const base: Frontmatter = { ...empty, raw, body, startLine: 2, endLine: close + 1 };
  let parsed;
  try {
    parsed = parseYaml(raw, 2);
  } catch (err) {
    if (err instanceof YamlError) return { ...base, error: { message: err.message, line: err.line } };
    throw err;
  }
  const value = parsed.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...base, error: { message: "frontmatter must be a mapping of fields, not a list or a single value", line: 2 } };
  }
  return { ...base, data: value as { [key: string]: YamlValue }, lines: parsed.lines };
}

/** ATX headings (`# Title`, `## Notes`) found in a markdown body, fenced code ignored. */
export function bodyHeadings(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  let fence = "";
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) {
        inFence = true;
        fence = marker[0]!;
      } else if (marker[0] === fence) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) out.push(heading[1]!.trim());
  }
  return out;
}
