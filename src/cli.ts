#!/usr/bin/env node
/** The `tmd` command line. A thin layer over the library in this folder. */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { findRoot, loadProject, readFileEntry, ProjectError, splitName, type Project, type TmdFile } from "./project.ts";
import { lint, missingOptionalFields, type FileAnalysis } from "./lint.ts";
import { fixFile } from "./fix.ts";
import { fileNameFor, renderNewFile } from "./new.ts";
import { buildExport, collect, defaultOutName, type ExportFormat } from "./export.ts";
import { buildGraph, toDot } from "./graph.ts";
import { formatDiagnostics, paint, summaryLine } from "./report.ts";
import { countLevels, type Diagnostic } from "./types.ts";
import { ConfigError } from "./config.ts";

const VERSION = "0.1.0";

const HELP = `tmd ${VERSION} - Typed Markdown

Usage
  tmd lint [path...]                lint one file, some files, a folder, or the whole project
      --fix                         apply the safe fixes (W004, W005)
      --scaffold                    with --fix, add missing required fields as placeholders
      --strict                      warnings count as errors
      --json                        machine readable output
  tmd check <file>                  lint one file and list every optional field that is not set
  tmd schema list                   every type, its schema path, and how many files use it
  tmd schema show <type>            the schema, plus its example file if declared
  tmd new <type> <slug> [dir]       create a valid skeleton file
  tmd refs <id|file>                outgoing and incoming references
  tmd export --format json|jsonl|csv|sqlite [--out path] [--with-body]
  tmd graph [--format dot|json]     the reference graph

Every command takes --json. Exit code is 0 when there are no errors, 1 when
there are errors, 2 when the tool itself failed.
`;

class UsageError extends Error {}

function out(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function err(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

function parse(args: string[], options: ParseArgsConfig["options"], allowPositionals = true): { values: Record<string, unknown>; positionals: string[] } {
  try {
    const result = parseArgs({ args, options, allowPositionals, strict: true });
    return { values: result.values as Record<string, unknown>, positionals: result.positionals };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function exitCode(diagnostics: Diagnostic[], strict: boolean): number {
  const { errors, warnings } = countLevels(diagnostics);
  return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Turn command line paths into the files to lint. */
async function resolveTargets(project: Project, positionals: string[]): Promise<TmdFile[]> {
  if (positionals.length === 0) return project.files;
  const picked: TmdFile[] = [];
  for (const entry of positionals) {
    const abs = path.resolve(entry);
    if (await isDirectory(abs)) {
      const prefix = abs.endsWith(path.sep) ? abs : abs + path.sep;
      const inside = project.files.filter((file) => file.abs.startsWith(prefix));
      if (inside.length === 0) err(`tmd: no markdown files found in ${entry}`);
      picked.push(...inside);
      continue;
    }
    const known = project.files.find((file) => file.abs === abs);
    if (known) {
      picked.push(known);
      continue;
    }
    try {
      await stat(abs);
    } catch {
      throw new ProjectError(`${entry} does not exist`);
    }
    if (!abs.toLowerCase().endsWith(".md")) throw new ProjectError(`${entry} is not a markdown file`);
    const rel = path.relative(project.root, abs).split(path.sep).join("/");
    if (rel.startsWith("..")) throw new ProjectError(`${entry} is outside the project at ${project.root}`);
    const { slug, fileType } = splitName(path.basename(abs));
    const file: TmdFile = {
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
    project.files.push(file);
    await readFileEntry(file);
    if (file.id !== null) {
      const bucket = project.index.get(file.id);
      if (bucket) bucket.push(file);
      else project.index.set(file.id, [file]);
    }
    picked.push(file);
  }
  return [...new Set(picked)];
}

async function commandLint(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    fix: { type: "boolean", default: false },
    scaffold: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  });
  const json = values["json"] === true;
  const root = await findRoot(positionals[0] ?? process.cwd());
  let project = await loadProject(root);
  const strict = values["strict"] === true || project.config.strict;
  let targets = await resolveTargets(project, positionals);
  let result = await lint(project, { targets });

  if (values["fix"] === true) {
    const byPath = new Map(result.analyses.map((analysis) => [analysis.file.rel, analysis]));
    const fixed: string[] = [];
    for (const file of targets) {
      const analysis = byPath.get(file.rel);
      if (!analysis) continue;
      const fix = fixFile(project, analysis, { scaffold: values["scaffold"] === true });
      if (!fix.changed) continue;
      await writeFile(file.abs, fix.text, "utf8");
      fixed.push(`${file.rel} (${fix.applied.join(", ")})`);
    }
    project = await loadProject(root);
    targets = await resolveTargets(project, positionals);
    result = await lint(project, { targets });
    if (!json && fixed.length > 0) {
      out(paint("green", `fixed ${fixed.length} file${fixed.length === 1 ? "" : "s"}:`));
      for (const line of fixed) out(`  ${line}`);
    }
  }

  if (json) {
    out(JSON.stringify(result.diagnostics, null, 2));
  } else {
    if (result.diagnostics.length > 0) out(formatDiagnostics(result.diagnostics));
    out(summaryLine(result.diagnostics, result.filesChecked));
  }
  return exitCode(result.diagnostics, strict);
}

async function commandCheck(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    strict: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  });
  const target = positionals[0];
  if (target === undefined) throw new UsageError("tmd check needs a file: tmd check cars/honda.car.md");
  const json = values["json"] === true;
  const root = await findRoot(target);
  const project = await loadProject(root);
  const strict = values["strict"] === true || project.config.strict;
  const targets = await resolveTargets(project, [target]);
  const result = await lint(project, { targets });
  const analysis = result.analyses.find((item) => item.file.rel === targets[0]?.rel);
  const optional = analysis ? missingOptionalFields(project, analysis) : [];

  if (json) {
    out(JSON.stringify({ path: targets[0]?.rel ?? target, diagnostics: result.diagnostics, optional }, null, 2));
    return exitCode(result.diagnostics, strict);
  }
  if (result.diagnostics.length > 0) out(formatDiagnostics(result.diagnostics));
  out(summaryLine(result.diagnostics, result.filesChecked));
  if (optional.length === 0) {
    out("every optional field is set");
    return exitCode(result.diagnostics, strict);
  }
  out("");
  out(`optional fields not set (${optional.length}):`);
  for (const field of optional) {
    const bits: string[] = [field.enum ? `one of ${field.enum.join(", ")}` : field.type];
    if (field.ref !== null) bits.push(`reference to a ${field.ref}`);
    if (field.default !== null) bits.push(`default ${JSON.stringify(field.default)}`);
    const head = `  ${field.field.padEnd(14)} ${bits.join(", ")}`;
    out(field.description === null ? head : `${head}\n${" ".repeat(17)}${paint("dim", field.description)}`);
  }
  return exitCode(result.diagnostics, strict);
}

async function commandSchema(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: "boolean", default: false } });
  const json = values["json"] === true;
  const sub = positionals[0];
  const root = await findRoot(process.cwd());
  const project = await loadProject(root);

  if (sub === "list" || sub === undefined) {
    const counts = new Map<string, number>();
    for (const file of project.files) {
      if (file.type === null) continue;
      counts.set(file.type, (counts.get(file.type) ?? 0) + 1);
    }
    const rows = [...project.schemas.byType.values()]
      .sort((a, b) => (a.type < b.type ? -1 : 1))
      .map((schema) => ({
        type: schema.type,
        schema: schema.file,
        files: counts.get(schema.type) ?? 0,
        plural: schema.plural,
        description: schema.description,
      }));
    if (json) {
      out(JSON.stringify(rows, null, 2));
      return 0;
    }
    if (rows.length === 0) {
      out("no schemas found in .tmd/");
      return 0;
    }
    const width = Math.max(...rows.map((row) => row.type.length), 4);
    out(`${"type".padEnd(width)}  files  schema`);
    for (const row of rows) {
      out(`${row.type.padEnd(width)}  ${String(row.files).padStart(5)}  ${row.schema}`);
    }
    if (project.schemas.common) out(`\ncommon schema: ${project.schemas.common.file} (applies to every type)`);
    return 0;
  }

  if (sub === "show") {
    const type = positionals[1];
    if (type === undefined) throw new UsageError("tmd schema show needs a type: tmd schema show car");
    const loaded = project.schemas.byType.get(type);
    if (!loaded) throw new ProjectError(`no schema for type "${type}", run tmd schema list to see the types`);
    let example: { path: string; content: string } | null = null;
    if (loaded.example !== null) {
      const abs = path.resolve(root, loaded.example);
      try {
        example = { path: loaded.example, content: await readFile(abs, "utf8") };
      } catch {
        example = null;
        if (!json) err(`tmd: the example file ${loaded.example} could not be read`);
      }
    }
    if (json) {
      out(JSON.stringify({ type, file: loaded.file, schema: loaded.schema, example }, null, 2));
      return 0;
    }
    out(`# ${loaded.file}`);
    out(JSON.stringify(loaded.schema, null, 2));
    if (example) {
      out("");
      out(`# example: ${example.path}`);
      out(example.content);
    }
    return 0;
  }

  throw new UsageError(`unknown schema command "${sub}", use list or show`);
}

async function commandNew(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  });
  const [type, slug, dir] = positionals;
  if (type === undefined || slug === undefined) {
    throw new UsageError("tmd new needs a type and a slug: tmd new car honda cars/");
  }
  const json = values["json"] === true;
  const root = await findRoot(process.cwd());
  const project = await loadProject(root);
  const loaded = project.schemas.byType.get(type);
  if (!loaded) throw new ProjectError(`no schema for type "${type}", run tmd schema list to see the types`);
  const input = {
    schema: loaded,
    common: project.schemas.common,
    slug,
    typeInFrontmatter: project.config.type_in === "frontmatter",
  };
  const target = path.resolve(dir ?? process.cwd(), fileNameFor(input));
  try {
    await stat(target);
    if (values["force"] !== true) throw new ProjectError(`${path.relative(root, target)} already exists`);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const content = renderNewFile(input);
  await writeFile(target, content, "utf8");
  const rel = path.relative(root, target).split(path.sep).join("/");
  if (json) out(JSON.stringify({ path: rel, type, slug, id: `${slug}.${type}` }, null, 2));
  else out(`created ${rel}`);
  return 0;
}

async function commandRefs(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: "boolean", default: false } });
  const target = positionals[0];
  if (target === undefined) throw new UsageError("tmd refs needs an id or a file: tmd refs k20.engine");
  const json = values["json"] === true;
  const looksLikePath = target.includes("/") || target.toLowerCase().endsWith(".md");
  const root = await findRoot(looksLikePath ? target : process.cwd());
  const project = await loadProject(root, { full: true });
  const result = await lint(project);

  let analysis: FileAnalysis | undefined;
  if (looksLikePath) {
    const abs = path.resolve(target);
    analysis = result.analyses.find((item) => item.file.abs === abs);
  } else {
    analysis = result.analyses.find((item) => item.file.id === target);
  }
  if (!analysis) throw new ProjectError(`nothing found for "${target}"`);
  const id = analysis.file.id;

  const outgoing = analysis.refs.map((ref) => ({
    field: ref.field,
    to: ref.targetId ?? ref.raw,
    path: ref.target?.rel ?? null,
    resolved: ref.targetId !== null,
  }));
  const incoming: { from: string; field: string; path: string }[] = [];
  for (const other of result.analyses) {
    if (other === analysis || other.file.id === null) continue;
    for (const ref of other.refs) {
      if (ref.targetId !== null && ref.targetId === id) {
        incoming.push({ from: other.file.id, field: ref.field, path: other.file.rel });
      }
    }
  }
  incoming.sort((a, b) => (a.from === b.from ? (a.field < b.field ? -1 : 1) : a.from < b.from ? -1 : 1));

  if (json) {
    out(JSON.stringify({ id, path: analysis.file.rel, outgoing, incoming }, null, 2));
    return 0;
  }
  out(`${id}  (${analysis.file.rel})`);
  out("");
  out(`outgoing (${outgoing.length}):`);
  for (const ref of outgoing) {
    out(`  ${ref.field} -> ${ref.to}${ref.resolved ? ` (${ref.path})` : paint("red", " [not found]")}`);
  }
  if (outgoing.length === 0) out("  none");
  out("");
  out(`incoming (${incoming.length}):`);
  for (const ref of incoming) out(`  ${ref.from} <- ${ref.field} (${ref.path})`);
  if (incoming.length === 0) out("  none");
  return 0;
}

const FORMATS: ExportFormat[] = ["json", "jsonl", "csv", "sqlite"];

async function commandExport(args: string[]): Promise<number> {
  const { values } = parse(args, {
    format: { type: "string", default: "json" },
    out: { type: "string" },
    "with-body": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  });
  const format = String(values["format"]) as ExportFormat;
  if (!FORMATS.includes(format)) throw new UsageError(`unknown format "${format}", use ${FORMATS.join(", ")}`);
  const json = values["json"] === true;
  const root = await findRoot(process.cwd());
  const project = await loadProject(root, { full: true });
  const result = await lint(project);
  const { errors } = countLevels(result.diagnostics);
  if (errors > 0) err(`tmd: exporting a project with ${errors} lint error${errors === 1 ? "" : "s"}, run tmd lint`);

  const data = collect(result.analyses, values["with-body"] === true);
  const files = buildExport(data, format);
  let destination = typeof values["out"] === "string" ? values["out"] : null;
  if (destination === null && (format === "csv" || json)) destination = defaultOutName(format);

  if (destination === null) {
    for (const file of files) process.stdout.write(file.content);
    return 0;
  }

  const written: { path: string; bytes: number }[] = [];
  if (format === "csv") {
    await mkdir(destination, { recursive: true });
    for (const file of files) {
      const target = path.join(destination, file.name);
      await writeFile(target, file.content, "utf8");
      written.push({ path: target, bytes: Buffer.byteLength(file.content) });
    }
  } else {
    const content = files.map((file) => file.content).join("");
    await mkdir(path.dirname(path.resolve(destination)), { recursive: true });
    await writeFile(destination, content, "utf8");
    written.push({ path: destination, bytes: Buffer.byteLength(content) });
  }

  if (json) {
    out(JSON.stringify({ format, entities: data.rows.length, refs: data.edges.length, files: written }, null, 2));
    return 0;
  }
  for (const file of written) out(`wrote ${file.path} (${file.bytes} bytes)`);
  out(`${data.rows.length} entities, ${data.edges.length} references`);
  return 0;
}

async function commandGraph(args: string[]): Promise<number> {
  const { values } = parse(args, {
    format: { type: "string", default: "dot" },
    out: { type: "string" },
    json: { type: "boolean", default: false },
  });
  const format = values["json"] === true ? "json" : String(values["format"]);
  if (format !== "dot" && format !== "json") throw new UsageError(`unknown format "${format}", use dot or json`);
  const root = await findRoot(process.cwd());
  const project = await loadProject(root, { full: true });
  const result = await lint(project);
  const graph = buildGraph(result.analyses);
  const content = format === "json" ? JSON.stringify(graph, null, 2) + "\n" : toDot(graph);
  if (typeof values["out"] === "string") {
    await writeFile(values["out"], content, "utf8");
    out(`wrote ${values["out"]}`);
    return 0;
  }
  process.stdout.write(content);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const first = argv[0];
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    out(HELP);
    return 0;
  }
  if (first === "--version" || first === "-v" || first === "version") {
    out(VERSION);
    return 0;
  }
  const rest = argv.slice(1);
  switch (first) {
    case "lint":
      return await commandLint(rest);
    case "check":
      return await commandCheck(rest);
    case "schema":
      return await commandSchema(rest);
    case "new":
      return await commandNew(rest);
    case "refs":
      return await commandRefs(rest);
    case "export":
      return await commandExport(rest);
    case "graph":
      return await commandGraph(rest);
    default:
      throw new UsageError(`unknown command "${first}"`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1]);

if (isMain) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof UsageError) {
      err(`tmd: ${error.message}`);
      err("run tmd --help to see the commands");
      process.exitCode = 2;
    } else if (error instanceof ProjectError || error instanceof ConfigError) {
      err(`tmd: ${error.message}`);
      process.exitCode = 2;
    } else {
      err(`tmd: ${(error as Error).message}`);
      if (process.env["TMD_DEBUG"] === "1") err(String((error as Error).stack));
      process.exitCode = 2;
    }
  }
}

export { main };
