/** `tmd new`: a valid skeleton for a type. */

import { mergedProperties, requiredFields, schemaFieldOrder, type LoadedSchema } from "./schemas.ts";
import { placeholder } from "./fix.ts";
import { emitScalar, emitYaml, type YamlValue } from "./yaml.ts";
import type { Schema } from "./jsonschema.ts";

export interface NewFileInput {
  schema: LoadedSchema;
  common: LoadedSchema | null;
  slug: string;
  /** Write the type as `_type` instead of putting it in the file name. */
  typeInFrontmatter: boolean;
}

function describeField(schema: Schema): string {
  const bits: string[] = [];
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues)) bits.push(`one of ${enumValues.map((value) => String(value)).join(", ")}`);
  else if (schema["type"] !== undefined) bits.push(String(schema["type"]));
  if (schema["format"] === "tmd-ref") {
    const target = schema["x-tmd-ref"];
    const name = typeof target === "string" ? target : Array.isArray(target) ? target.map(String).join(" or ") : "any type";
    bits.push(`reference to type ${name}`);
  }
  const description = schema["description"];
  if (typeof description === "string") bits.push(description);
  return bits.join(", ");
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-.]/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function fileNameFor(input: NewFileInput): string {
  return input.typeInFrontmatter ? `${input.slug}.md` : `${input.slug}.${input.schema.type}.md`;
}

export function renderNewFile(input: NewFileInput): string {
  const properties = mergedProperties(input.schema, input.common);
  const required = new Set([...requiredFields(input.common), ...requiredFields(input.schema)]);
  const order = schemaFieldOrder(input.schema, input.common);
  const lines: string[] = ["---"];
  if (input.typeInFrontmatter) lines.push(`_type: ${input.schema.type}`);

  for (const field of order) {
    if (!required.has(field)) continue;
    const schema = properties[field] ?? {};
    const value = fieldValue(field, schema, input);
    const rendered = emitYaml(value as YamlValue).trimEnd();
    const description = describeField(schema);
    if (rendered.includes("\n")) {
      lines.push(`${field}:`);
      for (const row of emitYaml(value as YamlValue, 2).trimEnd().split("\n")) lines.push(row);
    } else {
      lines.push(`${field}: ${emitScalar(value as YamlValue)}${description ? `   # ${description}` : ""}`);
    }
  }

  const optional = order.filter((field) => !required.has(field));
  if (optional.length > 0) {
    lines.push("");
    lines.push("# Optional fields. Uncomment the ones you need.");
    for (const field of optional) {
      const schema = properties[field] ?? {};
      const description = describeField(schema);
      lines.push(`# ${field}: ${emitScalar(placeholder(schema) as YamlValue)}${description ? `   # ${description}` : ""}`);
    }
  }

  lines.push("---", "", `# ${titleFromSlug(input.slug)}`, "");
  for (const section of input.schema.sections) lines.push(`## ${section}`, "", "");
  return lines.join("\n").replace(/\n{3,}$/, "\n\n");
}

function fieldValue(field: string, schema: Schema, input: NewFileInput): YamlValue {
  const plainString =
    schema["type"] === "string" &&
    schema["enum"] === undefined &&
    schema["const"] === undefined &&
    schema["pattern"] === undefined &&
    schema["format"] === undefined;
  if (plainString && (field === "title" || field === "name")) return titleFromSlug(input.slug);
  if (plainString && field === "slug") return input.slug;
  return placeholder(schema);
}
