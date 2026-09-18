# Broken example

Every error and warning code fires in this project on purpose, E001 to E011 and W001 to W007. Run `node ../../src/cli.ts lint` from this folder. It exits 1.

The domain is the same as the clean example next door: projects, tasks, and people. Each file below is wrong in one or two specific ways, so you can see what each code looks like in real output.

| File | What is wrong | Codes |
|---|---|---|
| `.tmd/bad.schema.json` | The schema itself is broken: a type that is not a JSON Schema type, `required` written as a string, and a `$ref` to a `$defs` entry that does not exist. | E010 |
| `.tmd/ghost.schema.json` | The schema defines `_secret`, and keys starting with `_` belong to the format. | E007 |
| `tasks/import-notes.task.md` | No `title`, which is required. `status: running` is not in the enum. `urgency` is a field the schema does not know. `project` points at `second-brian.project`, which is a typo for a real id. `owner` is deprecated. The fields are not in schema order. It also shares its id with the file in `archive/`. | E002, E003, E004, E006, W003, W005 |
| `archive/import-notes.task.md` | Same slug and same type as the file above, so both claim the id `import-notes.task`. | E006 |
| `tasks/pack-the-books.task.md` | `project` points at a person instead of a project. The assignee is written as a relative path instead of an id. The body has no `## Notes` heading, and the schema asks for one. | E005, E009, W004 |
| `tasks/loop.task.md` | The task is listed as its own blocker. | E011 |
| `tasks/broken-yaml.task.md` | The frontmatter uses a block scalar (`|`), which this YAML subset does not read. | E008 |
| `tasks/backup.routine.md` | The file name declares type `routine`, and there is no `routine` schema. | E001 |
| `tasks/groceries.person.md` | The file name says `person` and `_type` says `task`. `_type` wins, and the linter tells you the two disagree. | W006 |
| `tasks/My_Task.task.md` | The slug is not lowercase letters, digits, and hyphens. | W007 |
| `notes/weird.md` | `_type: Not A Type` is not a valid type name. | E007 |
| `notes/random.md` | A plain markdown file with no type. The config sets `untyped: warn`, so it is reported instead of ignored. | W001 |
| `people/nobody.person.md` | Nothing in the project points at this person. | W002 |
| `README.md` | This file. It is untyped too, so it gets the same warning as `notes/random.md`. | W001 |

`people/alfonso.person.md` and `projects/second-brain.project.md` are only here as reference targets, so the wrong references above have something real to be compared against. They still get W002, because with `refs.orphans: warn` on, and a reference graph this broken, almost nothing is pointed at.
