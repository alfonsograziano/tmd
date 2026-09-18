/** Loading `.tmd/config.yaml` and matching include / exclude globs. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseYaml, YamlError, type YamlValue } from "./yaml.ts";

export interface Config {
  include: string[];
  exclude: string[];
  untyped: "ignore" | "warn";
  type_in: "filename" | "frontmatter";
  refs: {
    allow_paths: boolean;
    orphans: "warn" | "ignore";
  };
  strict: boolean;
}

export const DEFAULT_CONFIG: Config = {
  include: ["**/*.md"],
  exclude: ["node_modules/**", ".git/**", "lake/**"],
  untyped: "ignore",
  type_in: "filename",
  refs: { allow_paths: true, orphans: "warn" },
  strict: false,
};

export class ConfigError extends Error {}

function stringList(value: YamlValue, field: string): string[] {
  if (!Array.isArray(value)) throw new ConfigError(`${field} must be a list of glob patterns`);
  return value.map((item) => {
    if (typeof item !== "string") throw new ConfigError(`${field} must contain only strings`);
    return item;
  });
}

function oneOf<T extends string>(value: YamlValue, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ConfigError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function parseConfig(text: string): Config {
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    if (err instanceof YamlError) throw new ConfigError(`line ${err.line}: ${err.message}`);
    throw err;
  }
  const raw = parsed.value;
  if (raw === null) return { ...DEFAULT_CONFIG };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("the config must be a mapping");
  const config: Config = {
    ...DEFAULT_CONFIG,
    refs: { ...DEFAULT_CONFIG.refs },
    include: [...DEFAULT_CONFIG.include],
    exclude: [...DEFAULT_CONFIG.exclude],
  };
  const map = raw as { [key: string]: YamlValue };
  if (map["include"] !== undefined) config.include = stringList(map["include"]!, "include");
  if (map["exclude"] !== undefined) config.exclude = stringList(map["exclude"]!, "exclude");
  if (map["untyped"] !== undefined) config.untyped = oneOf(map["untyped"]!, "untyped", ["ignore", "warn"] as const);
  if (map["type_in"] !== undefined) config.type_in = oneOf(map["type_in"]!, "type_in", ["filename", "frontmatter"] as const);
  if (map["strict"] !== undefined) {
    if (typeof map["strict"] !== "boolean") throw new ConfigError("strict must be true or false");
    config.strict = map["strict"];
  }
  const refs = map["refs"];
  if (refs !== undefined && refs !== null) {
    if (typeof refs !== "object" || Array.isArray(refs)) throw new ConfigError("refs must be a mapping");
    const refsMap = refs as { [key: string]: YamlValue };
    if (refsMap["allow_paths"] !== undefined) {
      if (typeof refsMap["allow_paths"] !== "boolean") throw new ConfigError("refs.allow_paths must be true or false");
      config.refs.allow_paths = refsMap["allow_paths"];
    }
    if (refsMap["orphans"] !== undefined) {
      config.refs.orphans = oneOf(refsMap["orphans"]!, "refs.orphans", ["warn", "ignore"] as const);
    }
  }
  const unknown = Object.keys(map).filter(
    (key) => !["include", "exclude", "untyped", "type_in", "refs", "strict"].includes(key),
  );
  if (unknown.length > 0) throw new ConfigError(`unknown setting${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  return config;
}

export async function loadConfig(root: string): Promise<Config> {
  for (const name of ["config.yaml", "config.yml"]) {
    const file = path.join(root, ".tmd", name);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      return parseConfig(text);
    } catch (err) {
      if (err instanceof ConfigError) throw new ConfigError(`.tmd/${name}: ${err.message}`);
      throw err;
    }
  }
  return { ...DEFAULT_CONFIG, refs: { ...DEFAULT_CONFIG.refs } };
}

/** Turn a glob into an anchored regular expression over a posix relative path. */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      const doubled = pattern[i + 1] === "*";
      if (doubled) {
        if (pattern[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

const cache = new Map<string, RegExp>();

export function matchesGlob(pattern: string, relPath: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    cache.set(pattern, re);
  }
  return re.test(relPath);
}

export function isIncluded(config: Config, relPath: string): boolean {
  if (relPath.startsWith(".tmd/")) return false;
  if (!config.include.some((pattern) => matchesGlob(pattern, relPath))) return false;
  return !config.exclude.some((pattern) => matchesGlob(pattern, relPath));
}
