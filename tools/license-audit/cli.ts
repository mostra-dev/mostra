#!/usr/bin/env node
/**
 * License audit (DP-06, KT-02, D14, D20, D26). Everything Mostra publishes ships only
 * OSI-approved dependencies, and nothing anywhere comes from pnpm's PolyForm-licensed `pnpr/`.
 *
 * It walks the installed production dependency closure of every published workspace package and,
 * for each dependency:
 * - evaluates the `license` SPDX expression against the OSI allowlist below;
 * - scans its license files for non-OSI license texts that a permissive `license` field can hide
 *   (PolyForm, BSL, SSPL, Elastic, Commons Clause, FSL, "SEE LICENSE IN").
 *
 *   node tools/license-audit/cli.ts [--root <workspace>]
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import parseSpdx from "spdx-expression-parse";
import { fail, ROOT } from "../lib/repo.ts";
import { listPackages } from "../lib/workspace.ts";

/**
 * OSI-approved licenses accepted in the core. Strong copyleft (GPL, AGPL) is OSI-approved but left
 * off: shipping it inside Apache-2.0 bundles needs Mirza's decision first. Extending this list is a
 * reviewed change.
 */
export const OSI_ALLOWLIST: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "BSD-1-Clause",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  // OSI-approved, file-level weak copyleft like MPL-2.0: elkjs, which Mermaid (a D26 kit default)
  // depends on, ships under it (VERIFIED_FACTS, WP-04).
  "EPL-2.0",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "PostgreSQL",
  "Python-2.0",
  "UPL-1.0",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]);

/** License texts that must never ship, whatever a package's `license` field says. */
const FORBIDDEN_TEXTS: readonly [RegExp, string][] = [
  [/PolyForm/i, "PolyForm"],
  [/Business Source License/i, "Business Source License"],
  [/Server Side Public License/i, "SSPL"],
  [/Elastic License/i, "Elastic License"],
  [/Commons Clause/i, "Commons Clause"],
  [/Functional Source License/i, "Functional Source License"],
];

/**
 * Licenses read from a package's own license file where its manifest declares none, each checked
 * by hand against the published tarball and recorded in VERIFIED_FACTS. Exact versions only, so
 * an upgrade is checked again.
 */
const VERIFIED_LICENSES: ReadonlyMap<string, string> = new Map([
  // `license` file: "The MIT License (MIT)"; no `license` field (VERIFIED_FACTS, WP-04).
  ["khroma@2.1.0", "MIT"],
]);

/** Packages that belong to pnpm's PolyForm-licensed pnpr subsystem (D20). */
const PNPR = /^@pnpm\/pnpr($|\.)/;

/**
 * pnpm releases whose published code includes `pnpr/` (D94): pnpm 12's native binaries
 * (`@pnpm/exe.*`) link pnpr crates, and pnpm 11's bundle contains `pnpr/client`, though both
 * declare MIT. Only pnpm 10 is free of it.
 */
const PNPM_EXE = /^@pnpm\/exe($|\.)/;
const PNPM_FREE_OF_PNPR_BELOW = 11;

/**
 * Private packages whose dependencies still reach users: the warm set ships in the runtime bundle
 * (D91, WP-11), so its packages are audited like a published package's.
 */
const SHIPPED_PRIVATE: ReadonlySet<string> = new Set(["@mostra/warm"]);

type Spdx =
  | { license: string; plus?: boolean }
  | { left: Spdx; conjunction: "and" | "or"; right: Spdx };

/** Whether an SPDX expression is acceptable: every AND branch and some OR branch on the allowlist. */
export function spdxAllowed(expression: string): boolean {
  let tree: Spdx;
  try {
    tree = parseSpdx(expression) as Spdx;
  } catch {
    return false;
  }
  const allowed = (node: Spdx): boolean =>
    "license" in node
      ? OSI_ALLOWLIST.has(node.license)
      : node.conjunction === "or"
        ? allowed(node.left) || allowed(node.right)
        : allowed(node.left) && allowed(node.right);
  return allowed(tree);
}

/** One installed dependency. */
interface Installed {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly license: unknown;
  readonly via: string;
}

function readManifest(dir: string): Record<string, unknown> | undefined {
  const file = join(dir, "package.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : undefined;
}

/**
 * A manifest's license as an SPDX expression. Besides the `license` string, old packages use the
 * deprecated forms npm still documents: `license: { type }` and `licenses: [{ type }, …]`, the
 * latter meaning the user may choose any of them (so `A OR B`).
 */
function declaredLicense(manifest: Record<string, unknown>): string | undefined {
  const typeOf = (value: unknown): string | undefined =>
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          typeof (value as { type?: unknown }).type === "string"
        ? (value as { type: string }).type
        : undefined;
  if (manifest["license"] !== undefined) return typeOf(manifest["license"]);
  const legacy = manifest["licenses"];
  if (!Array.isArray(legacy) || legacy.length === 0) return undefined;
  const types = legacy.map(typeOf);
  if (types.some((type) => type === undefined)) return undefined;
  return types.length === 1 ? types[0] : `(${types.join(" OR ")})`;
}

/** Node's lookup: the nearest `node_modules/<name>` from `from` upwards. */
function locate(name: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The installed production closure of `rootDir`'s package (dependencies, optional and peer), excluding itself. */
function closure(rootDir: string, rootName: string): Installed[] {
  const seen = new Map<string, Installed>();
  const queue: { dir: string; via: string }[] = [{ dir: realpathSync(rootDir), via: rootName }];
  while (queue.length > 0) {
    const { dir, via } = queue.shift() as { dir: string; via: string };
    const manifest = readManifest(dir) ?? {};
    // Peers count when they are installed: a bridge package can pull an engine in that way.
    const deps = {
      ...((manifest["dependencies"] ?? {}) as Record<string, string>),
      ...((manifest["optionalDependencies"] ?? {}) as Record<string, string>),
      ...((manifest["peerDependencies"] ?? {}) as Record<string, string>),
    };
    for (const name of Object.keys(deps)) {
      const found = locate(name, dir);
      if (!found || seen.has(found)) continue;
      const own = readManifest(found) ?? {};
      const entry: Installed = {
        name,
        version: String(own["version"] ?? "?"),
        dir: found,
        license: declaredLicense(own),
        via: `${via} > ${name}`,
      };
      seen.set(found, entry);
      queue.push({ dir: found, via: entry.via });
    }
  }
  return [...seen.values()];
}

function licenseFiles(dir: string, depth = 3): string[] {
  const files: string[] = [];
  const walk = (current: string, level: number): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory() && level < depth) walk(path, level + 1);
      else if (
        entry.isFile() &&
        /^(licen[cs]e|copying|notice)/i.test(entry.name) &&
        statSync(path).size < 512_000
      ) {
        files.push(path);
      }
    }
  };
  walk(dir, 0);
  return files;
}

/** The problems with one dependency. */
export function dependencyProblems(dep: Installed): string[] {
  const problems: string[] = [];
  const at = `${dep.name}@${dep.version} (${dep.via})`;
  if (PNPR.test(dep.name))
    problems.push(`${at} is part of pnpm's PolyForm-licensed pnpr subsystem (D20).`);
  if (PNPM_EXE.test(dep.name))
    problems.push(`${at} is pnpm's native binary, which links PolyForm-licensed pnpr code (D94).`);
  if (dep.name === "pnpm" && !(Number.parseInt(dep.version, 10) < PNPM_FREE_OF_PNPR_BELOW))
    problems.push(
      `${at} bundles code from pnpm's PolyForm-licensed pnpr/ directory; use pnpm 10 (D94).`,
    );
  const license =
    typeof dep.license === "string"
      ? dep.license
      : VERIFIED_LICENSES.get(`${dep.name}@${dep.version}`);
  if (!license) problems.push(`${at} declares no SPDX license.`);
  else if (!spdxAllowed(license))
    problems.push(`${at} is licensed "${license}", which is not on the OSI allowlist.`);
  for (const file of licenseFiles(dep.dir)) {
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of FORBIDDEN_TEXTS) {
      if (pattern.test(text))
        problems.push(`${at} ships ${label} terms in ${file.slice(dep.dir.length + 1)}.`);
    }
  }
  return problems;
}

/** Audits every published package under `root`. */
export function audit(root: string): { problems: string[]; checked: number; published: string[] } {
  const problems: string[] = [];
  const published = listPackages(root).filter(
    (pkg) => !pkg.private || SHIPPED_PRIVATE.has(pkg.name),
  );
  const checked = new Set<string>();
  for (const pkg of published) {
    for (const dep of closure(join(root, pkg.dir), pkg.name)) {
      if (checked.has(dep.dir)) continue;
      checked.add(dep.dir);
      problems.push(...dependencyProblems(dep));
    }
  }
  const lockfile = join(root, "pnpm-lock.yaml");
  if (existsSync(lockfile)) {
    for (const match of readFileSync(lockfile, "utf8").matchAll(/^\s+'?(@pnpm\/pnpr[^@'\s]*)@/gm)) {
      problems.push(
        `pnpm-lock.yaml resolves ${match[1]}, part of pnpm's PolyForm-licensed pnpr subsystem (D20).`,
      );
    }
  }
  return {
    problems: [...new Set(problems)],
    checked: checked.size,
    published: published.map((pkg) => pkg.name),
  };
}

function main(): void {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = values.root ?? ROOT;
  const result = audit(root);
  if (result.problems.length > 0) fail(result.problems, "license audit");
  console.log(
    `✓ license audit: ${result.checked} production dependencies of ${result.published.length} published packages are OSI-licensed; no pnpr`,
  );
}

if (import.meta.main) main();
