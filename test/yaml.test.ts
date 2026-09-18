import { test } from "node:test";
import assert from "node:assert/strict";
import { emitScalar, emitYaml, parseYaml, plainScalar, stripComment, YamlError } from "../src/yaml.ts";

function value(text: string): unknown {
  return parseYaml(text).value;
}

test("block mapping with plain scalars", () => {
  assert.deepEqual(value("name: Honda Civic\nyear: 2019\n"), { name: "Honda Civic", year: 2019 });
});

test("scalar types", () => {
  assert.deepEqual(
    value("a: 1\nb: -2\nc: 1.5\nd: 2e3\ne: true\nf: false\ng: null\nh: ~\ni:\nj: text\nk: 2026-09-18\n"),
    { a: 1, b: -2, c: 1.5, d: 2000, e: true, f: false, g: null, h: null, i: null, j: "text", k: "2026-09-18" },
  );
});

test("plainScalar keeps a big integer as a string", () => {
  assert.equal(plainScalar("1782055272982"), 1782055272982);
  assert.equal(plainScalar("123456789012345678901234567890"), "123456789012345678901234567890");
  assert.equal(plainScalar("yes"), "yes");
});

test("nested block mappings at any depth", () => {
  const text = "specs:\n  power:\n    value: 158\n    unit: hp\n  weight:\n    value: 1300\n    unit: kg\n";
  assert.deepEqual(value(text), {
    specs: { power: { value: 158, unit: "hp" }, weight: { value: 1300, unit: "kg" } },
  });
});

test("block sequences, indented and at the parent indent", () => {
  assert.deepEqual(value("tags:\n  - daily\n  - reliable\n"), { tags: ["daily", "reliable"] });
  assert.deepEqual(value("tags:\n- daily\n- reliable\n"), { tags: ["daily", "reliable"] });
});

test("block sequence of mappings", () => {
  const text = "owners:\n  - person: alfonso.person\n    since: 2021\n  - person: marta.person\n    since: 2023\n";
  assert.deepEqual(value(text), {
    owners: [
      { person: "alfonso.person", since: 2021 },
      { person: "marta.person", since: 2023 },
    ],
  });
});

test("nested sequences", () => {
  assert.deepEqual(value("matrix:\n  - - 1\n    - 2\n  - - 3\n"), { matrix: [[1, 2], [3]] });
});

test("sequence item with a nested block", () => {
  assert.deepEqual(value("items:\n  -\n    name: a\n"), { items: [{ name: "a" }] });
});

test("flow mappings and flow sequences", () => {
  assert.deepEqual(value("power: { value: 158, unit: hp }\n"), { power: { value: 158, unit: "hp" } });
  assert.deepEqual(value("tags: [a, b, c]\n"), { tags: ["a", "b", "c"] });
  assert.deepEqual(value("empty: []\nblank: {}\n"), { empty: [], blank: {} });
  assert.deepEqual(value("mix: [{ a: 1 }, { b: [2, 3] }]\n"), { mix: [{ a: 1 }, { b: [2, 3] }] });
});

test("quoted strings", () => {
  assert.deepEqual(value(`a: "he said \\"hi\\""\nb: 'it''s here'\nc: "2019"\nd: "line\\nbreak"\n`), {
    a: 'he said "hi"',
    b: "it's here",
    c: "2019",
    d: "line\nbreak",
  });
});

test("quoted keys", () => {
  assert.deepEqual(value(`"my key": 1\n'other key': 2\n`), { "my key": 1, "other key": 2 });
});

test("comments and blank lines", () => {
  const text = "# a comment\n\nname: Honda   # trailing comment\n\n# another\nyear: 2019\n";
  assert.deepEqual(value(text), { name: "Honda", year: 2019 });
});

test("a hash that is not a comment stays in the value", () => {
  assert.deepEqual(value('url: "http://x/#y"\ntag: a#b\n'), { url: "http://x/#y", tag: "a#b" });
  assert.equal(stripComment("a: b # c"), "a: b ");
});

test("line numbers are reported for every key", () => {
  const text = ["name: Honda", "specs:", "  power:", "    value: 158", "tags: [a, b]"].join("\n");
  const result = parseYaml(text, 2);
  assert.equal(result.lines.get("name"), 2);
  assert.equal(result.lines.get("specs"), 3);
  assert.equal(result.lines.get("specs.power"), 4);
  assert.equal(result.lines.get("specs.power.value"), 5);
  assert.equal(result.lines.get("tags"), 6);
  assert.equal(result.lines.get("tags.0"), 6);
  assert.equal(result.lines.get("tags.1"), 6);
});

test("line numbers for sequence items", () => {
  const result = parseYaml("owners:\n  - a\n  - b\n", 1);
  assert.equal(result.lines.get("owners.0"), 2);
  assert.equal(result.lines.get("owners.1"), 3);
});

test("an empty document is an empty mapping", () => {
  assert.deepEqual(value(""), {});
  assert.deepEqual(value("# only a comment\n"), {});
});

test("a top level sequence parses as a list", () => {
  assert.deepEqual(value("- a\n- b\n"), ["a", "b"]);
});

function failure(text: string): YamlError {
  try {
    parseYaml(text);
  } catch (error) {
    assert.ok(error instanceof YamlError, `expected a YamlError, got ${String(error)}`);
    return error;
  }
  throw new Error(`expected "${text}" to fail`);
}

test("block scalars fail with a clear message", () => {
  const error = failure("notes: |\n  hello\n");
  assert.match(error.message, /block scalars/);
  assert.equal(error.line, 1);
  assert.match(failure("notes: >-\n  hello\n").message, /block scalars/);
});

test("anchors, aliases, tags and merge keys fail", () => {
  assert.match(failure("a: &anchor 1\n").message, /anchors/);
  assert.match(failure("a: *anchor\n").message, /aliases/);
  assert.match(failure("a: !!str 1\n").message, /tags/);
  assert.match(failure("<<: other\n").message, /merge keys/);
});

test("other unsupported input fails instead of being mis-parsed", () => {
  assert.match(failure("a: 1\n\tb: 2\n").message, /tabs/);
  assert.match(failure("a: 1\n---\nb: 2\n").message, /multiple YAML documents/);
  assert.match(failure("? key\n").message, /explicit keys/);
  assert.match(failure("a: [1, 2\n").message, /unterminated flow sequence/);
  assert.match(failure("a: { b: 1\n").message, /unterminated flow mapping/);
  assert.match(failure('a: "unterminated\n').message, /unterminated quoted string/);
  assert.match(failure("a: 1\na: 2\n").message, /duplicate key/);
  assert.match(failure("just text\n").message, /expected "key: value"/);
  assert.match(failure("a: 1\n    b: 2\n").message, /unexpected indentation/);
});

test("emitScalar round trips through the parser", () => {
  const cases: [unknown, string][] = [
    ["TODO", "TODO"],
    ["2019", '"2019"'],
    ["true", '"true"'],
    ["", '""'],
    ["a: b", '"a: b"'],
    ["Honda Civic", "Honda Civic"],
    [42, "42"],
    [null, "null"],
    [false, "false"],
    [[1, 2], "[1, 2]"],
    [{}, "{}"],
    [{ value: 158, unit: "hp" }, "{ value: 158, unit: hp }"],
  ];
  for (const [input, expected] of cases) {
    const text = emitScalar(input as never);
    assert.equal(text, expected, `emitScalar(${JSON.stringify(input)})`);
    assert.deepEqual((parseYaml(`k: ${text}\n`).value as { k: unknown }).k, input);
  }
});

test("emitYaml writes blocks the parser reads back", () => {
  const input = { name: "Honda", specs: { power: { value: 158, unit: "hp" } }, tags: ["a", "b"] };
  const text = emitYaml(input as never);
  assert.deepEqual(parseYaml(text).value, input);
});
