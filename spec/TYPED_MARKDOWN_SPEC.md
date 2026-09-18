---
type: spec
title: "Typed Markdown — a small format for semi-structured data in the age of agents"
status: draft
version: 0.2
created: 2026-09-18
updated: 2026-09-18
version_note: 0.2 adds _type in frontmatter as a second way to declare the type, and a use cases section
author: Alfred
tags: [second-brain, format, spec]
related: [SECOND_BRAIN_SPEC.md]
---

# Typed Markdown

A small standard for semi-structured data that lives in plain markdown files. The entity type is in the file name. The fields are in a YAML block at the top. The schemas live in one folder. A CLI tells you what is wrong and what is missing, for one file or the whole project.

The working name is **Typed Markdown**, file convention `.type.md`, CLI `tmd`. The name is a placeholder until you pick one.

## 1. Why this exists

Agents are good at reading and writing markdown. They are bad at keeping a hundred markdown files consistent. Databases are good at consistency and bad at prose, diffs, and being edited by hand. This format sits in the middle. A file is still a markdown file that any editor, GitHub, or Obsidian can open. But it also has a type, a schema, and links to other files, so a tool can check it and turn a folder of files into a table.

Design goals, in order:

1. A valid file is always a valid markdown file. Nothing custom to parse besides YAML frontmatter.
2. The type is declared in one of two places: in the file name, so you can see it in a directory listing and a tool can pick the schema without opening the file, or in an explicit `_type` field in the frontmatter, for files whose names you do not control. The rest of the format is identical either way.
3. One folder holds every schema. Add a file there, and a new type exists.
4. Relationships are plain string references to other files, checked by the linter.
5. The linter is deterministic, fast, and its errors tell you the fix.
6. A structured view (JSON, CSV, SQLite) can always be derived, never hand-maintained.

Non-goals: this is not a database, not a query language, and not a document format with layout rules. The markdown body is free.

## 2. Use cases and scale

Typed Markdown is meant for **small amounts of data that a person reads and edits**, and that agents help maintain. Think hundreds to a few thousand entities per project, each one worth opening as a file. It is not meant for data you would never read one record at a time.

Where it fits:

| Use case | Example entities | Why it fits |
|---|---|---|
| A personal second brain | tasks, projects, goals, people, decisions, meeting notes | Every record has both fields and a story. You review changes as diffs. Agents write most of it, you approve. |
| A small team's operating notes | clients, engagements, runbooks, retros, ADRs | Lives next to the code in git. No wiki to keep in sync. Schema keeps everyone's notes in the same shape. |
| Product and content catalogs kept by hand | talks, articles, courses, tools reviewed in a book | A few hundred items, each with metadata and prose. Exports give you the table for a website or a report. |
| Research and reading notes | papers, books, experiments, datasets | Typed fields for citation data, free body for what you learned, references between them. |
| Configuration that people should read | environments, services, owners, on-call rotations | Plain files, validated, diffable, with the "why" written next to the values. |
| An agent's own memory | facts, preferences, entities it learned about the user | Agents write markdown well. The schema stops them from inventing fields, and the lint tells them what they forgot. |

Where it does not fit:

- **Many rows of the same shape**: transactions, logs, measurements, events. One file per row is absurd at that scale. Use a CSV, a ledger, or a database, and reference the file from a typed entity if you need to.
- **Data machines write and read without a person in between**: caches, sync state, telemetry. Nothing here benefits from being a markdown file.
- **Tens of thousands of entities or more**: the linter would still work, but nobody reads ten thousand files, and git and your editor start to hurt. That is a database with a markdown export, not the other way around.
- **Anything needing concurrent writers, transactions, or access control.** Git is the only concurrency model here, and it is meant for one person or a small team.

The rule of thumb: if you would be happy opening the record in a text editor to fix it by hand, it belongs here. If you would reach for a query first, it does not.

## 3. Files

### 3.1 Naming

```
<slug>.<type>.md        type in the file name
<slug>.md               type in the frontmatter, as _type
```

- `slug` is the entity's identifier inside its type. Lowercase letters, digits, and hyphens: `[a-z0-9][a-z0-9-]*`. Examples: `honda`, `civic-2019`, `k20`.
- `type` is the entity type. Lowercase letters, digits, and hyphens, singular noun: `car`, `engine`, `person`, `meeting-note`.
- When the name has two or more dotted segments before `.md`, the last one is the type and everything before it is the slug. Extra dots in the slug are allowed but discouraged, because `honda.civic.car.md` reads as type `car`, slug `honda.civic`, and the second dot confuses people.
- When the name has one segment (`honda.md`), the whole name is the slug and the type must come from `_type` in the frontmatter.
- A markdown file with neither a type segment nor a `_type` field (`README.md`, `notes.md`) is an untyped file. The linter ignores it unless configured to warn.

Examples:

```
cars/honda.car.md                    type from the file name
cars/mazda.md  with  _type: car      type from the frontmatter
engines/k20.engine.md
tasks/1782055272982.md  with  _type: task
```

### 3.2 Declaring the type

There are two ways to say what a file is. Both are first-class. A project may use one or mix them.

| Way | How | Best for |
|---|---|---|
| File name | `honda.car.md` | Files you name yourself. Visible in a directory listing. The linter picks the schema without opening the file. |
| Frontmatter | `_type: car` as the first key | Files whose names you do not control, like timestamp ids, exports, or notes that grow into entities later. Explicit and self-describing when the file is read on its own. |

Precedence when both are present: **`_type` wins**, because it is explicit. But when the two disagree, one of them is a mistake, so the linter reports it (W006) and the project can promote it to an error with `strict: true`. When they agree, nothing is reported.

`tmd new` writes the type in the file name by default. Set `type_in: frontmatter` in the config to make it write `_type` instead.

### 3.3 Identity

The **entity id** is `<slug>.<type>`, for example `honda.car`, no matter where the type was declared. `cars/mazda.md` with `_type: car` has id `mazda.car`. The id must be unique across the whole project, no matter which folder the file is in. This is what makes references work without paths: you can move a file to another folder and every reference to its id still resolves.

Two files with the same id in different folders is an error.

### 3.4 Layout of a file

```markdown
---
_type: car
name: Honda Civic
year: 2019
engine: k20.engine
owners: [alfonso.person]
specs:
  power: { value: 158, unit: hp }
  weight: { value: 1300, unit: kg }
tags: [daily, reliable]
---

# Honda Civic

Free markdown body. Anything goes here. The linter never reads it unless a schema asks for sections (see 4.4).
```

Rules:

- The file starts with `---` on line one, a YAML block, and a closing `---`. No blank lines before the opening fence.
- The YAML block is a mapping. A list or scalar at the top level is an error.
- The body is optional. A file that is only frontmatter is valid.
- **Keys starting with `_` are reserved for the format.** Schemas may not define them and the validator ignores them. Today the only one is `_type`. Exports add `_id`, `_type`, and `_path` to every row using the same namespace. Plain `type` and `id` are ordinary fields a schema may use freely, so a car can have `type: sedan` without confusion.
- `_type`, when present, should be the first key so a reader sees it immediately. The linter can move it there with `--fix` (W005).

## 4. Schemas

### 4.1 Location

One folder at the project root holds every schema:

```
.tmd/
  config.yaml            optional project settings
  car.schema.json        one schema per type
  engine.schema.json
  person.schema.json
  _common.schema.json    optional, applied to every type
```

A file `<type>.schema.json` defines type `<type>`. The file name is the registration. There is no index to maintain.

The folder name `.tmd` follows the working name of the format. Rename it with the format.

### 4.2 Language

Schemas are **JSON Schema, draft 2020-12**. This is the one thing borrowed from outside, on purpose: every language has a validator for it, every agent has seen it, and it already handles nesting, enums, arrays, formats, and defaults. Typed Markdown adds a small extension vocabulary under `x-tmd` keys and one custom format for references.

Schemas may be written as `.schema.yaml` instead of `.schema.json` if you prefer YAML. The linter accepts both.

### 4.3 A schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "car",
  "description": "A car I own, owned, or am thinking about.",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "year"],
  "properties": {
    "name":   { "type": "string", "minLength": 1 },
    "year":   { "type": "integer", "minimum": 1886 },
    "status": { "enum": ["owned", "sold", "wishlist"], "default": "owned" },
    "engine": { "type": "string", "format": "tmd-ref", "x-tmd-ref": "engine" },
    "owners": { "type": "array", "items": { "type": "string", "format": "tmd-ref", "x-tmd-ref": "person" } },
    "specs": {
      "type": "object",
      "properties": {
        "power":  { "$ref": "#/$defs/measure" },
        "weight": { "$ref": "#/$defs/measure" }
      }
    },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "$defs": {
    "measure": {
      "type": "object",
      "required": ["value", "unit"],
      "properties": { "value": { "type": "number" }, "unit": { "type": "string" } }
    }
  },
  "x-tmd": {
    "example": "honda.car.md",
    "sections": ["Notes"]
  }
}
```

Nesting comes for free: `specs.power.value` is checked because JSON Schema walks objects. An entity that needs its own identity or is referenced from more than one place becomes its own file instead of a nested object. That is the only rule of thumb about nesting.

`additionalProperties: false` is recommended in every schema. It is what turns "the agent invented a field" into a lint error instead of silent drift. A schema that wants to allow free extra fields sets it to `true` on purpose.

### 4.4 The extension vocabulary

Everything Typed Markdown adds is prefixed `x-tmd`. Validators that do not know these keys ignore them, so a schema stays a valid JSON Schema.

| Key | Where | Meaning |
|---|---|---|
| `"format": "tmd-ref"` | on a string property | The value is an entity id (`slug.type`) or a relative path to a typed file. The linter resolves it. |
| `x-tmd-ref` | next to `tmd-ref` | The allowed target type, or a list of types. Without it any type is accepted. |
| `x-tmd.example` | schema root | Path to an example file the CLI shows when asked how to write this type. |
| `x-tmd.sections` | schema root | Markdown headings that must exist in the body. The only rule that reads the body. |
| `x-tmd.deprecated` | on a property | A date string. Using the field is a warning after that date. |
| `x-tmd.plural` | schema root | Table name for exports. Defaults to type plus `s`. |

### 4.5 Common schema

If `.tmd/_common.schema.json` exists, every entity must validate against it as well as against its own type schema. This is where project-wide fields go, like `created`, `updated`, `tags`, or `status`. It keeps each type schema about its own fields only.

### 4.6 Configuration

`.tmd/config.yaml` is optional. Defaults are chosen so that a project with only schemas and files works with no config at all.

```yaml
include: ["**/*.md"]          # where to look for typed files
exclude: ["node_modules/**", ".git/**", "lake/**"]
untyped: ignore                # ignore | warn — what to do with .md files that have neither a type segment nor _type
type_in: filename              # filename | frontmatter — where `tmd new` writes the type
refs:
  allow_paths: true            # accept relative paths as well as ids
  orphans: warn                # warn | ignore — entities nothing points to
strict: false                  # true turns every warning into an error
```

## 5. References and relationships

### 5.1 Syntax

A reference is a string field whose schema has `"format": "tmd-ref"`. Two value forms are accepted:

- **Id form**: `k20.engine`. Preferred. Survives moves.
- **Path form**: `../engines/k20.engine.md`, relative to the referencing file. Useful when a tool generated the link. The linter can rewrite path form to id form with `--fix`.

### 5.2 Cardinality

Cardinality is just YAML shape plus schema:

| Relationship | In the schema | In the file |
|---|---|---|
| One to one, or many to one | a `tmd-ref` string | `engine: k20.engine` |
| One to many, or many to many | an array of `tmd-ref` strings | `owners: [alfonso.person, marta.person]` |
| Many to many with data on the edge | an array of objects, each with a `tmd-ref` field | `owners: [{ person: alfonso.person, since: 2021 }]` |

Two cars pointing at `k20.engine` is a many-to-one relation. A person listed in the `owners` array of several cars is many-to-many. Nothing else is needed.

### 5.3 What the linter checks

- The target file exists.
- The target's type is in `x-tmd-ref` when that is set. `engine: alfonso.person` fails with "expected type engine, found person".
- No entity references itself, unless the schema allows it with `x-tmd-ref-self: true`.

### 5.4 Back-references

Inbound links are never written into files. They are computed. `tmd refs k20.engine` prints who points at it. Writing back-references into files would put every relationship in two places, and one of them would go stale.

## 6. The CLI

One binary, `tmd`. Every command takes `--json` for machine output. Exit code is 0 when there are no errors, 1 when there are errors, 2 when the tool itself failed.

```
tmd lint [path...]          lint one file, some files, a folder, or the whole project when no path is given
tmd lint --fix              apply safe fixes: normalize key order to schema order, rewrite path refs to id refs, add missing required fields as TODO placeholders when --scaffold is also given
tmd lint --strict           warnings count as errors
tmd check <file>            same as lint on one file, but also prints every optional field that is not set, with its type and description. This is the "tell me what is missing" command.
tmd schema list             every type, its schema path, how many files use it
tmd schema show <type>      the schema, plus its example file if declared
tmd new <type> <slug> [dir] create <slug>.<type>.md with every required field present and typed placeholders, and optional fields as comments
tmd refs <id|file>          outgoing and incoming references
tmd export --format json|jsonl|csv|sqlite [--out path]
                            one table per type; nested objects are kept in JSON and JSONL, flattened with dot keys in CSV, stored as JSON columns in SQLite. Adds columns _id, _type, _path.
tmd graph [--format dot|json] the reference graph
```

### 6.1 Error format

Human output, one line per problem, sorted by file then line:

```
cars/honda.car.md:4: E003 year: expected integer, got string "2019"
cars/honda.car.md:6: E004 engine: reference "k21.engine" not found (did you mean k20.engine?)
cars/mazda.car.md:1: E002 missing required field "year" (integer, the model year)
people/alfonso.person.md: W002 no entity references this file
```

The line number points at the field when the YAML parser gives one, else at line 1.

JSON output is an array of `{ path, line, code, level, field, message, hint }`. Agents read `hint` to know how to fix it.

### 6.2 Codes

| Code | Level | Meaning |
|---|---|---|
| E001 | error | File name has a type segment but no schema exists for that type |
| E002 | error | Required field missing |
| E003 | error | Field fails schema (type, enum, pattern, range, extra property) |
| E004 | error | Reference target not found |
| E005 | error | Reference target has the wrong type |
| E006 | error | Duplicate entity id across the project |
| E007 | error | `_type` is present but is not a valid type name, or a schema defines a reserved `_` key |
| E008 | error | Frontmatter missing, unparsable, or not a mapping |
| E009 | error | Required section heading missing from the body |
| E010 | error | Schema file itself is invalid |
| W001 | warn | Untyped `.md` file in a scanned folder (only when `untyped: warn`) |
| W002 | warn | Entity nothing references (only when `refs.orphans: warn`) |
| W003 | warn | Deprecated field in use |
| W004 | warn | Reference in path form instead of id form (fixable) |
| W005 | warn | Field order differs from schema order, or `_type` is not the first key (fixable) |
| W006 | warn | File name type and `_type` disagree; `_type` was used (error under `strict: true`) |

Every message for E002 and E003 includes the expected type and the schema description of the field, so the error is also the documentation.

### 6.3 Speed

A lint of one file reads that file, its schema, and the id index. A lint of the project builds the id index once, then validates each file. Files with the type in the name are indexed from the directory walk alone. Files that rely on `_type` need their frontmatter read to be indexed, which is the one performance cost of the frontmatter option; it stays small because only the YAML block is parsed, never the body. No file body is read except when `x-tmd.sections` is set. Target: a few thousand files in under two seconds on a laptop. The index may be cached in `.tmd/cache/` and invalidated by file mtime; the cache is gitignored.

## 7. Derived views

The files are the truth. Everything else is generated by `tmd export` and can be thrown away.

- **JSON / JSONL**: one array or one line per entity, frontmatter as-is plus `_id`, `_type`, `_path`, and `_body` if `--with-body` is given.
- **CSV**: one file per type. Nested keys flattened with dots (`specs.power.value`). Arrays joined with `;`. Good enough for spreadsheets, lossy for round trips.
- **SQLite**: one table per type named by `x-tmd.plural`, one row per entity, nested objects as JSON text columns, plus a `refs` table with `from_id`, `field`, `to_id` so joins across types are one query. Rebuilt in full on every export.

The export never writes back. Editing the database and expecting the files to change is not supported and never will be. If you want to change data, change the file and lint it.

## 8. Working with agents

The format is designed so an agent can do the whole loop with three commands and no memory of the schema:

1. `tmd schema show car` prints the schema and the example file. The agent now knows exactly what a valid `car` looks like.
2. `tmd new car honda cars/` creates a valid skeleton. The agent fills it in.
3. `tmd lint cars/honda.car.md --json` returns an empty array or a list of exact fixes. The agent applies them and re-runs.

Rules for agents, to put in the project's agent instructions:

- Never invent a field. If the schema lacks it, propose a schema change.
- Never write a reference without checking it exists (`tmd refs` or a lint run).
- Run `tmd lint` before handing work over. Zero errors.
- Untyped markdown is fine for prose. The moment a file is a thing with fields, give it a type, in the name or as `_type`, following what the project already does.

## 9. Relationship to the second brain spec

This format is the concrete shape of the **record** layer in the second brain spec. Two adjustments to that spec follow from it:

- The brain's `type:` frontmatter field becomes `_type:`, which this format understands as-is. Timestamp-named files like `1782055272982.md` keep their names and declare `_type: task`. Hand-named files may put the type in the name instead, like `draft-solutions-goals.task.md`. Both are valid in one project.
- The brain's `schema/` folder is this format's `.tmd/` folder. The `x-brain` block proposed there becomes `x-tmd`.

Ledgers (CSV) and untyped documents stay outside this format. The brain's linter is `tmd lint` plus the brain-specific rules (staleness, lake age, file size) layered on top.

## 10. Implementation sketch

Node.js, TypeScript, one package, no framework. Dependencies: `js-yaml` for frontmatter, `ajv` plus `ajv-formats` for validation with a custom `tmd-ref` format, `fast-glob` for the walk, `better-sqlite3` behind an optional flag for export. About 500 lines. The whole spec fits in the README.

Order of work: lint with E001 to E008, then `schema show` and `new`, then refs and E004 to E006, then export. Each step is useful on its own.

## 11. Open questions

1. **Name.** Typed Markdown / `.tmd` is a placeholder.
2. **Slug always comes from the file name.** The type may come from the name or from `_type`, but the slug never comes from the frontmatter. Renaming a file therefore changes its id, so every reference must be rewritten. `tmd mv` would do that. Decide whether that command belongs in v1, and whether an `_id` override is ever worth adding. My lean: `tmd mv` yes, `_id` no.
3. **Schema for the body.** `x-tmd.sections` is the only body rule. Whether to go further (required tables, word limits) is open. My lean: no. The body is where the format stays free.
4. **Multiple types per file.** Not supported. A file is one thing. If it feels like two, it is two files.
