/** Loading the schema folder: one `<type>.schema.json` (or .yaml) per type. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseYaml, YamlError, type YamlValue } from "./yaml.ts";
import { checkSchema, xTmd, type Json, type Schema } from "./jsonschema.ts";
import { diagnostic, TYPE_NAME, type Diagnostic } from "./types.ts";

export const SCHEMA_DIR = ".tmd";
export const COMMON_TYPE = "_common";

export interface LoadedSchema {
  type: string;
  /** Path of the schema file, relative to the project root. */
  file: string;
  schema: Schema;
  /** `x-tmd.plural`, or the type plus "s". */
  plural: string;
  /** `x-tmd.sections`. */
  sections: string[];
  /** `x-tmd.example`, relative to the project root. */
  example: string | null;
  description: string | null;
}

export interface SchemaSet {
  byType: Map<string, LoadedSchema>;
  common: LoadedSchema | null;
  diagnostics: Diagnostic[];
}

function yamlToJson(value: YamlValue): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(yamlToJson);
  const out: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) out[key] = yamlToJson(item!);
  return out;
}

function stringList(value: Json | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/** Reserved keys a schema may not define, from E007. */
function reservedKeys(schema: Schema): string[] {
  const properties = schema["properties"];
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.keys(properties).filter((key) => key.startsWith("_"));
}

export async function loadSchemas(root: string): Promise<SchemaSet> {
  const dir = path.join(root, SCHEMA_DIR);
  const byType = new Map<string, LoadedSchema>();
  const diagnostics: Diagnostic[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return { byType, common: null, diagnostics };
  }
  for (const name of entries.sort()) {
    const match = /^(.+)\.schema\.(json|yaml|yml)$/.exec(name);
    if (!match) continue;
    const type = match[1]!;
    const relFile = `${SCHEMA_DIR}/${name}`;
    if (type !== COMMON_TYPE && !TYPE_NAME.test(type)) {
      diagnostics.push(
        diagnostic(relFile, "E010", `"${type}" is not a valid type name`, {
          hint: "type names are lowercase letters, digits and hyphens, for example meeting-note",
        }),
      );
      continue;
    }
    const text = await readFile(path.join(dir, name), "utf8");
    let parsed: Json;
    try {
      parsed = match[2] === "json" ? (JSON.parse(text) as Json) : yamlToJson(parseYaml(text).value);
    } catch (err) {
      const line = err instanceof YamlError ? err.line : null;
      diagnostics.push(
        diagnostic(relFile, "E010", `the schema file cannot be parsed: ${(err as Error).message}`, { line }),
      );
      continue;
    }
    const problems = checkSchema(parsed);
    if (problems.length > 0) {
      for (const problem of problems) diagnostics.push(diagnostic(relFile, "E010", problem));
      continue;
    }
    const schema = parsed as Schema;
    const reserved = reservedKeys(schema);
    for (const key of reserved) {
      diagnostics.push(
        diagnostic(relFile, "E007", `the schema defines the reserved field "${key}"`, {
          field: key,
          hint: "field names starting with _ belong to the format, rename the field",
        }),
      );
    }
    if (reserved.length > 0) continue;
    const extension = xTmd(schema);
    const example = typeof extension["example"] === "string" ? extension["example"] : null;
    const plural = typeof extension["plural"] === "string" ? extension["plural"] : `${type}s`;
    byType.set(type, {
      type,
      file: relFile,
      schema,
      plural,
      sections: stringList(extension["sections"]),
      example,
      description: typeof schema["description"] === "string" ? schema["description"] : null,
    });
  }
  const common = byType.get(COMMON_TYPE) ?? null;
  byType.delete(COMMON_TYPE);
  return { byType, common, diagnostics };
}

/** The order fields should appear in, used by W005 and by `tmd new`. */
export function schemaFieldOrder(schema: LoadedSchema | null, common: LoadedSchema | null): string[] {
  const order: string[] = [];
  const push = (loaded: LoadedSchema | null): void => {
    if (!loaded) return;
    const properties = loaded.schema["properties"];
    if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return;
    for (const key of Object.keys(properties)) if (!order.includes(key)) order.push(key);
  };
  push(schema);
  push(common);
  return order;
}

export function propertySchemas(loaded: LoadedSchema | null): { [key: string]: Schema } {
  if (!loaded) return {};
  const properties = loaded.schema["properties"];
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return {};
  const out: { [key: string]: Schema } = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) out[key] = value as Schema;
  }
  return out;
}

/**
 * The properties of a type, with the common schema underneath. A type schema
 * that repeats a common field wins, but keeps the common description when it
 * does not write its own.
 */
export function mergedProperties(loaded: LoadedSchema | null, common: LoadedSchema | null): { [key: string]: Schema } {
  const base = propertySchemas(common);
  const own = propertySchemas(loaded);
  const out: { [key: string]: Schema } = { ...base };
  for (const [key, schema] of Object.entries(own)) {
    const under = base[key];
    out[key] = under === undefined ? schema : { ...under, ...schema };
  }
  return out;
}

export function requiredFields(loaded: LoadedSchema | null): string[] {
  if (!loaded) return [];
  const required = loaded.schema["required"];
  if (!Array.isArray(required)) return [];
  return required.filter((item): item is string => typeof item === "string");
}
