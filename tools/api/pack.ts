/**
 * The packing check of the `ee/` boundary (D118, EN-09): a published core package contains
 * nothing of `ee/`. It reads the file list `pnpm pack` would publish and refuses
 *
 * - any packed path with an `ee` directory segment (`ee/…`, `dist/ee/…`);
 * - any packed sourcemap whose `sources` resolve into the repository's `ee/` folder, which is how a
 *   bundler that inlined an `ee/` module into `dist/` shows itself.
 *
 * The import rule (`core-never-imports-ee` in dependency-cruiser) stops the source; this proves
 * the artifact users install, whatever the build did.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fromRoot, runSync } from "../lib/repo.ts";

/** A packed path that is, or sits inside, an `ee` directory. */
const EE_SEGMENT = /(^|\/)ee(\/|$)/;

/**
 * The `ee/` leaks in one package's packed files. `readMap` reads a packed sourcemap (a path
 * relative to the package directory) or returns `undefined` when it can't.
 */
export function eeLeaks(
  packageDir: string,
  files: readonly string[],
  readMap: (path: string) => string | undefined,
  root: string = fromRoot(),
): string[] {
  const problems: string[] = [];
  const ee = join(root, "ee") + sep;
  for (const file of files) {
    if (EE_SEGMENT.test(file)) problems.push(`packs ${file}, a file under ee/ (D118).`);
    if (!file.endsWith(".map")) continue;
    const text = readMap(file);
    if (text === undefined) continue;
    let map: { sources?: unknown; sourceRoot?: unknown };
    try {
      map = JSON.parse(text) as typeof map;
    } catch {
      problems.push(`packs ${file}, a sourcemap that isn't JSON.`);
      continue;
    }
    const sourceRoot = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
    for (const source of Array.isArray(map.sources) ? map.sources : []) {
      if (typeof source !== "string") continue;
      const from = join(packageDir, dirname(file));
      const path = resolve(from, sourceRoot, source.replace(/^file:\/\//, ""));
      if (`${path}${sep}`.startsWith(ee))
        problems.push(`packs ${file}, built from ${relative(root, path)} in ee/ (D118).`);
    }
  }
  return problems;
}

/** The files `pnpm pack` would publish for the package in `dir`. */
export function packedFiles(dir: string): string[] {
  const listed = runSync("pnpm", ["pack", "--dry-run", "--json"], { cwd: dir });
  if (listed.code !== 0) throw new Error(`pnpm pack --dry-run failed: ${listed.stderr.trim()}`);
  const parsed = JSON.parse(listed.stdout) as { files: { path: string }[] };
  return parsed.files.map((file) => file.path);
}

/** The packing check for the package in `dir`: its problems, prefixed for the gate. */
export function packCheck(dir: string): string[] {
  return eeLeaks(dir, packedFiles(dir), (path) => {
    try {
      return readFileSync(join(dir, path), "utf8");
    } catch {
      return undefined;
    }
  });
}
