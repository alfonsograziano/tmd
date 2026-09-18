/** End to end tests: the real CLI, as a subprocess, against fixture projects. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, codesIn, copyFixture, runCli } from "./helpers.ts";

after(cleanup);

test("a clean project lints green and exits 0", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["lint"], root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), "0 errors, 0 warnings in 7 files");
});

test("a clean project is also green with --strict and with --json", async () => {
  const root = await copyFixture("clean");
  const strict = await runCli(["lint", "--strict"], root);
  assert.equal(strict.code, 0);
  const json = await runCli(["lint", "--json"], root);
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), []);
});

test("linting one file only reports that file", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["lint", "cars/honda.car.md"], root);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "0 errors, 0 warnings in 1 file");
});

test("linting a folder walks it", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["lint", "cars"], root);
  assert.equal(result.stdout.trim(), "0 errors, 0 warnings in 2 files");
});

test("the broken project triggers every code at least once", async () => {
  const root = await copyFixture("broken");
  const result = await runCli(["lint"], root);
  assert.equal(result.code, 1);
  const codes = new Set(codesIn(result.stdout));
  for (const code of [
    "E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008", "E009", "E010", "E011",
    "W001", "W002", "W003", "W004", "W005", "W006", "W007",
  ]) {
    assert.ok(codes.has(code), `expected ${code} in the lint output`);
  }
});

test("--json returns the shape the spec defines", async () => {
  const root = await copyFixture("broken");
  const result = await runCli(["lint", "--json"], root);
  assert.equal(result.code, 1);
  const items = JSON.parse(result.stdout) as Record<string, unknown>[];
  assert.ok(items.length > 20);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ["code", "field", "hint", "level", "line", "message", "path"]);
    assert.equal(typeof item["path"], "string");
    assert.ok(item["line"] === null || typeof item["line"] === "number");
    assert.match(String(item["code"]), /^[EW]\d{3}$/);
    assert.ok(item["level"] === "error" || item["level"] === "warn");
    assert.equal(typeof item["message"], "string");
  }
  const e004 = items.find((item) => item["code"] === "E004")!;
  assert.equal(e004["path"], "cars/civic.car.md");
  assert.equal(e004["field"], "engine");
  assert.equal(e004["hint"], "did you mean k20.engine?");
});

test("the human output puts the file, the line and the code on one line", async () => {
  const root = await copyFixture("broken");
  const result = await runCli(["lint", "cars/civic.car.md"], root);
  assert.match(result.stdout, /cars\/civic\.car\.md:4: E004 engine: reference "k21\.engine" not found/);
  assert.match(result.stdout, /cars\/civic\.car\.md:1: E002 year: missing required field "year" \(integer, The model year\.\)/);
});

test("--strict turns warnings into a failing exit code", async () => {
  const root = await copyFixture("clean");
  await writeFile(
    path.join(root, "cars", "orphan.car.md"),
    "---\nyear: 2001\nname: Orphan\ncreated: 2026-03-01\n---\n\n# Orphan\n\n## Notes\n\nOut of order on purpose.\n",
    "utf8",
  );
  const plain = await runCli(["lint", "cars/orphan.car.md"], root);
  assert.equal(plain.code, 0);
  assert.match(plain.stdout, /W005/);
  const strict = await runCli(["lint", "cars/orphan.car.md", "--strict"], root);
  assert.equal(strict.code, 1);
});

test("check lists the optional fields that are not set", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["check", "cars/mazda.md"], root);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /0 errors, 0 warnings in 1 file/);
  assert.match(result.stdout, /optional fields not set \(1\)/);
  assert.match(result.stdout, /specs\s+object/);
  assert.match(result.stdout, /Numbers with units\./);
});

test("check --json carries the diagnostics and the optional fields", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["check", "cars/mazda.md", "--json"], root);
  const payload = JSON.parse(result.stdout) as { path: string; diagnostics: unknown[]; optional: { field: string }[] };
  assert.equal(payload.path, "cars/mazda.md");
  assert.deepEqual(payload.diagnostics, []);
  assert.deepEqual(payload.optional.map((item) => item.field), ["specs"]);
});

test("schema list counts the files of every type", async () => {
  const root = await copyFixture("clean");
  const human = await runCli(["schema", "list"], root);
  assert.match(human.stdout, /car\s+2\s+\.tmd\/car\.schema\.json/);
  assert.match(human.stdout, /common schema: \.tmd\/_common\.schema\.json/);
  const json = await runCli(["schema", "list", "--json"], root);
  const rows = JSON.parse(json.stdout) as { type: string; files: number; plural: string }[];
  assert.deepEqual(rows.map((row) => row.type), ["car", "engine", "person"]);
  assert.deepEqual(rows.map((row) => row.files), [2, 2, 2]);
  assert.equal(rows[2]?.plural, "people");
});

test("schema show prints the schema and its example file", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["schema", "show", "car"], root);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /"title": "car"/);
  assert.match(result.stdout, /# example: cars\/honda\.car\.md/);
  assert.match(result.stdout, /name: Honda Civic/);
  const missing = await runCli(["schema", "show", "spaceship"], root);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /no schema for type "spaceship"/);
});

test("new creates a file that lints clean", async () => {
  const root = await copyFixture("clean");
  const created = await runCli(["new", "car", "civic-2020", "cars"], root);
  assert.equal(created.code, 0);
  assert.equal(created.stdout.trim(), "created cars/civic-2020.car.md");
  const text = await readFile(path.join(root, "cars", "civic-2020.car.md"), "utf8");
  assert.match(text, /^---\nname: Civic 2020/);
  assert.match(text, /created: 2026-09-18/);
  assert.match(text, /# Optional fields/);
  assert.match(text, /## Notes/);
  const linted = await runCli(["lint", "cars/civic-2020.car.md"], root);
  assert.equal(linted.code, 0, linted.stdout);
  assert.equal(linted.stdout.trim(), "0 errors, 0 warnings in 1 file");
  const again = await runCli(["new", "car", "civic-2020", "cars"], root);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);
});

test("new writes _type when the config says type_in: frontmatter", async () => {
  const root = await copyFixture("frontmatter-type");
  const created = await runCli(["new", "task", "1782055272999", "tasks", "--json"], root);
  const payload = JSON.parse(created.stdout) as { path: string; id: string };
  assert.equal(payload.path, "tasks/1782055272999.md");
  assert.equal(payload.id, "1782055272999.task");
  const text = await readFile(path.join(root, payload.path), "utf8");
  assert.match(text, /^---\n_type: task\n/);
  const linted = await runCli(["lint", payload.path], root);
  assert.equal(linted.code, 0, linted.stdout);
});

test("--fix repairs W004 and W005 and leaves the file valid", async () => {
  const root = await copyFixture("clean");
  const file = path.join(root, "cars", "messy.car.md");
  await writeFile(
    file,
    [
      "---",
      "year: 2001",
      "created: 2026-03-01",
      "name: Messy",
      "engine: ../engines/k20.engine.md",
      "---",
      "",
      "# Messy",
      "",
      "## Notes",
      "",
      "Body text stays.",
      "",
    ].join("\n"),
    "utf8",
  );
  const before = await runCli(["lint", "cars/messy.car.md"], root);
  assert.deepEqual([...new Set(codesIn(before.stdout))].sort(), ["W004", "W005"]);

  const fixed = await runCli(["lint", "cars/messy.car.md", "--fix"], root);
  assert.equal(fixed.code, 0);
  assert.match(fixed.stdout, /fixed 1 file:/);
  assert.match(fixed.stdout, /cars\/messy\.car\.md \(W004, W005\)/);
  assert.match(fixed.stdout, /0 errors, 0 warnings in 1 file/);

  const text = await readFile(file, "utf8");
  assert.equal(
    text,
    ["---", "name: Messy", "year: 2001", "engine: k20.engine", "created: 2026-03-01", "---", "", "# Messy", "", "## Notes", "", "Body text stays.", ""].join("\n"),
  );
  const after2 = await runCli(["lint"], root);
  assert.equal(after2.code, 0, after2.stdout);
});

test("--fix --scaffold adds the missing required fields", async () => {
  const root = await copyFixture("clean");
  await writeFile(path.join(root, "cars", "stub.car.md"), "---\nstatus: owned\n---\n\n# Stub\n\n## Notes\n", "utf8");
  const result = await runCli(["lint", "cars/stub.car.md", "--fix", "--scaffold"], root);
  const text = await readFile(path.join(root, "cars", "stub.car.md"), "utf8");
  assert.match(text, /name: TODO/);
  assert.match(text, /year: 1886/);
  assert.match(text, /created: 2026-09-18/);
  assert.match(result.stdout, /\(E002, W005\)/);
});

test("refs prints outgoing and incoming links", async () => {
  const root = await copyFixture("clean");
  const human = await runCli(["refs", "k20.engine"], root);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /k20\.engine {2}\(engines\/k20\.engine\.md\)/);
  assert.match(human.stdout, /incoming \(1\):\n {2}honda\.car <- engine \(cars\/honda\.car\.md\)/);

  const json = await runCli(["refs", "cars/honda.car.md", "--json"], root);
  const payload = JSON.parse(json.stdout) as {
    id: string;
    outgoing: { field: string; to: string; resolved: boolean }[];
    incoming: { from: string; field: string }[];
  };
  assert.equal(payload.id, "honda.car");
  assert.deepEqual(payload.outgoing, [
    { field: "engine", to: "k20.engine", path: "engines/k20.engine.md", resolved: true },
    { field: "owners.0", to: "alfonso.person", path: "people/alfonso.person.md", resolved: true },
  ] as unknown);
  assert.deepEqual(payload.incoming, [{ from: "alfonso.person", field: "drives.0", path: "people/alfonso.person.md" }] as unknown);

  const missing = await runCli(["refs", "nope.car"], root);
  assert.equal(missing.code, 2);
});

test("export --format json", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["export", "--format", "json"], root);
  assert.equal(result.code, 0);
  const rows = JSON.parse(result.stdout) as Record<string, unknown>[];
  assert.equal(rows.length, 6);
  const honda = rows.find((row) => row["_id"] === "honda.car")!;
  assert.equal(honda["_type"], "car");
  assert.equal(honda["_path"], "cars/honda.car.md");
  assert.equal(honda["name"], "Honda Civic");
  assert.deepEqual(honda["specs"], { power: { value: 158, unit: "hp" }, weight: { value: 1300, unit: "kg" } });
  assert.equal(honda["_body"], undefined);
});

test("export --format jsonl, with the body", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["export", "--format", "jsonl", "--with-body"], root);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 6);
  const rows = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(rows[0]?.["_id"], "13b.engine");
  assert.match(String(rows.find((row) => row["_id"] === "honda.car")?.["_body"]), /# Honda Civic/);
});

test("export --format csv writes one file per type", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["export", "--format", "csv", "--out", "out"], root);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /wrote out\/cars\.csv/);
  assert.match(result.stdout, /6 entities, 5 references/);
  const cars = await readFile(path.join(root, "out", "cars.csv"), "utf8");
  const [header, honda] = cars.trim().split("\n");
  assert.equal(
    header,
    "_id,_type,_path,created,engine,name,owners,specs.power.unit,specs.power.value,specs.weight.unit,specs.weight.value,status,tags,year",
  );
  assert.match(String(honda), /^honda\.car,car,cars\/honda\.car\.md,2026-01-12,k20\.engine,Honda Civic,alfonso\.person,hp,158,kg,1300,owned,daily;reliable,2019$/);
});

test("export --format sqlite writes a SQL script with a refs table", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["export", "--format", "sqlite"], root);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /BEGIN TRANSACTION;/);
  assert.match(result.stdout, /CREATE TABLE "cars"/);
  assert.match(result.stdout, /CREATE TABLE "people"/);
  assert.match(result.stdout, /CREATE TABLE "refs"/);
  assert.match(result.stdout, /INSERT INTO "refs" \("from_id", "field", "to_id"\) VALUES \('honda\.car', 'engine', 'k20\.engine'\);/);
  assert.match(result.stdout, /COMMIT;/);
});

test("export --json reports what it wrote", async () => {
  const root = await copyFixture("clean");
  const result = await runCli(["export", "--format", "jsonl", "--json", "--out", "data.jsonl"], root);
  const payload = JSON.parse(result.stdout) as { format: string; entities: number; files: { path: string }[] };
  assert.equal(payload.format, "jsonl");
  assert.equal(payload.entities, 6);
  assert.equal(payload.files[0]?.path, "data.jsonl");
  const text = await readFile(path.join(root, "data.jsonl"), "utf8");
  assert.equal(text.trim().split("\n").length, 6);
});

test("graph gives dot and json", async () => {
  const root = await copyFixture("clean");
  const dot = await runCli(["graph"], root);
  assert.match(dot.stdout, /^digraph tmd \{/);
  assert.match(dot.stdout, /"honda\.car" -> "k20\.engine" \[label="engine"\];/);
  const json = await runCli(["graph", "--format", "json"], root);
  const graph = JSON.parse(json.stdout) as { nodes: unknown[]; edges: { from: string; to: string }[] };
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 5);
});

test("the tool failing is exit code 2, not 1", async () => {
  const empty = await copyFixture("clean");
  const outside = await runCli(["lint"], path.dirname(empty));
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /no \.tmd\/ folder found/);

  const root = await copyFixture("clean");
  assert.equal((await runCli(["wat"], root)).code, 2);
  assert.equal((await runCli(["lint", "--nope"], root)).code, 2);
  assert.equal((await runCli(["check"], root)).code, 2);
  assert.equal((await runCli(["export", "--format", "xml"], root)).code, 2);
  assert.equal((await runCli(["lint", "does-not-exist.car.md"], root)).code, 2);
});

test("a broken config file fails with exit code 2", async () => {
  const root = await copyFixture("clean");
  await writeFile(path.join(root, ".tmd", "config.yaml"), "untyped: maybe\n", "utf8");
  const result = await runCli(["lint"], root);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /untyped must be one of ignore, warn/);
});

test("help and version work", async () => {
  const root = await copyFixture("clean");
  const help = await runCli([], root);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /tmd lint \[path\.\.\.\]/);
  assert.equal((await runCli(["--version"], root)).stdout.trim(), "0.1.0");
});

test("the three command agent loop works end to end", async () => {
  const root = await copyFixture("clean");
  const schema = await runCli(["schema", "show", "car", "--json"], root);
  assert.equal(schema.code, 0);
  const created = await runCli(["new", "car", "supra", "cars", "--json"], root);
  const { path: created_path } = JSON.parse(created.stdout) as { path: string };
  const text = await readFile(path.join(root, created_path), "utf8");
  await writeFile(
    path.join(root, created_path),
    text.replace("name: Supra", "name: Toyota Supra").replace("year: 1886", "year: 1998"),
    "utf8",
  );
  const linted = await runCli(["lint", created_path, "--json"], root);
  assert.equal(linted.code, 0);
  assert.deepEqual(JSON.parse(linted.stdout), []);
});
