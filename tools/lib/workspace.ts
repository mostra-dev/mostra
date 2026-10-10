/**
 * The workspace as data: its packages, their dependencies and dependents. Read from the
 * `package.json` files that `pnpm-workspace.yaml` lists.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { fromRoot, ROOT } from "./repo.ts";

/** One workspace package. */
export interface WorkspacePackage {
  readonly name: string;
  /** Relative to the repository root, `/`-separated. */
  readonly dir: string;
  readonly private: boolean;
  readonly scripts: Readonly<Record<string, string>>;
  /** Names of every dependency, of any kind. */
  readonly dependencies: readonly string[];
  readonly manifest: Readonly<Record<string, unknown>>;
}

interface Manifest {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** The globs of `pnpm-workspace.yaml`. Only `dir/*` and plain directories are used. */
function workspaceGlobs(root: string): string[] {
  const config = parseYaml(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as {
    packages?: string[];
  };
  return config.packages ?? [];
}

/** Lists the workspace packages under `root` (the repository root by default). */
export function listPackages(root: string = ROOT): WorkspacePackage[] {
  const dirs: string[] = [];
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith("/*")) {
      const parent = join(root, glob.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(join(parent, entry.name));
      }
    } else {
      dirs.push(join(root, glob));
    }
  }
  const packages: WorkspacePackage[] = [];
  for (const dir of dirs.sort()) {
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
    if (!manifest.name) continue;
    packages.push({
      name: manifest.name,
      dir: relative(root, dir).split("\\").join("/"),
      private: manifest.private === true,
      scripts: manifest.scripts ?? {},
      dependencies: [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ],
      manifest: manifest as Record<string, unknown>,
    });
  }
  return packages;
}

/** The packages that depend on any of `names`, directly or transitively, plus `names` themselves. */
export function withDependents(
  packages: readonly WorkspacePackage[],
  names: ReadonlySet<string>,
): Set<string> {
  const result = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const pkg of packages) {
      if (result.has(pkg.name)) continue;
      if (pkg.dependencies.some((dep) => result.has(dep))) {
        result.add(pkg.name);
        grew = true;
      }
    }
  }
  return result;
}

/** The workspace package that owns a repository-relative path, if any. */
export function owningPackage(
  packages: readonly WorkspacePackage[],
  path: string,
): WorkspacePackage | undefined {
  let best: WorkspacePackage | undefined;
  for (const pkg of packages) {
    if (pkg.dir === "." || pkg.dir === "") continue;
    if (path === pkg.dir || path.startsWith(`${pkg.dir}/`)) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

/** The package whose directory is the current working directory. */
export function currentPackage(cwd: string = process.cwd()): WorkspacePackage {
  const dir = relative(ROOT, cwd).split("\\").join("/");
  const pkg = listPackages().find((candidate) => candidate.dir === dir);
  if (!pkg) throw new Error(`${cwd} is not a workspace package directory.`);
  return pkg;
}

/** Absolute path of a package directory. */
export function packagePath(pkg: WorkspacePackage): string {
  return fromRoot(pkg.dir);
}
