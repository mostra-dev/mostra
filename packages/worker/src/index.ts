/**
 * `@mostra/worker`: the process that runs one artifact version's server code (ARCHITECTURE §7,
 * RT-03). The supervisor starts it through a `WorkerLauncher` (D124) and speaks the worker channel
 * of `@mostra/protocol` to it; nothing imports it as a library except launchers that need its
 * entry point.
 *
 * ```ts
 * import { workerEntry } from "@mostra/worker";
 * spawn(process.execPath, [workerEntry(), "--channel", "unix:/tmp/w.sock", "--version-dir", dir]);
 * ```
 *
 * @packageDocumentation
 */
import { fileURLToPath } from "node:url";

export { runWorker, type WorkerOptions } from "./worker.ts";

/** The absolute path of the worker's process entry, `main.js` (or `main.ts` from source). */
export function workerEntry(): string {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return fileURLToPath(new URL(`./main${extension}`, import.meta.url));
}
