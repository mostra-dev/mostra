/**
 * The workspace mirror (`mirror.ts`) as a process of its own, for suites outside this package (the
 * browser suites): it serves the installed closure of the kit's on-demand libraries, prints
 * `{ "url": … }` on one line, and stops when its stdin closes. Run with
 * `node packages/runtime/test/mirror-process.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedClosure, startMirror } from "./mirror.ts";

const kit = fileURLToPath(new URL("../../kit/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(kit, "package.json"), "utf8")) as {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
// The kit's on-demand libraries, as installed beside it for its own tests (`kitPeers`' optional
// peers; the pins it applies without installing them have no copy to serve).
const roots = Object.keys(manifest.peerDependencies ?? {}).filter(
  (name) =>
    manifest.peerDependenciesMeta?.[name]?.optional === true &&
    existsSync(join(kit, "node_modules", name, "package.json")),
);
const mirror = await startMirror(installedClosure(kit, roots));
process.stdout.write(`${JSON.stringify({ url: mirror.url })}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  void mirror.close().then(() => process.exit(0));
});
