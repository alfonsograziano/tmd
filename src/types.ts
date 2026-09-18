/** Shared types and the diagnostic codes from the spec. */

export type Level = "error" | "warn";

export interface Diagnostic {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** 1-based line number, or null when the problem is about the whole file. */
  line: number | null;
  code: string;
  level: Level;
  /** Dotted field path, or null. */
  field: string | null;
  message: string;
  /** How to fix it. Agents read this. */
  hint: string | null;
}

export interface CodeInfo {
  level: Level;
  meaning: string;
  /** True for the codes this implementation adds on top of the spec. */
  extension?: boolean;
}

export const CODES: { [code: string]: CodeInfo } = {
  E001: { level: "error", meaning: "File name has a type segment but no schema exists for that type" },
  E002: { level: "error", meaning: "Required field missing" },
  E003: { level: "error", meaning: "Field fails schema (type, enum, pattern, range, extra property)" },
  E004: { level: "error", meaning: "Reference target not found" },
  E005: { level: "error", meaning: "Reference target has the wrong type" },
  E006: { level: "error", meaning: "Duplicate entity id across the project" },
  E007: { level: "error", meaning: "_type is not a valid type name, or a schema defines a reserved _ key" },
  E008: { level: "error", meaning: "Frontmatter missing, unparsable, or not a mapping" },
  E009: { level: "error", meaning: "Required section heading missing from the body" },
  E010: { level: "error", meaning: "Schema file itself is invalid" },
  E011: { level: "error", meaning: "Entity references itself and the schema does not allow it", extension: true },
  W001: { level: "warn", meaning: "Untyped .md file in a scanned folder (only when untyped: warn)" },
  W002: { level: "warn", meaning: "Entity nothing references (only when refs.orphans: warn)" },
  W003: { level: "warn", meaning: "Deprecated field in use" },
  W004: { level: "warn", meaning: "Reference in path form instead of id form (fixable)" },
  W005: { level: "warn", meaning: "Field order differs from schema order, or _type is not the first key (fixable)" },
  W006: { level: "warn", meaning: "File name type and _type disagree; _type was used (error under strict)" },
  W007: { level: "warn", meaning: "Slug does not follow the recommended [a-z0-9][a-z0-9-]* pattern", extension: true },
};

export const TYPE_NAME = /^[a-z0-9][a-z0-9-]*$/;
export const SLUG_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function diagnostic(
  path: string,
  code: string,
  message: string,
  extra: { line?: number | null; field?: string | null; hint?: string | null } = {},
): Diagnostic {
  const info = CODES[code];
  return {
    path,
    line: extra.line ?? null,
    code,
    level: info ? info.level : "error",
    field: extra.field ?? null,
    message,
    hint: extra.hint ?? null,
  };
}

export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const al = a.line ?? 0;
    const bl = b.line ?? 0;
    if (al !== bl) return al - bl;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

export function countLevels(list: Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const item of list) {
    if (item.level === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** Today as an ISO date. TMD_TODAY overrides it, which keeps tests stable. */
export function today(): string {
  const override = process.env["TMD_TODAY"];
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return new Date().toISOString().slice(0, 10);
}
