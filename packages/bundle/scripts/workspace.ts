/**
 * Where each workspace package lives (review finding Fable 21): one lookup for the bundle's
 * assembler, its release notes and its npm publish, read from every manifest under the folders
 * REPO_STANDARDS §2 names, never guessed from a package's name. Node.js built-ins only, since the
 * publish job runs it before anything is installed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folders that hold workspace packages: the packages, and first-party plugins (D175 item 2). */
const PACKAGE_FOLDERS: readonly string[] = ["packages", "plugins"];

/** Each workspace package's directory under `root`, by its manifest's name. */
export function workspacePackages(root: string): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const folder of PACKAGE_FOLDERS) {
    if (!existsSync(join(root, folder))) continue;
    for (const dir of readdirSync(join(root, folder))) {
      const path = join(root, folder, dir);
      try {
        const { name } = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as {
          name?: unknown;
        };
        if (typeof name === "string") dirs.set(name, path);
      } catch {
        // Not a package: no manifest, or one that doesn't parse.
      }
    }
  }
  return dirs;
}

/** The directory of the workspace package `name`; throws for one the workspace doesn't hold. */
export function packageDir(dirs: ReadonlyMap<string, string>, name: string): string {
  const dir = dirs.get(name);
  if (dir === undefined) throw new Error(`No workspace package is named ${name}.`);
  return dir;
}
