/** The SDK's own package: its root directory and its release. */
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
      if (manifest.name === "@mostra/sdk" && manifest.version) {
        found = { root: dir, version: manifest.version };
        return found;
      }
    } catch {
      // Keep looking upwards.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/sdk's package.json.");
    dir = parent;
  }
}

/** This SDK's release: the client version an SDK host reports by default. */
export function sdkVersion(): string {
  return own().version;
}

/** The SDK package's directory; `dist/bundles.json` lives under it in a release. */
export function packageRoot(): string {
  return own().root;
}
