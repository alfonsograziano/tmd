# Example project

A tiny Typed Markdown project: two cars, two engines, two people. It lints clean.

Run it from this folder:

    node ../src/cli.ts lint
    node ../src/cli.ts check cars/honda.car.md
    node ../src/cli.ts refs k20.engine
    node ../src/cli.ts export --format csv --out /tmp/cars-csv

This file has no type segment and no `_type`, so the linter ignores it.
