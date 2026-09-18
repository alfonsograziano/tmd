# AGENTS.md

The contract for coding agents working in this repository. Read it before you change anything.

## What this repo is

`tmd` is the reference implementation of the Typed Markdown format. It is a CLI and a small library that lint, scaffold, and export markdown files that carry typed frontmatter.

## The spec is the source of truth

`spec/TYPED_MARKDOWN_SPEC.md` defines the format. It is the source of truth. When the code and the spec disagree, the code is wrong.

When the code, the README, and the spec disagree, the spec wins and the code is the bug. Do not change the spec files to match the code. If the spec is wrong or unclear, say so in the pull request and write the decision in the "Decisions where the spec was open" section of the README, so the next reader sees it. Never quietly skip part of the spec.

## Hard rules

1. **Zero runtime dependencies.** `dependencies` in `package.json` stays `{}`. No exceptions, not even a tiny one. The dev dependencies are `typescript` and `@types/node`, and nothing else. No test library, no linter package, no bundler.
2. **No build step.** Node 24 runs the TypeScript source directly. There is no `dist/`, no transpile, no watch mode. `src/cli.ts` is the binary, with a shebang.
3. **Only erasable TypeScript.** Node strips types; it does not compile them. No `enum`, no `namespace`, no parameter properties, no decorators. `erasableSyntaxOnly` is on in `tsconfig.json`, so `tsc` will tell you.
4. **Imports keep the `.ts` extension**, for example `import { lint } from "./lint.ts"`.
5. **Strict types.** `npm run typecheck` must pass. No `any` in an exported signature. `noUncheckedIndexedAccess` is on, so index reads need a guard or a `!` you can justify.
6. **Exit codes**: 0 means no errors, 1 means errors were found, 2 means the tool itself failed. Never use any other code.
7. **Every command supports `--json`**, and the diagnostic shape is `{ path, line, code, level, field, message, hint }`.
8. **Never hard wrap markdown.** One paragraph is one line in the source, in the README, in this file, and in commit messages.

## How to run things

```
npm test             # everything, node --test on test/*.test.ts
npm run typecheck    # tsc --noEmit, strict
node --test test/yaml.test.ts       # one file
node src/cli.ts lint examples       # the tool itself, on the clean example project
node src/cli.ts lint examples/broken # the project that fails on purpose
```

Tests use `node:test` and `node:assert/strict`. `test/helpers.ts` has the helpers: `makeProject` writes a project from a map of paths to content, `copyFixture` copies a fixture to a temp folder so a test can change it, and `runCli` spawns the real CLI and returns `{ code, stdout, stderr }`.

Set `TMD_TODAY=2026-09-18` for anything that depends on the date. The tests already do.

## Where things live

| Path | What it holds |
|---|---|
| `src/yaml.ts` | The YAML subset parser. It reports line numbers per key and refuses what it does not support. |
| `src/jsonschema.ts` | The JSON Schema draft 2020-12 validator subset, and the schema checker behind E010. |
| `src/lint.ts` | The rule engine. Every code from E001 to E011 and W001 to W007 is raised here or in `schemas.ts`. |
| `src/fix.ts` | The safe fixes for W004 and W005, and the placeholder values. |
| `src/cli.ts` | Argument parsing with `node:util` `parseArgs`, and command dispatch. Keep it thin. |
| `test/fixtures/` | Whole projects on disk: `clean`, `broken`, `frontmatter-type`. The tests own them. They are not the example project, and they do not have to use the same types. |
| `examples/` | The documented example project, plus `examples/broken/`. Its types are `project`, `task`, and `person`. The README quotes real output from both, so re-run the commands when you change a file there. |

## When you change behaviour

- Add or update a unit test **and** an end to end test. A rule with no end to end test does not exist.
- If a lint message changes, check `README.md`. Every block of lint output in it was copied from a real run, and must stay that way. Re-run the command and paste the new output.
- If you add a code, add it to `CODES` in `src/types.ts`, to the table in the README, and to `examples/broken/` so that it actually fires somewhere. The end to end test asserts that every code fires in that project.
- If you add a CLI flag, add it to `HELP` in `src/cli.ts` and to the CLI reference in the README.
- Run `npm test` and `npm run typecheck` before you hand work over. Both must be green.

## Style

- Simple English. Short sentences. No hype, no marketing.
- No em dashes anywhere, in code comments, docs, or commit messages.
- Comments explain why, not what. The code says what.
- Error messages name the field, say what was expected, and say what was found. Every diagnostic that can carry a `hint` should carry one, because agents read it to know the fix.
