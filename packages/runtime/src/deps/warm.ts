/**
 * The warm set (D91, D95): the pre-built, read-only layout every artifact resolves without an
 * install. `@mostra/warm`'s `dependencies` are the warm packages; its `node_modules` is the layout.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Environment } from "../log.ts";

/** The warm set: where its layout is and what versions it holds. */
export interface WarmSet {
  /** The real path of its `node_modules`, the layout builds link to. */
  readonly nodeModules: string;
  /** Package name → installed version, sorted by name; written into every `lock.yaml`. */
  readonly packages: Readonly<Record<string, string>>;
}

/** The directory of `@mostra/runtime`'s package.json. */
export function runtimeRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (name === "@mostra/runtime") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/runtime's package.json.");
    dir = parent;
  }
}

function warmMissing(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_WARM_MISSING", { message }));
}

/**
 * Finds the warm set: `MOSTRA_WARM_DIR`, else the `warm` directory beside the runtime package, as
 * the runtime bundle and this repository lay it out. Every listed package must be installed.
 */
export function locateWarmSet(env: Environment): WarmSet {
  const dir = env["MOSTRA_WARM_DIR"] ?? resolve(runtimeRoot(), "..", "warm");
  const manifestFile = join(dir, "package.json");
  if (!existsSync(manifestFile)) throw warmMissing(`No warm package set at ${dir}.`);
  const { dependencies = {} } = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const nodeModules = join(dir, "node_modules");
  const packages: Record<string, string> = {};
  for (const name of Object.keys(dependencies).sort()) {
    const installed = join(nodeModules, name, "package.json");
    if (!existsSync(installed)) throw warmMissing(`The warm package set at ${dir} lacks ${name}.`);
    packages[name] = (JSON.parse(readFileSync(installed, "utf8")) as { version: string }).version;
  }
  return { nodeModules: realpathSync(nodeModules), packages };
}
