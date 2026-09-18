import { test, after } from "node:test";
import assert from "node:assert/strict";
import { splitName, loadProject, findRoot } from "../src/project.ts";
import { globToRegExp, isIncluded, parseConfig, ConfigError, DEFAULT_CONFIG } from "../src/config.ts";
import { lint } from "../src/lint.ts";
import { isPathForm } from "../src/refs.ts";
import { cleanup, makeProject, withSchemas } from "./helpers.ts";

after(cleanup);

test("the file name splits into a slug and a type", () => {
  assert.deepEqual(splitName("honda.car.md"), { slug: "honda", fileType: "car" });
  assert.deepEqual(splitName("civic-2019.car.md"), { slug: "civic-2019", fileType: "car" });
  assert.deepEqual(splitName("meeting-note.md"), { slug: "meeting-note", fileType: null });
  assert.deepEqual(splitName("README.md"), { slug: "README", fileType: null });
  assert.deepEqual(splitName("1782055272982.md"), { slug: "1782055272982", fileType: null });
});

test("a multi dot name keeps everything before the last segment as the slug", () => {
  assert.deepEqual(splitName("honda.civic.car.md"), { slug: "honda.civic", fileType: "car" });
  assert.deepEqual(splitName("a.b.c.engine.md"), { slug: "a.b.c", fileType: "engine" });
});

test("a last segment that is not a type name leaves the file untyped", () => {
  assert.deepEqual(splitName("notes.Draft.md"), { slug: "notes.Draft", fileType: null });
  assert.deepEqual(splitName("report.2026 Q1.md"), { slug: "report.2026 Q1", fileType: null });
  assert.deepEqual(splitName(".hidden.md"), { slug: ".hidden", fileType: null });
});

test("the type comes from the file name and the id is slug.type", async () => {
  const root = await makeProject(withSchemas({ "cars/honda.car.md": "---\nname: Honda\nyear: 2019\n---\n" }));
  const project = await loadProject(root, { full: true });
  const file = project.files.find((entry) => entry.rel === "cars/honda.car.md")!;
  assert.equal(file.type, "car");
  assert.equal(file.id, "honda.car");
  assert.ok(project.index.has("honda.car"));
});

test("the type can come from _type, and the id still uses the file name slug", async () => {
  const root = await makeProject(withSchemas({ "cars/mazda.md": "---\n_type: car\nname: Mazda\nyear: 2004\n---\n" }));
  const project = await loadProject(root, { full: true });
  const file = project.files.find((entry) => entry.rel === "cars/mazda.md")!;
  assert.equal(file.declaredType, "car");
  assert.equal(file.fileType, null);
  assert.equal(file.id, "mazda.car");
});

test("_type wins over the file name and the disagreement is W006", async () => {
  const root = await makeProject(
    withSchemas({ "cars/mx5.person.md": "---\n_type: car\nname: MX-5\nyear: 1998\n---\n" }),
  );
  const project = await loadProject(root, { full: true });
  const file = project.files[0]!;
  assert.equal(file.type, "car");
  assert.equal(file.id, "mx5.car");
  const result = await lint(project);
  const w006 = result.diagnostics.filter((item) => item.code === "W006");
  assert.equal(w006.length, 1);
  assert.match(w006[0]!.message, /file name says type "person" but _type says "car"/);
});

test("a _type that agrees with the file name reports nothing", async () => {
  const root = await makeProject(
    withSchemas({ "cars/honda.car.md": "---\n_type: car\nname: Honda\nyear: 2019\n---\n" }),
  );
  const result = await lint(await loadProject(await findRoot(root), { full: true }));
  assert.deepEqual(result.diagnostics, []);
});

test("an untyped file is ignored, or warned about when the config says so", async () => {
  const files = withSchemas({ "notes/random.md": "# A note\n\nNo frontmatter here.\n" });
  const quiet = await loadProject(await makeProject(files), { full: true });
  assert.deepEqual((await lint(quiet)).diagnostics, []);

  const loud = await loadProject(
    await makeProject({ ...files, ".tmd/config.yaml": "untyped: warn\nrefs:\n  orphans: ignore\n" }),
    { full: true },
  );
  const result = await lint(loud);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "W001");
});

test("two files with the same id are E006, and both are named", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/civic.car.md": "---\nname: Civic\nyear: 2019\n---\n",
      "archive/civic.car.md": "---\nname: Civic old\nyear: 2019\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const duplicates = result.diagnostics.filter((item) => item.code === "E006");
  assert.equal(duplicates.length, 2);
  assert.match(duplicates[0]!.message, /duplicate entity id "civic.car"/);
  assert.match(duplicates[0]!.message, /cars\/civic.car.md/);
});

test("the same slug under two types is not a duplicate", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/civic.car.md": "---\nname: Civic\nyear: 2019\n---\n",
      "engines/civic.engine.md": "---\nname: Civic engine\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(result.diagnostics.filter((item) => item.code === "E006"), []);
});

test("a reference value is read as an id or as a path", () => {
  assert.equal(isPathForm("k20.engine"), false);
  assert.equal(isPathForm("../engines/k20.engine.md"), true);
  assert.equal(isPathForm("engines/k20.engine.md"), true);
  assert.equal(isPathForm("./k20.engine.md"), true);
});

test("both reference forms resolve to the same entity", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/a.car.md": "---\nname: A\nyear: 2000\nengine: k20.engine\n---\n",
      "cars/b.car.md": "---\nname: B\nyear: 2000\nengine: ../engines/k20.engine.md\n---\n",
      "engines/k20.engine.md": "---\nname: K20\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const byFile = new Map(result.analyses.map((item) => [item.file.rel, item]));
  assert.equal(byFile.get("cars/a.car.md")!.refs[0]?.targetId, "k20.engine");
  assert.equal(byFile.get("cars/b.car.md")!.refs[0]?.targetId, "k20.engine");
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["W004"]);
});

test("a missing target is E004 with a did you mean hint", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/a.car.md": "---\nname: A\nyear: 2000\nengine: k21.engine\n---\n",
      "engines/k20.engine.md": "---\nname: K20\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const e004 = result.diagnostics.find((item) => item.code === "E004")!;
  assert.match(e004.message, /reference "k21.engine" not found/);
  assert.equal(e004.hint, "did you mean k20.engine?");
  assert.equal(e004.line, 4);
});

test("a target of the wrong type is E005", async () => {
  const root = await makeProject(
    withSchemas({
      "cars/a.car.md": "---\nname: A\nyear: 2000\nengine: alfonso.person\n---\n",
      "people/alfonso.person.md": "---\nname: Alfonso\n---\n",
    }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const e005 = result.diagnostics.find((item) => item.code === "E005")!;
  assert.equal(e005.message, "expected type engine, found person");
  assert.equal(e005.field, "engine");
});

test("a path reference is an error when refs.allow_paths is false", async () => {
  const root = await makeProject(
    withSchemas(
      {
        "cars/a.car.md": "---\nname: A\nyear: 2000\nengine: ../engines/k20.engine.md\n---\n",
        "engines/k20.engine.md": "---\nname: K20\n---\n",
      },
      "refs:\n  allow_paths: false\n  orphans: ignore\n",
    ),
  );
  const result = await lint(await loadProject(root, { full: true }));
  const e004 = result.diagnostics.find((item) => item.code === "E004")!;
  assert.match(e004.message, /paths are switched off/);
});

test("a self reference is E011 unless the schema allows it", async () => {
  const root = await makeProject(
    withSchemas({ "engines/k20.engine.md": "---\nname: K20\ntwin: k20.engine\n---\n" }),
  );
  const result = await lint(await loadProject(root, { full: true }));
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["E011"]);

  const selfSchema = JSON.stringify({
    title: "engine",
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" },
      twin: { type: "string", format: "tmd-ref", "x-tmd-ref": "engine", "x-tmd-ref-self": true },
    },
  });
  const allowedRoot = await makeProject({
    ...withSchemas({ "engines/k20.engine.md": "---\nname: K20\ntwin: k20.engine\n---\n" }),
    ".tmd/engine.schema.json": selfSchema,
  });
  assert.deepEqual((await lint(await loadProject(allowedRoot, { full: true }))).diagnostics, []);
});

test("orphans are only reported when the config asks for them", async () => {
  const files = {
    "cars/a.car.md": "---\nname: A\nyear: 2000\n---\n",
  };
  const quiet = await loadProject(await makeProject(withSchemas(files)), { full: true });
  assert.deepEqual((await lint(quiet)).diagnostics, []);

  const loud = await loadProject(
    await makeProject(withSchemas(files, "refs:\n  orphans: warn\n")),
    { full: true },
  );
  assert.deepEqual((await lint(loud)).diagnostics.map((item) => item.code), ["W002"]);
});

test("findRoot walks up to the folder that holds .tmd", async () => {
  const root = await makeProject(withSchemas({ "a/b/c/deep.car.md": "---\nname: A\nyear: 2000\n---\n" }));
  const found = await findRoot(`${root}/a/b/c`);
  assert.equal(found, root);
  await assert.rejects(() => findRoot("/"), /no .tmd\/ folder found/);
});

test("globs match the way the config expects", () => {
  assert.ok(globToRegExp("**/*.md").test("a.md"));
  assert.ok(globToRegExp("**/*.md").test("cars/honda.car.md"));
  assert.ok(globToRegExp("**/*.md").test("a/b/c/x.md"));
  assert.ok(!globToRegExp("**/*.md").test("a.txt"));
  assert.ok(globToRegExp("lake/**").test("lake/x/y.md"));
  assert.ok(!globToRegExp("lake/**").test("lakes/x.md"));
  assert.ok(globToRegExp("cars/*.md").test("cars/a.md"));
  assert.ok(!globToRegExp("cars/*.md").test("cars/deep/a.md"));
  assert.ok(globToRegExp("a?c.md").test("abc.md"));
});

test("include and exclude decide which files are scanned", () => {
  const config = { ...DEFAULT_CONFIG };
  assert.ok(isIncluded(config, "cars/honda.car.md"));
  assert.ok(!isIncluded(config, "lake/raw.md"));
  assert.ok(!isIncluded(config, "node_modules/pkg/readme.md"));
  assert.ok(!isIncluded(config, ".tmd/car.schema.json"));
});

test("the config is parsed, and bad settings fail loudly", () => {
  const config = parseConfig(
    "include: [\"docs/**/*.md\"]\nexclude: []\nuntyped: warn\ntype_in: frontmatter\nrefs:\n  allow_paths: false\n  orphans: ignore\nstrict: true\n",
  );
  assert.deepEqual(config, {
    include: ["docs/**/*.md"],
    exclude: [],
    untyped: "warn",
    type_in: "frontmatter",
    refs: { allow_paths: false, orphans: "ignore" },
    strict: true,
  });
  assert.deepEqual(parseConfig(""), DEFAULT_CONFIG);
  assert.throws(() => parseConfig("untyped: maybe\n"), ConfigError);
  assert.throws(() => parseConfig("strict: yes\n"), ConfigError);
  assert.throws(() => parseConfig("include: nope\n"), ConfigError);
  assert.throws(() => parseConfig("unknown_key: 1\n"), ConfigError);
  assert.throws(() => parseConfig("refs:\n  orphans: sometimes\n"), ConfigError);
});
