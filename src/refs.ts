/** Reading and resolving `tmd-ref` values. */

import path from "node:path";
import type { Project, TmdFile } from "./project.ts";
import { lookup } from "./project.ts";
import type { RefSite } from "./jsonschema.ts";

export type RefForm = "id" | "path";

export interface ResolvedRef {
  /** The raw value from the file. */
  raw: string;
  form: RefForm;
  /** Dotted field path inside the frontmatter. */
  field: string;
  /** Allowed target types, undefined means any. */
  allowed: string[] | undefined;
  allowSelf: boolean;
  /** The id the value points at, once resolved. Null when nothing was found. */
  targetId: string | null;
  target: TmdFile | null;
  /** The id the value should be written as, for the W004 fix. */
  idForm: string | null;
}

/** Path form is anything that looks like a file path instead of an id. */
export function isPathForm(value: string): boolean {
  return value.includes("/") || value.toLowerCase().endsWith(".md") || value.startsWith(".");
}

export function resolveRef(project: Project, from: TmdFile, site: RefSite): ResolvedRef {
  const raw = site.value;
  const base: Omit<ResolvedRef, "form" | "targetId" | "target" | "idForm"> = {
    raw,
    field: site.field,
    allowed: site.allowed,
    allowSelf: site.allowSelf,
  };
  if (isPathForm(raw)) {
    const abs = path.resolve(path.dirname(from.abs), raw);
    const target = project.files.find((candidate) => candidate.abs === abs) ?? null;
    return {
      ...base,
      form: "path",
      targetId: target?.id ?? null,
      target,
      idForm: target?.id ?? null,
    };
  }
  const target = lookup(project, raw);
  return { ...base, form: "id", targetId: target ? raw : null, target, idForm: raw };
}

/** All ids in the project, used for "did you mean" hints. */
export function knownIds(project: Project): string[] {
  return [...project.index.keys()].sort();
}
