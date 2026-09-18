# tmd, Typed Markdown

A small format for semi-structured data that lives in plain markdown files, plus the tool that checks it.

The entity type is in the file name. The fields are in the YAML block at the top. The schemas live in one folder. A CLI tells you what is wrong and what is missing, for one file or for the whole project.

## The problem this solves

Agents are good at reading and writing markdown. They are bad at keeping a hundred markdown files consistent. Databases are good at consistency and bad at prose, diffs, and being edited by hand. This format sits in the middle.

A valid file is still a markdown file that any editor, GitHub, or Obsidian can open. It also has a type, a schema, and links to other files, so a tool can check it and turn a folder of files into a table.

Design goals, in order:

1. A valid file is always a valid markdown file. Nothing custom to parse besides YAML frontmatter.
2. The type is declared in the file name, so you see it in a directory listing, or in a `_type` field for files whose names you do not control.
3. One folder holds every schema. Add a file there, and a new type exists.
4. Relationships are plain string references to other files, checked by the linter.
5. The linter is deterministic, fast, and its errors tell you the fix.
6. A structured view (JSON, CSV, SQL) can always be derived, never hand maintained.

This is not a database, not a query language, and not a document format with layout rules. The markdown body is free.

## Install and run

You need **Node.js 24 or newer**. There is no build step. Node runs the TypeScript source directly by stripping the types.

```
git clone <this repo> tmd
cd tmd
npm install          # installs typescript and @types/node, nothing else
npm test             # runs the whole test suite
npm run typecheck    # tsc --noEmit, strict
```

To use the CLI anywhere:

```
npm link             # puts `tmd` on your PATH
tmd lint
```

Or call it by path, which is what the examples below do:

```
node /path/to/tmd/src/cli.ts lint
```

The tool has **zero runtime dependencies**. The YAML parser, the JSON Schema validator, the file walker, the argument parser, and the exporters are all in `src/`, in about 3,300 lines of TypeScript.

## Quickstart

```
mkdir my-brain && cd my-brain
mkdir .tmd cars engines
```

Write a schema at `.tmd/car.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "car",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "year"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "year": { "type": "integer", "minimum": 1886 }
  }
}
```

Create a file and lint it:

```
tmd new car honda cars/
tmd lint
```

That is the whole setup. A folder called `.tmd` with one schema per type, and markdown files named `<slug>.<type>.md` anywhere you like.

## Files

### Naming

```
<slug>.<type>.md        type in the file name
<slug>.md               type in the frontmatter, as _type
```

- `slug` is the entity's identifier inside its type. Lowercase letters, digits, and hyphens: `honda`, `civic-2019`, `k20`.
- `type` is the entity type, a singular noun: `car`, `engine`, `person`, `meeting-note`.
- When the name has two or more dotted segments, the last one is the type and everything before it is the slug. `honda.civic.car.md` is type `car`, slug `honda.civic`.
- When the name has one segment (`honda.md`), the whole name is the slug and the type must come from `_type`.
- A markdown file with neither a type segment nor a `_type` field (`README.md`, `notes.md`) is an untyped file. The linter ignores it unless you set `untyped: warn`.

### Identity

The **entity id** is `<slug>.<type>`, for example `honda.car`, no matter where the type was declared. The id must be unique across the whole project, whatever folder the file sits in. That is what makes references work without paths: move a file to another folder and every reference to its id still resolves.

### Two ways to declare the type

| Way | How | Best for |
|---|---|---|
| File name | `honda.car.md` | Files you name yourself. Visible in a directory listing. The linter picks the schema without opening the file. |
| Frontmatter | `_type: car` as the first key | Files whose names you do not control, like timestamp ids or exports. Explicit when the file is read on its own. |

When both are present, `_type` wins, because it is explicit. When the two disagree, one of them is a mistake, so the linter reports W006.

### Real files

Everything below is in `examples/` and lints clean. Run `node ../src/cli.ts lint` from that folder to see for yourself.

`examples/cars/honda.car.md`, a car with the type in the file name:

```markdown
---
name: Honda Civic
year: 2019
status: owned
engine: k20.engine
owners: [alfonso.person]
specs:
  power: { value: 158, unit: hp }
  weight: { value: 1300, unit: kg }
created: 2026-01-12
tags: [daily, reliable]
---

# Honda Civic

The daily car. Nothing exciting, and that is the point.

## Notes

Bought used with 60,000 km on it. The clutch was changed by the first owner.
```

`examples/cars/mazda.md`, the same type declared in the frontmatter instead:

```markdown
---
_type: car
name: Mazda RX-8
year: 2004
status: wishlist
engine: 13b.engine
owners: []
created: 2026-02-03
tags: [weekend]
---

# Mazda RX-8

The type lives in the frontmatter here, because the file name is just the slug.

## Notes

A rotary needs an owner who likes oil. I am not that owner yet.
```

Its id is still `mazda.car`, because the slug comes from the file name and the type comes from `_type`.

`examples/engines/k20.engine.md`:

```markdown
---
name: Honda K20
layout: inline-4
displacement_cc: 1998
created: 2026-01-12
tags: [honda]
---

# Honda K20

Two litres, four cylinders, and a reputation it earned.
```

`examples/people/alfonso.person.md`:

```markdown
---
name: Alfonso Graziano
email: info@alfonsograziano.it
role: Owner of the Civic
drives: [honda.car]
created: 2026-01-12
---

# Alfonso Graziano

Drives the Civic every day.
```

### Rules for a file

- The file starts with `---` on line one, a YAML block, and a closing `---`. No blank lines before the opening fence.
- The YAML block is a mapping. A list or a single value at the top level is an error.
- The body is optional. A file that is only frontmatter is valid.
- **Keys starting with `_` are reserved for the format.** Schemas may not define them and the validator ignores them. Today the only one is `_type`. Exports add `_id`, `_type`, `_path`, and `_body`. Plain `type` and `id` are ordinary fields a schema may use freely, so a car can have `type: sedan` without confusion.
- `_type`, when present, should be the first key. `tmd lint --fix` moves it there.

## Schemas

### Where they live

```
.tmd/
  config.yaml            optional project settings
  car.schema.json        one schema per type
  engine.schema.json
  person.schema.json
  _common.schema.json    optional, applied to every type
```

A file `<type>.schema.json` defines type `<type>`. The file name is the registration. There is no index to maintain. Schemas may also be written as `.schema.yaml` or `.schema.yml`.

### A real schema

This is `examples/.tmd/car.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "car",
  "description": "A car I own, owned, or am thinking about.",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "year"],
  "properties": {
    "name": { "type": "string", "minLength": 1, "description": "What the car is called." },
    "year": { "type": "integer", "minimum": 1886, "description": "The model year." },
    "status": { "enum": ["owned", "sold", "wishlist"], "default": "owned", "description": "Where the car sits in my life." },
    "engine": { "type": "string", "format": "tmd-ref", "x-tmd-ref": "engine", "description": "The engine in this car." },
    "owners": {
      "type": "array",
      "items": { "type": "string", "format": "tmd-ref", "x-tmd-ref": "person" },
      "description": "People who own or owned it."
    },
    "specs": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "power": { "$ref": "#/$defs/measure" },
        "weight": { "$ref": "#/$defs/measure" }
      },
      "description": "Numbers with units."
    },
    "created": { "type": "string", "format": "date" },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "$defs": {
    "measure": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "unit"],
      "properties": { "value": { "type": "number" }, "unit": { "type": "string" } }
    }
  },
  "x-tmd": {
    "example": "cars/honda.car.md",
    "sections": ["Notes"],
    "plural": "cars"
  }
}
```

Nesting comes for free: `specs.power.value` is checked because JSON Schema walks objects. An entity that needs its own identity, or that is referenced from more than one place, becomes its own file instead of a nested object. That is the only rule of thumb about nesting.

`additionalProperties: false` is recommended in every schema. It is what turns "the agent invented a field" into a lint error instead of silent drift.

### The x-tmd extension vocabulary

Everything Typed Markdown adds is prefixed `x-tmd`. Validators that do not know these keys ignore them, so a schema stays a valid JSON Schema.

| Key | Where | Meaning |
|---|---|---|
| `"format": "tmd-ref"` | on a string property | The value is an entity id (`slug.type`) or a relative path to a typed file. The linter resolves it. |
| `x-tmd-ref` | next to `tmd-ref` | The allowed target type, or a list of types. Without it any type is accepted. |
| `x-tmd-ref-self` | next to `tmd-ref` | `true` lets the entity reference itself. Without it, a self reference is E011. |
| `x-tmd.example` | schema root | Path to an example file, shown by `tmd schema show`. |
| `x-tmd.sections` | schema root | Markdown headings that must exist in the body. The only rule that reads the body. |
| `x-tmd.deprecated` | on a property | A date string. Using the field is a warning (W003) on and after that date. |
| `x-tmd.plural` | schema root | Table name for exports. Defaults to the type plus `s`. |

### The common schema

If `.tmd/_common.schema.json` exists, every entity must validate against it as well as against its own type schema. This is where project wide fields go, like `created`, `updated`, `tags`, or `status`.

One thing to watch: if a type schema sets `additionalProperties: false`, it must also list the common fields in its own `properties`, or they will be reported as unknown fields. The example schemas do this.

### Configuration

`.tmd/config.yaml` is optional. The defaults are chosen so that a project with only schemas and files works with no config at all.

```yaml
include: ["**/*.md"]          # where to look for typed files
exclude: ["node_modules/**", ".git/**", "lake/**"]
untyped: ignore               # ignore | warn
type_in: filename             # filename | frontmatter, where `tmd new` writes the type
refs:
  allow_paths: true           # accept relative paths as well as ids
  orphans: warn               # warn | ignore, entities nothing points to
strict: false                 # true turns every warning into an error
```

Unknown settings are an error, so a typo in the config does not pass quietly.

## References and relationships

A reference is a string field whose schema has `"format": "tmd-ref"`. Two value forms are accepted:

- **Id form**: `k20.engine`. Preferred. Survives file moves.
- **Path form**: `../engines/k20.engine.md`, relative to the referencing file. Useful when a tool generated the link. `tmd lint --fix` rewrites it to the id form.

Cardinality is just YAML shape plus schema:

| Relationship | In the schema | In the file |
|---|---|---|
| One to one, or many to one | a `tmd-ref` string | `engine: k20.engine` |
| One to many, or many to many | an array of `tmd-ref` strings | `owners: [alfonso.person, marta.person]` |
| Many to many with data on the edge | an array of objects, each with a `tmd-ref` field | `owners: [{ person: alfonso.person, since: 2021 }]` |

Two cars pointing at `k20.engine` is a many to one relation. A person listed in the `owners` array of several cars is many to many. Nothing else is needed.

What the linter checks:

- The target file exists (E004).
- The target's type is in `x-tmd-ref` when that is set (E005). `engine: alfonso.person` fails with "expected type engine, found person".
- No entity references itself, unless the schema sets `x-tmd-ref-self: true` (E011).

**Back references are never written into files.** They are computed. `tmd refs k20.engine` prints who points at it. Writing back references into files would put every relationship in two places, and one of them would go stale.

## Use cases and scale

Typed Markdown is meant for **small amounts of data that a person reads and edits**, and that agents help maintain. Think hundreds to a few thousand entities per project, each one worth opening as a file. It is not meant for data you would never read one record at a time.

Where it fits:

| Use case | Example entities | Why it fits |
|---|---|---|
| A personal second brain | tasks, projects, goals, people, decisions, meeting notes | Every record has both fields and a story. You review changes as diffs. Agents write most of it, you approve. |
| A small team's operating notes | clients, engagements, runbooks, retros, ADRs | Lives next to the code in git. No wiki to keep in sync. The schema keeps everyone's notes in the same shape. |
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

## The CLI

One command, `tmd`. Every command takes `--json` for machine output.

```
tmd lint [path...]          lint one file, some files, a folder, or the whole project when no path is given
tmd lint --fix              apply the safe fixes
tmd lint --fix --scaffold   also add missing required fields as placeholders
tmd lint --strict           warnings count as errors
tmd check <file>            lint one file and print every optional field that is not set
tmd schema list             every type, its schema path, how many files use it
tmd schema show <type>      the schema, plus its example file if declared
tmd new <type> <slug> [dir] create a valid skeleton file
tmd refs <id|file>          outgoing and incoming references
tmd export --format json|jsonl|csv|sqlite [--out path] [--with-body]
tmd graph [--format dot|json] [--out path]
tmd help
tmd --version
```

### tmd lint

```
$ cd examples
$ tmd lint
0 errors, 0 warnings in 7 files
```

```
$ tmd lint cars/honda.car.md
0 errors, 0 warnings in 1 file

$ tmd lint cars           # a folder
0 errors, 0 warnings in 2 files
```

### tmd check

The "tell me what is missing" command. It lints one file, then lists every optional field that is not set, with its type and its description from the schema.

```
$ tmd check cars/mazda.md
0 errors, 0 warnings in 1 file

optional fields not set (1):
  specs          object
                 Numbers with units.
```

### tmd schema list and tmd schema show

```
$ tmd schema list
type    files  schema
car         2  .tmd/car.schema.json
engine      2  .tmd/engine.schema.json
person      2  .tmd/person.schema.json

common schema: .tmd/_common.schema.json (applies to every type)
```

`tmd schema show car` prints the schema as JSON, then the example file named by `x-tmd.example`, so an agent learns the type from one command.

### tmd new

```
$ tmd new car civic-2020 cars/
created cars/civic-2020.car.md
```

The file it writes:

```markdown
---
name: Civic 2020   # string, What the car is called.
year: 1886   # integer, The model year.
created: 2026-09-18   # string, The day the file was written.

# Optional fields. Uncomment the ones you need.
# status: owned   # one of owned, sold, wishlist, Where the car sits in my life.
# engine: TODO.type   # string, reference to type engine, The engine in this car.
# owners: []   # array, People who own or owned it.
# specs: {}   # object, Numbers with units.
# tags: []   # array, Free tags.
---

# Civic 2020

## Notes
```

Required fields get typed placeholders: a number uses its `minimum`, an enum uses its first value, a date uses today, a plain string uses `TODO`. Optional fields are written as comments you can uncomment. Sections from `x-tmd.sections` are written as headings. The file lints clean the moment it is created, so you can fill it in and lint again.

With `type_in: frontmatter` in the config, the same command writes `tasks/1782055272999.md` with `_type: task` as the first key instead.

### tmd refs

```
$ tmd refs honda.car
honda.car  (cars/honda.car.md)

outgoing (2):
  engine -> k20.engine (engines/k20.engine.md)
  owners.0 -> alfonso.person (people/alfonso.person.md)

incoming (1):
  alfonso.person <- drives.0 (people/alfonso.person.md)
```

It takes an id or a file path.

### tmd export

One table per type. Nested objects are kept as objects in JSON and JSONL, flattened with dot keys in CSV, and stored as JSON text columns in SQL. Every row gets `_id`, `_type`, and `_path`, plus `_body` with `--with-body`.

```
$ tmd export --format json          # an array, to stdout
$ tmd export --format jsonl --with-body --out data.jsonl
$ tmd export --format csv --out out
wrote out/cars.csv (342 bytes)
wrote out/engines.csv (261 bytes)
wrote out/people.csv (287 bytes)
6 entities, 5 references
```

The CSV for cars:

```csv
_id,_type,_path,created,engine,name,owners,specs.power.unit,specs.power.value,specs.weight.unit,specs.weight.value,status,tags,year
honda.car,car,cars/honda.car.md,2026-01-12,k20.engine,Honda Civic,alfonso.person,hp,158,kg,1300,owned,daily;reliable,2019
mazda.car,car,cars/mazda.md,2026-02-03,13b.engine,Mazda RX-8,,,,,,wishlist,weekend,2004
```

**About `--format sqlite`.** There is no way to write a real SQLite file without a dependency, and this project has none. So `--format sqlite` writes a **SQL script** instead, with the same tables the spec asks for, including the `refs` table with `from_id`, `field`, `to_id`. Pipe it into `sqlite3`:

```
$ tmd export --format sqlite --out brain.sql
$ sqlite3 brain.db < brain.sql
$ sqlite3 brain.db "select c.name, e.name from cars c join refs r on r.from_id = c._id and r.field = 'engine' join engines e on e._id = r.to_id;"
Honda Civic|Honda K20
Mazda RX-8|Mazda 13B-MSP Renesis
```

The script starts with `DROP TABLE IF EXISTS`, so it rebuilds in full every time. The export never writes back. If you want to change data, change the file and lint it.

### tmd graph

```
$ tmd graph
digraph tmd {
  rankdir=LR;
  node [shape=box, fontname="Helvetica"];
  subgraph "cluster_car" {
    label="car";
    "honda.car";
    "mazda.car";
  }
  ...
  "honda.car" -> "k20.engine" [label="engine"];
  "honda.car" -> "alfonso.person" [label="owners.0"];
}
```

Unresolved references are drawn as dashed red edges, so a broken link is visible in the picture. `--format json` gives `{ nodes, edges }` instead.

## What the linter reports

Human output is one line per problem, sorted by file then line, with the hint on the next line.

```
<path>[:<line>]: <CODE> [<field>: ]<message>
    hint: <how to fix it>
```

The line number points at the field when the YAML parser gives one, else at line 1.

### Every code, with real output

All of the output below comes from real runs of `tmd lint` in `examples/broken/`, a project that is wrong on purpose. Run it yourself:

```
$ cd examples/broken
$ tmd lint
...
16 errors, 15 warnings in 13 files
```

| Code | Level | Meaning |
|---|---|---|
| E001 | error | The type has no schema |
| E002 | error | Required field missing |
| E003 | error | Field fails the schema (type, enum, pattern, range, extra property) |
| E004 | error | Reference target not found |
| E005 | error | Reference target has the wrong type |
| E006 | error | Duplicate entity id across the project |
| E007 | error | `_type` is not a valid type name, or a schema defines a reserved `_` key |
| E008 | error | Frontmatter missing, unparsable, or not a mapping |
| E009 | error | Required section heading missing from the body |
| E010 | error | Schema file itself is invalid |
| E011 | error | Entity references itself and the schema does not allow it (added by this implementation) |
| W001 | warn | Untyped `.md` file in a scanned folder (only when `untyped: warn`) |
| W002 | warn | Entity nothing references (only when `refs.orphans: warn`) |
| W003 | warn | Deprecated field in use |
| W004 | warn | Reference in path form instead of id form (fixable) |
| W005 | warn | Field order differs from schema order, or `_type` is not first (fixable) |
| W006 | warn | File name type and `_type` disagree, `_type` was used |
| W007 | warn | Slug is not a plain slug (added by this implementation) |

E001, the type has no schema:

```
cars/truck.vehicle.md: E001 no schema exists for type "vehicle"
    hint: create .tmd/vehicle.schema.json, known types: car, engine, person
```

E002, a required field is missing. The message carries the type and the schema description of the field, so the error is also the documentation:

```
cars/civic.car.md:1: E002 year: missing required field "year" (integer, The model year.)
    hint: add year: <integer> to the frontmatter
```

E003, a value fails the schema, and a field the schema does not know:

```
cars/civic.car.md:2: E003 status: expected one of "owned", "sold", "wishlist", got string "running"
    hint: Where the car sits in my life.
cars/civic.car.md:5: E003 colour: unknown field "colour", this type does not allow extra fields
    hint: known fields: name, year, status, engine, owners, nickname, created, tags
```

E004, a reference that goes nowhere, with a suggestion:

```
cars/civic.car.md:4: E004 engine: reference "k21.engine" not found
    hint: did you mean k20.engine?
```

E005, a reference to the wrong type:

```
cars/rx7.car.md:4: E005 engine: expected type engine, found person
    hint: "alfonso.person" points at people/alfonso.person.md
```

E006, two files claiming the same id:

```
archive/civic.car.md: E006 duplicate entity id "civic.car", also used by cars/civic.car.md
    hint: an id is <slug>.<type> and must be unique in the project, rename one of the files
```

E007, a `_type` that is not a type name, and a schema that steals a reserved key:

```
notes/weird.md:2: E007 _type: _type "Not A Type" is not a valid type name
    hint: type names are lowercase letters, digits and hyphens, for example meeting-note
.tmd/ghost.schema.json: E007 _secret: the schema defines the reserved field "_secret"
    hint: field names starting with _ belong to the format, rename the field
```

E008, frontmatter that cannot be read. The parser says exactly what it could not handle and on which line:

```
cars/broken-yaml.car.md:3: E008 block scalars (| and >) are not supported
    hint: a typed file starts with --- on line 1, a YAML mapping, then a closing ---
```

E009, a section the schema asks for is missing from the body:

```
cars/rx7.car.md:8: E009 the body is missing the required section "Notes"
    hint: add a heading "## Notes" to the body
```

E010, a broken schema file. One line per problem:

```
.tmd/bad.schema.json: E010 schema.properties.name: $ref "#/$defs/missing" cannot be resolved
.tmd/bad.schema.json: E010 schema: "objekt" is not a JSON Schema type
.tmd/bad.schema.json: E010 schema: required must be a list of field names
```

E011, an entity that points at itself:

```
people/alfonso.person.md:3: E011 mentor: the entity references itself through "mentor"
    hint: set "x-tmd-ref-self": true on the field when a self reference is wanted
```

W001, an untyped file, only when `untyped: warn`:

```
notes/random.md: W001 untyped markdown file
    hint: rename it to <slug>.<type>.md or add _type to the frontmatter
```

W002, an orphan, only when `refs.orphans: warn`:

```
people/nobody.person.md: W002 no entity references this file
    hint: link it from another entity, or set refs.orphans: ignore in .tmd/config.yaml
```

W003, a deprecated field:

```
cars/civic.car.md:6: W003 nickname: the field "nickname" is deprecated since 2026-01-01
    hint: remove the field, the schema marked it deprecated
```

W004 and W005, the two fixable warnings:

```
cars/rx7.car.md:5: W004 owners.0: reference "../people/alfonso.person.md" is a path, the id form is "alfonso.person"
    hint: run tmd lint --fix to rewrite it, ids survive file moves
cars/civic.car.md:2: W005 status: field order differs from the schema order, expected name, status, engine, nickname, created, colour
    hint: run tmd lint --fix to reorder the fields
```

W006, the file name and `_type` disagree:

```
cars/mx5.person.md:2: W006 _type: the file name says type "person" but _type says "car", _type was used
    hint: rename the file to mx5.car.md, or change _type to person
```

W007, a slug that is not a plain slug:

```
cars/My_Car.car.md: W007 the slug "My_Car" is not lowercase letters, digits and hyphens
    hint: rename the file so the part before the type is a plain slug, for example civic-2019
```

### What --fix does

`--fix` only makes changes that cannot lose information. It rewrites path references to id references (W004) and puts the fields in schema order with `_type` first (W005). It works on the raw frontmatter lines, so comments, quoting style, blank lines, and the body are kept exactly as they were.

```
$ tmd lint cars/messy.car.md
cars/messy.car.md:2: W005 year: field order differs from the schema order, expected name, year, engine, created
    hint: run tmd lint --fix to reorder the fields
cars/messy.car.md:5: W004 engine: reference "../engines/k20.engine.md" is a path, the id form is "k20.engine"
    hint: run tmd lint --fix to rewrite it, ids survive file moves
0 errors, 2 warnings in 1 file

$ tmd lint cars/messy.car.md --fix
fixed 1 file:
  cars/messy.car.md (W004, W005)
0 errors, 0 warnings in 1 file
```

With `--scaffold` as well, it also adds the required fields that are missing, using the same placeholders as `tmd new`. Those placeholders are guesses, so the file may still have errors after a scaffold. That is on purpose: the point is to give you the lines to fill in.

## Supported YAML subset

The frontmatter parser is written for this project. It handles what frontmatter needs and refuses everything else with a clear message and a line number. Nothing is silently mis-parsed.

Supported:

- Block mappings, nested to any depth.
- Block sequences (`- item`), both indented under the key and at the same indent as the key.
- Sequences of mappings (`- person: a.person` followed by more keys at the same indent) and nested sequences.
- Flow mappings (`{ value: 158, unit: hp }`) and flow sequences (`[a, b]`), nested in each other, on one line.
- Single quoted strings, with `''` for a literal quote.
- Double quoted strings, with the escapes `\n \t \r \b \f \0 \" \\ \/` and `\uXXXX`.
- Quoted keys.
- Plain scalars: integers, floats (including exponent form), `true`/`false` (and `True`, `TRUE`), `null`, `Null`, `NULL`, `~`, an empty value, and everything else as a string.
- Comments, either on their own line or after a value, and blank lines anywhere.
- A line number for every key and every sequence item, keyed by its dotted path (`specs.power.value`, `owners.0`).

Not supported, each one an error with its line:

- Block scalars, `|` and `>`. "block scalars (| and >) are not supported".
- Anchors `&name`, aliases `*name`, merge keys `<<`, and tags `!type`.
- Explicit keys (`? key`).
- More than one document in a block, and `...` end markers.
- Flow collections that span several lines.
- Tabs used for indentation.
- Duplicate keys in one mapping. YAML says the last one wins, which hides typos, so this parser calls it an error.

Two deliberate choices about scalars: `yes`, `no`, `on`, `off` are strings, not booleans, which is the YAML 1.2 behaviour and avoids the Norway problem. An integer too large for a safe JavaScript integer stays a string rather than losing digits.

## Supported JSON Schema keywords

Schemas are JSON Schema draft 2020-12. This validator supports the keywords below, which is everything the spec asks for:

`type` (including a list of types), `required`, `properties`, `additionalProperties` (both `false` and a schema), `items`, `prefixItems`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`, `format`, `$defs` with local `$ref`, `allOf`, `anyOf`, `oneOf`, `not`.

Read but never validated against: `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`. `description` and `default` show up in error messages and in `tmd check`.

**Ignored on purpose**, with no error and no warning: `if`/`then`/`else`, `dependentSchemas`, `dependentRequired`, `patternProperties`, `propertyNames`, `contains`, `minContains`, `maxContains`, `multipleOf`, `unevaluatedItems`, `unevaluatedProperties`, `contentMediaType`, `contentEncoding`, remote `$ref`, `$dynamicRef`, and `$anchor`. A schema that uses them is still loaded and still checks everything else. If you need one of them, the validator is one file, `src/jsonschema.ts`.

`format` is **asserted**, not just annotated. Plain JSON Schema treats `format` as an annotation by default; here a `format` we know about is checked, because the point of this tool is to catch mistakes. The formats checked are `date`, `date-time`, `time`, `email`, `uri`, and `uuid`. A `format` we do not know about passes. `tmd-ref` is not a string check at all: it hands the value to the reference resolver.

Error messages always name the field path, what was expected, and what was found:

```
year: expected integer, got string "2019"
status: expected one of "owned", "sold", "wishlist", got string "running"
specs.power.value: expected number, got string "x"
owners.1: expected string, got number 2
```

## Exit codes

| Code | When |
|---|---|
| 0 | No errors. Warnings may still be printed. |
| 1 | At least one error. With `--strict`, at least one warning. |
| 2 | The tool itself failed: no `.tmd` folder, an unknown command, a bad flag, a file that does not exist, a broken config file. |

`--strict` on the command line and `strict: true` in the config do the same thing.

## The --json output shape

`tmd lint --json` and `tmd check --json` use the shape from the spec. Agents read `hint` to know how to fix a problem.

```json
[
  {
    "path": "cars/civic.car.md",
    "line": 4,
    "code": "E004",
    "level": "error",
    "field": "engine",
    "message": "reference \"k21.engine\" not found",
    "hint": "did you mean k20.engine?"
  }
]
```

`path` is relative to the project root and always uses forward slashes. `line` is null when the problem is about the whole file, for example E006 and W002. `field` is null when the problem is not about one field. `hint` is null when there is nothing useful to add.

`tmd lint --json` prints the array on its own. The other commands print an object, because they carry more than diagnostics:

| Command | Shape |
|---|---|
| `check --json` | `{ path, diagnostics: [...], optional: [{ field, type, description, enum, default, ref }] }` |
| `schema list --json` | `[{ type, schema, files, plural, description }]` |
| `schema show <type> --json` | `{ type, file, schema, example: { path, content } \| null }` |
| `new --json` | `{ path, type, slug, id }` |
| `refs --json` | `{ id, path, outgoing: [{ field, to, path, resolved }], incoming: [{ from, field, path }] }` |
| `export --json` | `{ format, entities, refs, files: [{ path, bytes }] }` |
| `graph --format json` | `{ nodes: [{ id, type, path }], edges: [{ from, to, field, resolved }] }` |

Color is used in human output only when the output is a terminal. `NO_COLOR` switches it off, `FORCE_COLOR` switches it on.

## Working with AI agents

The format is designed so an agent can do the whole loop with three commands and no memory of the schema:

1. `tmd schema show car` prints the schema and the example file. The agent now knows exactly what a valid `car` looks like.
2. `tmd new car honda cars/` creates a valid skeleton. The agent fills it in.
3. `tmd lint cars/honda.car.md --json` returns an empty array or a list of exact fixes. The agent applies them and runs it again.

Rules worth putting in your project's agent instructions:

- Never invent a field. If the schema lacks it, propose a schema change.
- Never write a reference without checking that it exists (`tmd refs`, or a lint run).
- Run `tmd lint` before handing work over. Zero errors.
- Untyped markdown is fine for prose. The moment a file is a thing with fields, give it a type, in the name or as `_type`, following what the project already does.

`AGENTS.md` in this repo is the contract for agents working on the tool itself.

## The examples folder

- `examples/` is a small real project: two cars, two engines, two people, with its own `.tmd/` schemas. It lints clean.
- `examples/broken/` is the same project bent out of shape, so that every error and warning code fires at least once. It is its own project, with its own `.tmd/` folder, and the clean project excludes it.

Both are copied into `test/fixtures/`, where the end to end tests run them through the real CLI.

## How the code is laid out

```
src/
  yaml.ts          the YAML subset parser and the emitter
  frontmatter.ts   splitting a markdown file into frontmatter and body
  jsonschema.ts    the JSON Schema validator and the schema checker
  config.ts        .tmd/config.yaml and glob matching
  schemas.ts       loading the .tmd folder
  project.ts       finding the root, walking files, resolving types, the id index
  refs.ts          reading and resolving tmd-ref values
  lint.ts          the rule engine, every code
  fix.ts           the safe fixes
  new.ts           tmd new
  export.ts        json, jsonl, csv, sql
  graph.ts         dot and json
  report.ts        human output
  cli.ts           argument parsing and command dispatch, thin
  index.ts         the library entry point
```

The CLI is a thin layer. Everything it does is available from `src/index.ts` if you want to use tmd from code.

## Tests

```
npm test
```

There are two kinds, 109 tests in total:

- **Unit tests** for the YAML parser (every supported construct, line numbers, and a clean failure for every unsupported one), the schema validator (every keyword, nesting, `$ref`, `additionalProperties: false`), file name and type resolution, entity ids and duplicates, reference parsing and resolution, the lint rules, and the fixers.
- **End to end tests** that spawn the real CLI as a subprocess against fixture projects copied to a temp folder, and check stdout, stderr, the exit code, and the `--json` output.

The tests use the built in `node:test` runner and `node:assert/strict`. There is no test library.

`TMD_TODAY=2026-09-18` makes anything date dependent (the `created` placeholder, the W003 deprecation check) deterministic. The tests set it.

## Decisions where the spec was open

The spec left some things unsaid. Here is every choice made while implementing it, so nothing is hidden in the code.

1. **Two codes were added.** The spec describes two checks with no code: "no entity references itself" (section 5.3) and the slug pattern (section 3.1). They became **E011** and **W007**. Both are marked as extensions in `src/types.ts` and in the code table above.
2. **E001 also covers `_type`.** The spec words E001 as being about the file name. A `_type` with no schema is the same problem, so it gets the same code, with the line pointing at the `_type` field.
3. **A file name segment that is not a type name does not make a type.** `notes.Draft.md` and `report.2026 Q1.md` are untyped, not "type Draft". Only a last segment matching `[a-z0-9][a-z0-9-]*` counts as a type segment. Without this rule, ordinary files with dots in their names would all raise E001.
4. **An untyped file with no frontmatter is never E008.** A file with no type segment and no readable frontmatter is an untyped file, so `README.md` is ignored (or W001), never an error. A file that *does* have a type segment and cannot be parsed is E008.
5. **Field order for W005** is `_type` first, then the fields in the order the type schema declares them, then any fields only the common schema declares, then anything the schemas do not mention, in the order the file already has them.
6. **`--fix` edits lines, it does not rewrite the YAML.** Reordering moves whole blocks of raw lines, so comments and formatting survive. A comment line directly above a key moves with that key.
7. **Reserved keys are dropped before validation.** `_type` and any other `_` key never reach the validator, which is what "the validator ignores them" means. Unknown `_` keys in a file are not reported.
8. **`format` is asserted**, see the JSON Schema section above.
9. **Duplicate YAML keys are an error**, see the YAML section above.
10. **`--format sqlite` writes a SQL script**, see the export section above. No dependency was added.
11. **CSV needs a folder**, because there is one file per type. Without `--out` it writes to `tmd-export/`. JSON, JSONL and SQL go to stdout when there is no `--out`, unless `--json` is given, in which case they go to the default file name so that stdout stays a clean JSON summary.
12. **Export runs even when the project has errors.** It prints a warning on stderr and exports what it can. Lint is the command that judges a project, export is not.
13. **Schema problems (E010, E007 on a schema) are reported even when you lint a single file.** A broken schema affects every file, so hiding it would be wrong.
14. **W002 needs the whole project.** When `refs.orphans: warn` is on, a single file lint still reads every file, because you cannot know if something is an orphan without looking at everything. With `orphans: ignore` a single file lint only reads what it needs.
15. **`x-tmd.sections` matches the heading text exactly**, at any heading level, and ignores headings inside fenced code blocks.
16. **`x-tmd.deprecated` is read from `"x-tmd": { "deprecated": "..." }` on the property.** `x-tmd-deprecated` is accepted as well. The warning starts on the date, not after it.
17. **The common schema may not use `additionalProperties: false`**, or every type specific field would fail. This is a property of applying two schemas to one object, not a choice, but it is worth writing down.
18. **A type schema wins over the common schema field by field**, keeping the common `description` when the type schema does not write its own.

## Not implemented

Two things in the spec are deliberately left out, and one dependency rule was bent.

- **The `.tmd/cache/` index cache** (spec section 6.3) is not implemented. The spec says the index "may" be cached. Linting this repo's example project takes a few milliseconds, and a project of a few thousand files stays well inside the spec's two second target, so a cache would only add a way to be wrong. Nothing else depends on it.
- **`tmd mv`** is not implemented. It is open question 2 in the spec, not part of the CLI surface, and the spec has not decided whether it belongs in v1.
- **`@types/node` is a dev dependency**, alongside `typescript`. Without it `tsc --noEmit` cannot typecheck a single call to `node:fs/promises`, so strict typechecking would be impossible. It ships type definitions only, no runtime code. Runtime dependencies are still exactly zero.

## The specs

Both specs this project implements are in `spec/`:

- `spec/TYPED_MARKDOWN_SPEC.md` is the format. It is the source of truth. When this README and the spec disagree, the spec wins and the code is wrong.
- `spec/SECOND_BRAIN_SPEC.md` is the larger system this format serves. It explains why the format looks the way it does.

## License

MIT. Copyright 2026 Alfonso Graziano.
