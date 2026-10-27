/**
 * Node.js lines (#92): a published package runs on every Node.js its `engines.node` admits, so
 * every package it brings along, Mostra's own and third-party alike, must admit at least those
 * versions too. Otherwise npm prints `EBADENGINE` on the versions in between, which is what
 * `@mostra/protocol`'s `>=24` did under `@mostra/cli`'s `>=22.19` (npm on Node.js 22, 0.6.0 and
 * 0.6.1). The closure is read from the installed `node_modules`, resolved the way Node.js resolves
 * a package, so it holds exactly the versions the lockfile pins.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import semver from "semver";
import type { WorkspacePackage } from "../lib/workspace.ts";

/** One package of a published package's runtime closure. */
export interface ClosureEntry {
  readonly name: string;
  readonly version: string;
  /** Its `engines.node`, when it declares one. */
  readonly node?: string;
  /** How the published package reaches it: names from the package itself, `>`-separated. */
  readonly via: string;
}

interface Manifest {
  name?: string;
  version?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

/** Where Node.js finds `name` from `dir`: the nearest `node_modules/<name>` up the tree, real. */
function resolveFrom(dir: string, name: string): string | undefined {
  for (let at = dir; ; ) {
    const candidate = join(at, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

/**
 * The installed runtime closure of the package in `dir` (its dependencies, optional and peer
 * dependencies, transitively; never development dependencies), and the required dependencies
 * that aren't installed. An optional or peer dependency that isn't installed (another platform's
 * native package) isn't part of what npm installs here, so it's left out.
 */
export function installedClosure(dir: string): { entries: ClosureEntry[]; missing: string[] } {
  const entries: ClosureEntry[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const walk = (at: string, via: string): void => {
    const manifest = readManifest(at);
    const groups: [Record<string, string> | undefined, boolean][] = [
      [manifest.dependencies, true],
      [manifest.optionalDependencies, false],
      [manifest.peerDependencies, false],
    ];
    for (const [deps, required] of groups) {
      for (const name of Object.keys(deps ?? {})) {
        const found = resolveFrom(at, name);
        if (!found) {
          if (required) missing.push(`${via}>${name}`);
          continue;
        }
        if (seen.has(found)) continue;
        seen.add(found);
        const dep = readManifest(found);
        const node = dep.engines?.node;
        entries.push({
          name: dep.name ?? name,
          version: dep.version ?? "?",
          ...(node === undefined ? {} : { node }),
          via: `${via}>${name}`,
        });
        walk(found, `${via}>${name}`);
      }
    }
  };
  walk(dir, readManifest(dir).name ?? dir);
  return { entries, missing };
}

/**
 * Problems with one published package's Node.js line: it must declare one, and every package of
 * its closure must admit every version it admits (a package that declares none admits all).
 */
export function engineProblems(
  pkg: { readonly name: string; readonly dir: string; readonly node?: string | undefined },
  closure: readonly ClosureEntry[],
): string[] {
  if (pkg.node === undefined)
    return [
      `${pkg.dir}/package.json declares no "engines": { "node": … }: a published package names the Node.js lines it runs on (#92).`,
    ];
  if (semver.validRange(pkg.node) === null)
    return [`${pkg.dir}/package.json's engines.node "${pkg.node}" isn't a semver range.`];
  const problems: string[] = [];
  for (const entry of closure) {
    if (entry.node === undefined) continue;
    const valid = semver.validRange(entry.node) !== null;
    if (valid && semver.subset(pkg.node, entry.node, { includePrerelease: false })) continue;
    const floor = semver.minVersion(pkg.node)?.version ?? pkg.node;
    problems.push(
      `${pkg.name} declares node "${pkg.node}" but brings ${entry.name}@${entry.version} (${entry.via}), which declares node "${entry.node}": npm on Node.js ${floor} warns EBADENGINE and it may not run there. Widen ${entry.name}'s engines.node if it runs there, or raise ${pkg.name}'s (#92).`,
    );
  }
  return problems;
}

/** Every published workspace package's Node.js problems, its closure read from `node_modules`. */
export function workspaceEngineProblems(
  packages: readonly WorkspacePackage[],
  root: string,
): string[] {
  const problems: string[] = [];
  for (const pkg of packages) {
    if (pkg.private) continue;
    const dir = join(root, pkg.dir);
    const engines = pkg.manifest["engines"] as { node?: string } | undefined;
    const { entries, missing } = installedClosure(dir);
    for (const path of missing)
      problems.push(
        `${relative(root, dir)}: ${path} isn't installed, so its Node.js line can't be checked: run pnpm install.`,
      );
    problems.push(
      ...engineProblems({ name: pkg.name, dir: pkg.dir, node: engines?.node }, entries),
    );
  }
  return problems;
}
