/** Shared test helpers: temporary projects on disk and a real CLI subprocess. */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(REPO_ROOT, "src", "cli.ts");
export const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");

const temporary: string[] = [];

process.on("exit", () => {
  // Best effort cleanup; the OS clears the temp folder anyway.
});

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tmd-test-"));
  temporary.push(dir);
  return dir;
}

export async function cleanup(): Promise<void> {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
}

/** Write a project from a map of relative path to file content. */
export async function makeProject(files: { [relPath: string]: string }): Promise<string> {
  const root = await tempDir();
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

/** Copy one of the fixture projects to a temp folder so tests can change it. */
export async function copyFixture(name: string): Promise<string> {
  const root = await tempDir();
  await cp(path.join(FIXTURES, name), root, { recursive: true });
  return root;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the real CLI as a subprocess. */
export function runCli(args: string[], cwd: string, env: { [key: string]: string } = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        cwd,
        env: { ...process.env, NO_COLOR: "1", TMD_TODAY: "2026-09-18", ...env },
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** Codes seen in a human readable lint run, in order. */
export function codesIn(text: string): string[] {
  return [...text.matchAll(/\b([EW]\d{3})\b/g)].map((match) => match[1]!);
}

export const CAR_SCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "car",
    type: "object",
    additionalProperties: false,
    required: ["name", "year"],
    properties: {
      name: { type: "string", minLength: 1, description: "What the car is called." },
      year: { type: "integer", minimum: 1886, description: "The model year." },
      status: { enum: ["owned", "sold", "wishlist"], default: "owned" },
      engine: { type: "string", format: "tmd-ref", "x-tmd-ref": "engine" },
      owners: { type: "array", items: { type: "string", format: "tmd-ref", "x-tmd-ref": "person" } },
    },
  },
  null,
  2,
);

export const ENGINE_SCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "engine",
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: { type: "string" }, twin: { type: "string", format: "tmd-ref", "x-tmd-ref": "engine" } },
  },
  null,
  2,
);

export const PERSON_SCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "person",
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: { type: "string" } },
  },
  null,
  2,
);

/** A project with the three standard schemas and whatever files a test adds. */
export function withSchemas(files: { [relPath: string]: string }, config = "refs:\n  orphans: ignore\n"): {
  [relPath: string]: string;
} {
  return {
    ".tmd/config.yaml": config,
    ".tmd/car.schema.json": CAR_SCHEMA,
    ".tmd/engine.schema.json": ENGINE_SCHEMA,
    ".tmd/person.schema.json": PERSON_SCHEMA,
    ...files,
  };
}
