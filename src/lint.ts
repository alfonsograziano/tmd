/** The lint rule engine: every code from E001 to E011 and W001 to W007. */

import { bodyHeadings } from "./frontmatter.ts";
import { nearest, validate, type Json, type RefSite } from "./jsonschema.ts";
import { mergedProperties, schemaFieldOrder, type LoadedSchema } from "./schemas.ts";
import type { Project, TmdFile } from "./project.ts";
import { readFileEntry } from "./project.ts";
import { knownIds, resolveRef, type ResolvedRef } from "./refs.ts";
import { diagnostic, sortDiagnostics, today, SLUG_NAME, type Diagnostic } from "./types.ts";
import type { YamlValue } from "./yaml.ts";

export interface FileAnalysis {
  file: TmdFile;
  schema: LoadedSchema | null;
  /** Frontmatter with the reserved `_` keys removed. */
  data: { [key: string]: Json } | null;
  refs: ResolvedRef[];
  diagnostics: Diagnostic[];
}

export interface LintResult {
  diagnostics: Diagnostic[];
  analyses: FileAnalysis[];
  filesChecked: number;
}

function toJson(value: YamlValue): Json {
  return value as Json;
}

/** Drop the keys the format reserves; the validator never sees them. */
export function withoutReserved(data: { [key: string]: YamlValue }): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    out[key] = toJson(value!);
  }
  return out;
}

function lineOf(file: TmdFile, field: string | null): number {
  const lines = file.frontmatter?.lines;
  if (!lines || field === null) return 1;
  const parts = field.split(".");
  for (let end = parts.length; end > 0; end--) {
    const found = lines.get(parts.slice(0, end).join("."));
    if (found !== undefined) return found;
  }
  return 1;
}

/** The order the fields should be written in. */
export function expectedOrder(keys: string[], schemaOrder: string[]): string[] {
  const out: string[] = [];
  if (keys.includes("_type")) out.push("_type");
  for (const key of schemaOrder) if (keys.includes(key) && !out.includes(key)) out.push(key);
  for (const key of keys) if (!out.includes(key)) out.push(key);
  return out;
}

export function analyzeFile(project: Project, file: TmdFile): FileAnalysis {
  const diagnostics: Diagnostic[] = [];
  const refs: ResolvedRef[] = [];
  const frontmatter = file.frontmatter;

  if (!frontmatter || frontmatter.error) {
    // No type in the name and no readable frontmatter: this is an untyped file,
    // which the format says to leave alone.
    if (file.fileType === null) {
      if (project.config.untyped === "warn") {
        diagnostics.push(
          diagnostic(file.rel, "W001", "untyped markdown file", {
            hint: "rename it to <slug>.<type>.md or add _type to the frontmatter",
          }),
        );
      }
      return { file, schema: null, data: null, refs, diagnostics };
    }
    const message = frontmatter?.error?.message ?? "the file could not be read";
    diagnostics.push(
      diagnostic(file.rel, "E008", message, {
        line: frontmatter?.error?.line ?? 1,
        hint: "a typed file starts with --- on line 1, a YAML mapping, then a closing ---",
      }),
    );
    return { file, schema: null, data: null, refs, diagnostics };
  }

  if (file.badDeclaredType !== null) {
    diagnostics.push(
      diagnostic(file.rel, "E007", `_type "${file.badDeclaredType}" is not a valid type name`, {
        line: lineOf(file, "_type"),
        field: "_type",
        hint: "type names are lowercase letters, digits and hyphens, for example meeting-note",
      }),
    );
  }

  if (file.type === null) {
    if (project.config.untyped === "warn") {
      diagnostics.push(
        diagnostic(file.rel, "W001", "untyped markdown file", {
          hint: `rename it to <slug>.<type>.md or add _type to the frontmatter`,
        }),
      );
    }
    return { file, schema: null, data: null, refs, diagnostics };
  }

  if (file.fileType !== null && file.declaredType !== null && file.fileType !== file.declaredType) {
    diagnostics.push(
      diagnostic(
        file.rel,
        "W006",
        `the file name says type "${file.fileType}" but _type says "${file.declaredType}", _type was used`,
        {
          line: lineOf(file, "_type"),
          field: "_type",
          hint: `rename the file to ${file.slug}.${file.declaredType}.md, or change _type to ${file.fileType}`,
        },
      ),
    );
  }

  if (!SLUG_NAME.test(file.slug)) {
    diagnostics.push(
      diagnostic(file.rel, "W007", `the slug "${file.slug}" is not lowercase letters, digits and hyphens`, {
        hint: "rename the file so the part before the type is a plain slug, for example civic-2019",
      }),
    );
  }

  const schema = project.schemas.byType.get(file.type) ?? null;
  if (!schema) {
    const known = [...project.schemas.byType.keys()];
    const suggestion = nearest(file.type, known);
    diagnostics.push(
      diagnostic(file.rel, "E001", `no schema exists for type "${file.type}"`, {
        line: file.declaredType !== null ? lineOf(file, "_type") : null,
        field: file.declaredType !== null ? "_type" : null,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `create .tmd/${file.type}.schema.json, known types: ${known.length > 0 ? known.join(", ") : "none"}`,
      }),
    );
    return { file, schema: null, data: null, refs, diagnostics };
  }

  const data = withoutReserved(frontmatter.data ?? {});
  const common = project.schemas.common;
  const refSites: RefSite[] = [];

  for (const active of [common, schema]) {
    if (!active) continue;
    const result = validate(active.schema, data);
    for (const issue of result.issues) {
      const code = issue.kind === "required" ? "E002" : "E003";
      diagnostics.push(
        diagnostic(file.rel, code, issue.message, {
          line: issue.kind === "required" ? 1 : lineOf(file, issue.field),
          field: issue.field,
          hint: issue.hint,
        }),
      );
    }
    for (const site of result.deprecated) {
      if (site.date <= today()) {
        diagnostics.push(
          diagnostic(file.rel, "W003", `the field "${site.field}" is deprecated since ${site.date}`, {
            line: lineOf(file, site.field),
            field: site.field,
            hint: "remove the field, the schema marked it deprecated",
          }),
        );
      }
    }
    refSites.push(...result.refs);
  }

  for (const site of refSites) {
    const resolved = resolveRef(project, file, site);
    refs.push(resolved);
    const line = lineOf(file, site.field);
    if (resolved.form === "path" && !project.config.refs.allow_paths) {
      diagnostics.push(
        diagnostic(file.rel, "E004", `reference "${resolved.raw}" is a path, and paths are switched off`, {
          line,
          field: site.field,
          hint: "set refs.allow_paths: true in .tmd/config.yaml, or write the entity id instead",
        }),
      );
      continue;
    }
    if (resolved.targetId === null || resolved.target === null) {
      const suggestion = nearest(resolved.raw, knownIds(project));
      diagnostics.push(
        diagnostic(file.rel, "E004", `reference "${resolved.raw}" not found`, {
          line,
          field: site.field,
          hint: suggestion ? `did you mean ${suggestion}?` : "run tmd schema list to see which entities exist",
        }),
      );
      continue;
    }
    if (resolved.form === "path") {
      diagnostics.push(
        diagnostic(file.rel, "W004", `reference "${resolved.raw}" is a path, the id form is "${resolved.targetId}"`, {
          line,
          field: site.field,
          hint: "run tmd lint --fix to rewrite it, ids survive file moves",
        }),
      );
    }
    const targetType = resolved.target.type ?? "";
    if (site.allowed !== undefined && !site.allowed.includes(targetType)) {
      diagnostics.push(
        diagnostic(
          file.rel,
          "E005",
          `expected type ${site.allowed.join(" or ")}, found ${targetType || "no type"}`,
          {
            line,
            field: site.field,
            hint: `"${resolved.raw}" points at ${resolved.target.rel}`,
          },
        ),
      );
    }
    if (resolved.targetId === file.id && !site.allowSelf) {
      diagnostics.push(
        diagnostic(file.rel, "E011", `the entity references itself through "${site.field}"`, {
          line,
          field: site.field,
          hint: 'set "x-tmd-ref-self": true on the field when a self reference is wanted',
        }),
      );
    }
  }

  if (schema.sections.length > 0) {
    const headings = bodyHeadings(frontmatter.body);
    for (const section of schema.sections) {
      if (!headings.includes(section)) {
        diagnostics.push(
          diagnostic(file.rel, "E009", `the body is missing the required section "${section}"`, {
            line: frontmatter.endLine + 1,
            hint: `add a heading "## ${section}" to the body`,
          }),
        );
      }
    }
  }

  const keys = Object.keys(frontmatter.data ?? {});
  const order = expectedOrder(keys, schemaFieldOrder(schema, common));
  if (keys.join(" ") !== order.join(" ")) {
    const firstWrong = keys.find((key, i) => key !== order[i]) ?? keys[0]!;
    const reason =
      keys.includes("_type") && keys[0] !== "_type"
        ? "_type must be the first key"
        : `field order differs from the schema order, expected ${order.join(", ")}`;
    diagnostics.push(
      diagnostic(file.rel, "W005", reason, {
        line: lineOf(file, firstWrong),
        field: firstWrong,
        hint: "run tmd lint --fix to reorder the fields",
      }),
    );
  }

  return { file, schema, data, refs, diagnostics };
}

export interface LintOptions {
  /** Only lint these files. Undefined means the whole project. */
  targets?: TmdFile[];
}

export async function lint(project: Project, options: LintOptions = {}): Promise<LintResult> {
  const wantOrphans = project.config.refs.orphans === "warn";
  const targets = options.targets ?? project.files;
  const needed = wantOrphans ? project.files : targets;
  for (const file of needed) await readFileEntry(file);

  const analyses: FileAnalysis[] = [];
  const byPath = new Map<string, FileAnalysis>();
  for (const file of needed) {
    const analysis = analyzeFile(project, file);
    byPath.set(file.rel, analysis);
    analyses.push(analysis);
  }

  const diagnostics: Diagnostic[] = [...project.schemas.diagnostics];
  const targetPaths = new Set(targets.map((file) => file.rel));
  for (const analysis of analyses) {
    if (!targetPaths.has(analysis.file.rel)) continue;
    diagnostics.push(...analysis.diagnostics);
  }

  for (const [id, bucket] of project.index) {
    if (bucket.length < 2) continue;
    for (const file of bucket) {
      if (!targetPaths.has(file.rel)) continue;
      const others = bucket.filter((other) => other !== file).map((other) => other.rel);
      diagnostics.push(
        diagnostic(file.rel, "E006", `duplicate entity id "${id}", also used by ${others.join(", ")}`, {
          hint: "an id is <slug>.<type> and must be unique in the project, rename one of the files",
        }),
      );
    }
  }

  if (wantOrphans) {
    const referenced = new Set<string>();
    for (const analysis of analyses) {
      for (const ref of analysis.refs) {
        if (ref.targetId !== null && ref.targetId !== analysis.file.id) referenced.add(ref.targetId);
      }
    }
    for (const analysis of analyses) {
      const file = analysis.file;
      if (file.id === null || !targetPaths.has(file.rel)) continue;
      if (analysis.schema === null) continue;
      if (referenced.has(file.id)) continue;
      diagnostics.push(
        diagnostic(file.rel, "W002", "no entity references this file", {
          hint: "link it from another entity, or set refs.orphans: ignore in .tmd/config.yaml",
        }),
      );
    }
  }

  return { diagnostics: sortDiagnostics(diagnostics), analyses, filesChecked: targets.length };
}

/** Optional fields of a type that the file does not set. Used by `tmd check`. */
export interface MissingOptional {
  field: string;
  type: string;
  description: string | null;
  enum: string[] | null;
  default: Json | null;
  ref: string | null;
}

export function missingOptionalFields(project: Project, analysis: FileAnalysis): MissingOptional[] {
  const out: MissingOptional[] = [];
  const data = analysis.data ?? {};
  const required = new Set<string>();
  for (const loaded of [project.schemas.common, analysis.schema]) {
    if (!loaded) continue;
    const list = loaded.schema["required"];
    if (Array.isArray(list)) for (const item of list) required.add(String(item));
  }
  {
    const merged = mergedProperties(analysis.schema, project.schemas.common);
    const ordered = schemaFieldOrder(analysis.schema, project.schemas.common);
    for (const field of ordered) {
      const propSchema = merged[field] ?? {};
      if (required.has(field) || Object.hasOwn(data, field) || out.some((item) => item.field === field)) continue;
      const enumValues = propSchema["enum"];
      // For a list of references the format sits on `items`, not on the field.
      const items = propSchema["items"];
      const refSource =
        propSchema["type"] === "array" && items !== null && typeof items === "object" && !Array.isArray(items)
          ? (items as { [key: string]: Json })
          : propSchema;
      const refType = refSource["x-tmd-ref"];
      out.push({
        field,
        type: propSchema["type"] === undefined ? (Array.isArray(enumValues) ? "enum" : "any") : String(propSchema["type"]),
        description: typeof propSchema["description"] === "string" ? propSchema["description"] : null,
        enum: Array.isArray(enumValues) ? enumValues.map((value) => String(value)) : null,
        default: propSchema["default"] ?? null,
        ref:
          refSource["format"] === "tmd-ref"
            ? typeof refType === "string"
              ? refType
              : Array.isArray(refType)
                ? refType.map(String).join(" or ")
                : "any type"
            : null,
      });
    }
  }
  return out;
}
