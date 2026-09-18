# Example project

A tiny Typed Markdown project: two projects, three tasks, two people. It lints clean, with zero errors and zero warnings.

Run it from this folder:

    node ../src/cli.ts lint
    node ../src/cli.ts check tasks/write-schemas.task.md
    node ../src/cli.ts refs second-brain.project
    node ../src/cli.ts export --format csv --out /tmp/tmd-csv

`refs.orphans` is set to `warn` in `.tmd/config.yaml`, which is the strictest setting, and the project still has no W002 warning. Something points at every entity: tasks point at their project, people point at the task they are on and at the projects they are part of, and each project points at its next task. If you add a file here, link it from somewhere, or the linter will tell you it is floating.

This file has no type segment and no `_type`, so the linter ignores it.
