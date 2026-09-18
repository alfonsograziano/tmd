import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../src/project.ts";
import { expectedOrder, lint, missingOptionalFields, withoutReserved } from "../src/lint.ts";
import { fixFile, placeholder } from "../src/fix.ts";
import { parseFrontmatter, bodyHeadings } from "../src/frontmatter.ts";
import { renderNewFile, fileNameFor } from "../src/new.ts";
import { cleanup, makeProject, withSchemas } from "./helpers.ts";

after(cleanup);

async function analyzeOne(files: { [key: string]: string }, target: string) {
  const root = await makeProject(withSchemas(files));
  const project = await loadProject(root, { full: true });
  const result = await lint(project);
  const analysis = result.analyses.find((item) => item.file.rel === target)!;
  return { project, analysis, result };
}

test("the frontmatter block is split from the body", () => {
  const parsed = parseFrontmatter("---\nname: A\n---\n\n# Title\n\nBody.\n");
  assert.deepEqual(parsed.data, { name: "A" });
  assert.equal(parsed.startLine, 2);
  assert.equal(parsed.endLine, 3);
  assert.equal(parsed.body, "\n# Title\n\nBody.\n");
  assert.equal(parsed.error, null);
});

test("missing, unclosed and non mapping frontmatter are all reported", () => {
  assert.match(parseFrontmatter("# just a note\n").error!.message, /frontmatter is missing/);
  assert.match(parseFrontmatter("---\nname: A\n").error!.message, /never closed/);
  assert.match(parseFrontmatter("---\n- a\n- b\n---\n").error!.message, /must be a mapping/);
  assert.match(parseFrontmatter("---\nname: |\n  block\n---\n").error!.message, /block scalars/);
});

test("headings are read from the body, and code fences are skipped", () => {
  const body = "# Title\n\n```\n## Not a heading\n```\n\n## Notes\n\ntext\n### Deep\n";
  assert.deepEqual(bodyHeadings(body), ["Title", "Notes", "Deep"]);
});

test("reserved keys never reach the validator", () => {
  assert.deepEqual(withoutReserved({ _type: "car", name: "A", _other: 1 }), { name: "A" });
});

test("the expected field order puts _type first, then the schema order", () => {
  assert.deepEqual(expectedOrder(["year", "name", "_type"], ["name", "year", "status"]), ["_type", "name", "year"]);
  assert.deepEqual(expectedOrder(["extra", "name"], ["name", "year"]), ["name", "extra"]);
});

test("W005 fires when the order is wrong and --fix puts it right", async () => {
  const { project, analysis, result } = await analyzeOne(
    { "cars/a.car.md": "---\nyear: 2000\nstatus: owned\nname: A\n---\n\n# A\n" },
    "cars/a.car.md",
  );
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["W005"]);
  const fixed = fixFile(project, analysis);
  assert.ok(fixed.changed);
  assert.deepEqual(fixed.applied, ["W005"]);
  assert.equal(fixed.text, "---\nname: A\nyear: 2000\nstatus: owned\n---\n\n# A\n");
});

test("--fix moves _type to the first line", async () => {
  const { project, analysis } = await analyzeOne(
    { "cars/a.md": "---\nname: A\nyear: 2000\n_type: car\n---\n\n# A\n" },
    "cars/a.md",
  );
  const fixed = fixFile(project, analysis);
  assert.equal(fixed.text, "---\n_type: car\nname: A\nyear: 2000\n---\n\n# A\n");
});

test("--fix rewrites a path reference to an id and leaves everything else alone", async () => {
  const { project, analysis, result } = await analyzeOne(
    {
      "cars/a.car.md": "---\nname: A\nyear: 2000\n# a comment that must survive\nengine: ../engines/k20.engine.md\nowners: ['../people/p.person.md']\n---\n\n# A\n",
      "engines/k20.engine.md": "---\nname: K20\n---\n",
      "people/p.person.md": "---\nname: P\n---\n",
    },
    "cars/a.car.md",
  );
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["W004", "W004"]);
  const fixed = fixFile(project, analysis);
  assert.deepEqual(fixed.applied, ["W004"]);
  assert.match(fixed.text, /# a comment that must survive/);
  assert.match(fixed.text, /engine: k20\.engine/);
  assert.match(fixed.text, /owners: \['p\.person'\]/);
});

test("the fixed file lints clean", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/a.car.md": "---\nyear: 2000\nengine: ../engines/k20.engine.md\nname: A\n---\n\n# A\n",
      "engines/k20.engine.md": "---\nname: K20\n---\n",
    }),
  );
  const project = await loadProject(root, { full: true });
  const before = await lint(project);
  assert.deepEqual(before.diagnostics.map((item) => item.code).sort(), ["W004", "W005"]);
  const analysis = before.analyses.find((item) => item.file.rel === "cars/a.car.md")!;
  const fixed = fixFile(project, analysis);
  await (await import("node:fs/promises")).writeFile(analysis.file.abs, fixed.text, "utf8");
  const after2 = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(after2.diagnostics, []);
});

test("--scaffold adds the required fields that are missing", async () => {
  const { project, analysis } = await analyzeOne({ "cars/a.car.md": "---\nstatus: owned\n---\n\n# A\n" }, "cars/a.car.md");
  const fixed = fixFile(project, analysis, { scaffold: true });
  assert.deepEqual(fixed.applied, ["E002", "W005"]);
  assert.match(fixed.text, /name: TODO/);
  assert.match(fixed.text, /year: 1886/);
  assert.equal(fixed.text.indexOf("name:") < fixed.text.indexOf("status:"), true);
});

test("a file with nothing to fix is left byte for byte", async () => {
  const { project, analysis } = await analyzeOne(
    { "cars/a.car.md": "---\nname: A\nyear: 2000\n---\n\n# A\n" },
    "cars/a.car.md",
  );
  const fixed = fixFile(project, analysis);
  assert.equal(fixed.changed, false);
  assert.deepEqual(fixed.applied, []);
});

test("placeholders follow the schema", () => {
  assert.equal(placeholder({ type: "string" }), "TODO");
  assert.equal(placeholder({ type: "integer", minimum: 1886 }), 1886);
  assert.equal(placeholder({ type: "integer", exclusiveMinimum: 0 }), 1);
  assert.equal(placeholder({ type: "number" }), 0);
  assert.equal(placeholder({ type: "boolean" }), false);
  assert.deepEqual(placeholder({ type: "array" }), []);
  assert.deepEqual(placeholder({ type: "object" }), {});
  assert.equal(placeholder({ enum: ["owned", "sold"] }), "owned");
  assert.equal(placeholder({ type: "string", default: "x" }), "x");
  assert.match(String(placeholder({ type: "string", format: "date" })), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(placeholder({ type: "string", format: "tmd-ref" }), "TODO.type");
});

test("E009 fires when a required section is missing from the body", async () => {
  const schema = JSON.stringify({
    title: "car",
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
    "x-tmd": { sections: ["Notes", "Log"] },
  });
  const root = await makeProject({
    ...withSchemas({ "cars/a.car.md": "---\nname: A\n---\n\n# A\n\n## Notes\n\ntext\n" }),
    ".tmd/car.schema.json": schema,
  });
  const result = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["E009"]);
  assert.match(result.diagnostics[0]!.message, /missing the required section "Log"/);
});

test("E001 names the missing schema, E007 catches a bad _type", async () => {
  const root = await makeProject(
    withSchemas({
      "a.vehicle.md": "---\nname: A\n---\n",
      "b.md": "---\n_type: Not A Type\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const codes = result.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("E001"));
  assert.ok(codes.includes("E007"));
});

test("W003 only fires once the deprecation date has passed", async () => {
  const schema = JSON.stringify({
    title: "car",
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      old: { type: "string", "x-tmd": { deprecated: "2020-01-01" } },
      future: { type: "string", "x-tmd": { deprecated: "2999-01-01" } },
    },
  });
  const root = await makeProject({
    ...withSchemas({ "cars/a.car.md": "---\nname: A\nold: x\nfuture: y\n---\n" }),
    ".tmd/car.schema.json": schema,
  });
  const result = await lint(await loadProject(root, { full: true }));
  const w003 = result.diagnostics.filter((item) => item.code === "W003");
  assert.equal(w003.length, 1);
  assert.equal(w003[0]?.field, "old");
});

test("W007 flags a slug that is not a plain slug", async () => {
  const root = await makeProject(withSchemas({ "cars/My_Car.car.md": "---\nname: A\nyear: 2000\n---\n" }));
  const result = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["W007"]);
});

test("the common schema applies to every type", async () => {
  const common = JSON.stringify({
    title: "_common",
    type: "object",
    required: ["created"],
    properties: { created: { type: "string", format: "date", description: "The day it was written." } },
  });
  const root = await makeProject({
    ...withSchemas({ "engines/k20.engine.md": "---\nname: K20\n---\n" }),
    ".tmd/_common.schema.json": common,
  });
  const result = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["E002"]);
  assert.match(result.diagnostics[0]!.message, /missing required field "created" \(string, The day it was written\.\)/);
});

test("check lists the optional fields that are not set", async () => {
  const { project, analysis } = await analyzeOne(
    { "cars/a.car.md": "---\nname: A\nyear: 2000\n---\n" },
    "cars/a.car.md",
  );
  const optional = missingOptionalFields(project, analysis);
  assert.deepEqual(optional.map((item) => item.field), ["status", "engine", "owners"]);
  assert.deepEqual(optional[0]?.enum, ["owned", "sold", "wishlist"]);
  assert.equal(optional[0]?.default, "owned");
  assert.equal(optional[1]?.ref, "engine");
});

test("tmd new writes a file that follows the schema", async () => {
  const root = await makeProject(withSchemas({}));
  const project = await loadProject(root, { full: true });
  const schema = project.schemas.byType.get("car")!;
  const input = { schema, common: project.schemas.common, slug: "civic-2020", typeInFrontmatter: false };
  assert.equal(fileNameFor(input), "civic-2020.car.md");
  const text = renderNewFile(input);
  assert.match(text, /^---\nname: Civic 2020/);
  assert.match(text, /year: 1886/);
  assert.match(text, /# status: owned/);
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.data, { name: "Civic 2020", year: 1886 });

  const withType = renderNewFile({ ...input, typeInFrontmatter: true });
  assert.equal(fileNameFor({ ...input, typeInFrontmatter: true }), "civic-2020.md");
  assert.equal(parseFrontmatter(withType).data?.["_type"], "car");
});
