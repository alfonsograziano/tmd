import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSchema, nearest, resolvePointer, validate, type Json, type Schema } from "../src/jsonschema.ts";

function messages(schema: Schema, value: Json): string[] {
  return validate(schema, value).issues.map((issue) => `${issue.field ?? "."}: ${issue.message}`);
}

test("type checks name the field, what was expected and what was found", () => {
  const schema: Schema = { type: "object", properties: { year: { type: "integer" } } };
  assert.deepEqual(messages(schema, { year: "2019" }), ['year: expected integer, got string "2019"']);
  assert.deepEqual(messages(schema, { year: 1.5 }), ["year: expected integer, got number 1.5"]);
  assert.deepEqual(messages(schema, { year: 2019 }), []);
});

test("every simple type is understood", () => {
  const cases: [string, Json, boolean][] = [
    ["string", "a", true],
    ["string", 1, false],
    ["number", 1.5, true],
    ["integer", 2, true],
    ["boolean", true, true],
    ["null", null, true],
    ["array", [], true],
    ["object", {}, true],
    ["object", [], false],
  ];
  for (const [type, value, ok] of cases) {
    assert.equal(validate({ type }, value).issues.length === 0, ok, `${type} with ${JSON.stringify(value)}`);
  }
});

test("a list of types passes when any of them matches", () => {
  assert.deepEqual(messages({ type: ["string", "number"] }, 1), []);
  assert.equal(validate({ type: ["string", "number"] }, true).issues.length, 1);
});

test("required is reported apart from other failures", () => {
  const schema: Schema = {
    type: "object",
    required: ["name", "year"],
    properties: { year: { type: "integer", description: "The model year." } },
  };
  const result = validate(schema, { name: "Honda" });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.kind, "required");
  assert.match(result.issues[0]!.message, /missing required field "year" \(integer, The model year\.\)/);
});

test("additionalProperties false rejects extra fields and suggests a near name", () => {
  const schema: Schema = { type: "object", additionalProperties: false, properties: { colour: {} } };
  const result = validate(schema, { color: "blue" });
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0]!.message, /unknown field "color"/);
  assert.equal(result.issues[0]!.hint, 'did you mean "colour"?');
});

test("additionalProperties as a schema validates the extra fields", () => {
  const schema: Schema = { type: "object", properties: {}, additionalProperties: { type: "string" } };
  assert.deepEqual(messages(schema, { a: "x" }), []);
  assert.deepEqual(messages(schema, { a: 1 }), ["a: expected string, got number 1"]);
});

test("enum and const", () => {
  assert.deepEqual(messages({ enum: ["owned", "sold"] }, "running"), [
    '.: expected one of "owned", "sold", got string "running"',
  ]);
  assert.deepEqual(messages({ enum: ["owned", "sold"] }, "sold"), []);
  assert.deepEqual(messages({ const: "car" }, "van"), ['.: expected the constant "car", got string "van"']);
});

test("number ranges", () => {
  assert.deepEqual(messages({ minimum: 1886 }, 1200), [".: expected a value >= 1886, got 1200"]);
  assert.deepEqual(messages({ maximum: 10 }, 11), [".: expected a value <= 10, got 11"]);
  assert.deepEqual(messages({ exclusiveMinimum: 0 }, 0), [".: expected a value > 0, got 0"]);
  assert.deepEqual(messages({ exclusiveMaximum: 10 }, 10), [".: expected a value < 10, got 10"]);
  assert.deepEqual(messages({ minimum: 1886, maximum: 2100 }, 2019), []);
});

test("string length and pattern", () => {
  assert.deepEqual(messages({ minLength: 1 }, ""), [".: expected at least 1 character, got 0"]);
  assert.deepEqual(messages({ maxLength: 2 }, "abc"), [".: expected at most 2 characters, got 3"]);
  assert.deepEqual(messages({ pattern: "^[a-z]+$" }, "Ab1"), ['.: expected a value matching /^[a-z]+$/, got "Ab1"']);
  assert.deepEqual(messages({ pattern: "^[a-z]+$" }, "ab"), []);
});

test("array size and unique items", () => {
  assert.deepEqual(messages({ minItems: 2 }, [1]), [".: expected at least 2 items, got 1"]);
  assert.deepEqual(messages({ maxItems: 1 }, [1, 2]), [".: expected at most 1 items, got 2"]);
  assert.deepEqual(messages({ uniqueItems: true }, ["a", "a"]), [
    '.: expected all items to be different, item 2 repeats string "a"',
  ]);
  assert.deepEqual(messages({ uniqueItems: true }, ["a", "b"]), []);
});

test("items and prefixItems", () => {
  const schema: Schema = { type: "array", items: { type: "string" } };
  assert.deepEqual(messages(schema, ["a", 2]), ["1: expected string, got number 2"]);
  const tuple: Schema = { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }] };
  assert.deepEqual(messages(tuple, ["a", "b"]), ['1: expected integer, got string "b"']);
  assert.deepEqual(messages({ ...tuple, items: false }, ["a", 1, 2]), [".: expected at most 2 items, got 3"]);
});

test("formats are checked, and unknown formats pass", () => {
  assert.deepEqual(messages({ format: "date" }, "2026-13"), ['.: expected a date value, got "2026-13"']);
  assert.deepEqual(messages({ format: "date" }, "2026-09-18"), []);
  assert.deepEqual(messages({ format: "email" }, "nope"), ['.: expected a email value, got "nope"']);
  assert.deepEqual(messages({ format: "hostname" }, "anything"), []);
});

test("tmd-ref is collected instead of being validated here", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      engine: { type: "string", format: "tmd-ref", "x-tmd-ref": "engine" },
      owners: { type: "array", items: { type: "string", format: "tmd-ref", "x-tmd-ref": ["person", "company"] } },
    },
  };
  const result = validate(schema, { engine: "k20.engine", owners: ["a.person", "b.person"] });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.refs.map((ref) => [ref.field, ref.value, ref.allowed]),
    [
      ["engine", "k20.engine", ["engine"]],
      ["owners.0", "a.person", ["person", "company"]],
      ["owners.1", "b.person", ["person", "company"]],
    ],
  );
});

test("nested objects are validated all the way down", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      specs: {
        type: "object",
        properties: { power: { type: "object", required: ["unit"], properties: { value: { type: "number" } } } },
      },
    },
  };
  assert.deepEqual(messages(schema, { specs: { power: { value: "x" } } }), [
    "specs.power.unit: missing required field \"unit\" (any)",
    'specs.power.value: expected number, got string "x"',
  ]);
});

test("$ref into $defs", () => {
  const schema: Schema = {
    type: "object",
    properties: { power: { $ref: "#/$defs/measure" } },
    $defs: { measure: { type: "object", required: ["value", "unit"], properties: { value: { type: "number" } } } },
  };
  assert.deepEqual(messages(schema, { power: { value: 158, unit: "hp" } }), []);
  assert.deepEqual(messages(schema, { power: { value: "x", unit: "hp" } }), [
    'power.value: expected number, got string "x"',
  ]);
  assert.equal(resolvePointer(schema, "#/$defs/measure")?.["type"], "object");
  assert.equal(resolvePointer(schema, "#/$defs/nope"), null);
});

test("allOf, anyOf, oneOf and not", () => {
  assert.deepEqual(messages({ allOf: [{ type: "string" }, { minLength: 3 }] }, "ab"), [
    ".: expected at least 3 characters, got 2",
  ]);
  assert.deepEqual(messages({ anyOf: [{ type: "string" }, { type: "integer" }] }, 1), []);
  assert.match(
    messages({ anyOf: [{ type: "string" }, { type: "integer" }] }, true)[0]!,
    /expected a value matching one of the anyOf shapes/,
  );
  assert.deepEqual(messages({ oneOf: [{ type: "string" }, { minLength: 1 }] }, "a").length, 1);
  assert.deepEqual(messages({ not: { type: "string" } }, "a"), [
    '.: expected a value that does not match the "not" schema, got string "a"',
  ]);
  assert.deepEqual(messages({ not: { type: "string" } }, 1), []);
});

test("refs inside a passing anyOf branch are collected once", () => {
  const schema: Schema = {
    anyOf: [
      { type: "string", format: "tmd-ref", "x-tmd-ref": "engine" },
      { type: "integer" },
    ],
  };
  const result = validate(schema, "k20.engine");
  assert.equal(result.refs.length, 1);
  assert.equal(result.refs[0]?.value, "k20.engine");
});

test("unsupported keywords are ignored", () => {
  const schema: Schema = { type: "string", multipleOf: 3, patternProperties: { a: {} }, contains: { type: "string" } };
  assert.deepEqual(messages(schema, "anything"), []);
});

test("checkSchema finds broken schemas", () => {
  assert.deepEqual(checkSchema({ type: "object" }), []);
  assert.deepEqual(checkSchema("nope"), ["the schema must be a JSON object"]);
  assert.deepEqual(checkSchema({ type: "objekt" }), ['schema: "objekt" is not a JSON Schema type']);
  assert.deepEqual(checkSchema({ required: "name" }), ["schema: required must be a list of field names"]);
  assert.deepEqual(checkSchema({ properties: { a: { $ref: "#/$defs/gone" } } }), [
    'schema.properties.a: $ref "#/$defs/gone" cannot be resolved',
  ]);
  assert.deepEqual(checkSchema({ properties: { a: { $ref: "https://example.com/x" } } }), [
    'schema.properties.a: only local $ref values are supported, found "https://example.com/x"',
  ]);
  assert.deepEqual(checkSchema({ properties: { a: { pattern: "[" } } }), [
    'schema.properties.a: pattern "[" is not a valid regular expression',
  ]);
});

test("nearest suggests only close names", () => {
  assert.equal(nearest("colour", ["color", "year"]), "color");
  assert.equal(nearest("k21.engine", ["k20.engine", "alfonso.person"]), "k20.engine");
  assert.equal(nearest("zzzzzzzz", ["color", "year"]), null);
});
