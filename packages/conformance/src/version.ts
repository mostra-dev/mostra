/** The kit's own release, from its package.json (found upwards from this module). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let found: string | undefined;

/** This kit's release: what it reports to a host's shim and to an instance. */
export function kitVersion(): string {
  if (found !== undefined) return found;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "@mostra/conformance" && manifest.version) {
        found = manifest.version;
        return found;
      }
    } catch {
      // Keep looking upwards.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/conformance's package.json.");
    dir = parent;
  }
}
