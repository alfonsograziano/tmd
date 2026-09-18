/** Finding the project, walking it, resolving types, and building the id index. */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, type Frontmatter } from "./frontmatter.ts";
import { isIncluded, loadConfig, type Config } from "./config.ts";
import { loadSchemas, SCHEMA_DIR, type SchemaSet } from "./schemas.ts";

export class ProjectError extends Error {}

export interface TmdFile {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to the project root, with forward slashes. */
  rel: string;
  /** Everything before the type segment, or the whole name when there is none. */
  slug: string;
  /** Type taken from the file name, or null. */
  fileType: string | null;
  /** `_type` from the frontmatter, or null. Only set once the file is read. */
  declaredType: string | null;
  /** `_type` was present but is not a valid type name. */
  badDeclaredType: string | null;
  /** The type that wins: `_type` first, then the file name. */
  type: string | null;
  /** `<slug>.<type>`, or null for untyped files. */
  id: string | null;
  text: string | null;
  frontmatter: Frontmatter | null;
}

export interface Project {
  root: string;
  config: Config;
  schemas: SchemaSet;
  files: TmdFile[];
  /** Entity id to the files that claim it. More than one file is E006. */
  index: Map<string, TmdFile[]>;
}

const TYPE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

/** Split `honda.car.md` into slug `honda` and type `car`. */
export function splitName(basename: string): { slug: string; fileType: string | null } {
  const name = basename.replace(/\.md$/i, "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { slug: name, fileType: null };
  const candidate = name.slice(dot + 1);
  if (!TYPE_SEGMENT.test(candidate)) return { slug: name, fileType: null };
  return { slug: name.slice(0, dot), fileType: candidate };
}

/** Walk up from `start` looking for a folder that holds `.tmd`. */
export async function findRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  try {
    const info = await stat(current);
    if (!info.isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }
  for (;;) {
    try {
      const info = await stat(path.join(current, SCHEMA_DIR));
      if (info.isDirectory()) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ProjectError(
        `no ${SCHEMA_DIR}/ folder found in ${path.resolve(start)} or any folder above it. Create ${SCHEMA_DIR}/ with one <type>.schema.json per type.`,
      );
    }
    current = parent;
  }
}

const SKIP_DIRS = new Set([".git", "node_modules", SCHEMA_DIR]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    out.push(abs);
  }
}

function makeFile(root: string, abs: string): TmdFile {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const { slug, fileType } = splitName(path.basename(abs));
  return {
    abs,
    rel,
    slug,
    fileType,
    declaredType: null,
    badDeclaredType: null,
    type: fileType,
    id: fileType === null ? null : `${slug}.${fileType}`,
    text: null,
    frontmatter: null,
  };
}

/** Read a file and work out its effective type. */
export async function readFileEntry(file: TmdFile): Promise<TmdFile> {
  if (file.text !== null) return file;
  file.text = await readFile(file.abs, "utf8");
  file.frontmatter = parseFrontmatter(file.text);
  const data = file.frontmatter.data;
  if (data && Object.hasOwn(data, "_type")) {
    const raw = data["_type"];
    if (typeof raw === "string" && TYPE_SEGMENT.test(raw)) file.declaredType = raw;
    else file.badDeclaredType = raw === null ? "null" : String(raw);
  }
  file.type = file.declaredType ?? file.fileType;
  file.id = file.type === null ? null : `${file.slug}.${file.type}`;
  return file;
}

export interface LoadOptions {
  /** Read every file, not only the ones needed for the index. */
  full?: boolean;
}

/**
 * Load the project. Files whose type is in the name are indexed from the
 * directory walk alone; files that rely on `_type` have their frontmatter read,
 * which is the one cost of the frontmatter option.
 */
export async function loadProject(root: string, options: LoadOptions = {}): Promise<Project> {
  const config = await loadConfig(root);
  const schemas = await loadSchemas(root);
  const absPaths: string[] = [];
  await walk(root, root, absPaths);
  const files: TmdFile[] = [];
  for (const abs of absPaths) {
    const file = makeFile(root, abs);
    if (!isIncluded(config, file.rel)) continue;
    files.push(file);
  }
  for (const file of files) {
    if (options.full === true || file.fileType === null) await readFileEntry(file);
  }
  return { root, config, schemas, files, index: buildIndex(files) };
}

export function buildIndex(files: TmdFile[]): Map<string, TmdFile[]> {
  const index = new Map<string, TmdFile[]>();
  for (const file of files) {
    if (file.id === null) continue;
    const bucket = index.get(file.id);
    if (bucket) bucket.push(file);
    else index.set(file.id, [file]);
  }
  return index;
}

/** The single file for an id, or null when the id is unknown or duplicated. */
export function lookup(project: Project, id: string): TmdFile | null {
  const bucket = project.index.get(id);
  if (!bucket || bucket.length === 0) return null;
  return bucket[0]!;
}

export function relative(root: string, target: string): string {
  return path.relative(root, path.resolve(target)).split(path.sep).join("/");
}
