/** The CLI's own package: its root directory and its release. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let found: { readonly root: string; readonly version: string } | undefined;

function own(): { readonly root: string; readonly version: string } {
  if (found) return found;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "@mostra/cli" && manifest.version) {
        found = { root: dir, version: manifest.version };
        return found;
      }
    } catch {
      // Keep looking upwards.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/cli's package.json.");
    dir = parent;
  }
}

/** This CLI's version (`mostra --version`, the client version it reports, telemetry's `version`). */
export function cliVersion(): string {
  return own().version;
}

/** The CLI package's directory: its `dist/`, `src/` and bundled reference live under it. */
export function packageRoot(): string {
  return own().root;
}

/** Whether this CLI runs from its TypeScript sources (tests), not its build. */
export function fromSource(): boolean {
  return import.meta.url.endsWith(".ts");
}
