/**
 * Which runtime a host runs (RT-01, D85). In order:
 *
 * 1. `bundle`, a directory the caller names (the SDK's option), then `MOSTRA_BUNDLE`;
 * 2. `MOSTRA_RUNTIME_BIN`, a `mostra-runtime` entry run with this process's Node (tests and
 *    development);
 * 3. the bundle this package itself sits in (the CLI inside a bundle);
 * 4. the bundle this package's release pins (`bundles.json`), from the cache or downloaded;
 * 5. a development checkout's built runtime beside this package.
 *
 * Anything a bundle supplies is checked first: its setup marker must match it, or setup runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BundlePins, createDiagnostic, RpcError } from "@mostra/protocol";
import { type InstallProgress, installPinned } from "./bundle/cache.ts";
import {
  type Bundle,
  type Environment,
  readBundle,
  readSetup,
  type SetupStep,
  setupBundle,
} from "./bundle/setup.ts";
import { bundlePlatform } from "./platform.ts";
import { packageRoot } from "./version.ts";

/** A runtime to spawn: the Node.js to run it with and its entry points. */
export interface Runtime {
  /** How it was found. */
  readonly source: "bundle" | "override" | "development";
  /** The Node.js executable: the bundle's own, or this process's for the others. */
  readonly node: string;
  /** `mostra-runtime`'s entry (`host`, `daemon`, `service`). */
  readonly runtimeEntry: string;
  /** The `mostra` CLI's entry, when this runtime has one. */
  readonly cliEntry?: string;
  /** The bundle, when the runtime is one. */
  readonly bundle?: Bundle;
}

/** Options of {@link resolveRuntime}. */
export interface RuntimeOptions {
  /** An extracted bundle to use, ahead of everything else. */
  readonly bundle?: string | undefined;
  /** The environment: `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the cache's variables. */
  readonly env?: Environment | undefined;
  /** Gives up a download or setup. */
  readonly signal?: AbortSignal | undefined;
  /** Progress of a download or setup, for a person waiting (the CLI prints it on stderr). */
  readonly onProgress?: ((progress: InstallProgress) => void) | undefined;
}

/** The pins this build carries: `dist/bundles.json`, which the release writes before publishing. */
export function readPins(env: Environment): BundlePins | undefined {
  const file = env["MOSTRA_TEST_BUNDLE_PINS"] || join(packageRoot(), "dist", "bundles.json");
  if (!existsSync(file)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    data = undefined; // not JSON (or unreadable): the same refusal as a file of the wrong shape
  }
  const parsed = BundlePins.safeParse(data);
  if (!parsed.success) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
        message: `${file} isn't a release's bundle pins.`,
      }),
    );
  }
  return parsed.data;
}

/** The bundle this package was installed into, if any: `<root>/lib/node_modules/@mostra/sdk`. */
export function enclosingBundle(): string | undefined {
  const root = resolve(packageRoot(), "..", "..", "..", "..");
  return existsSync(join(root, "bundle.json")) &&
    existsSync(join(root, "lib", "node_modules", "@mostra", "sdk"))
    ? root
    : undefined;
}

/** The runtime described by a bundle, once it is set up. */
async function fromBundle(root: string, options: RuntimeOptions): Promise<Runtime> {
  let bundle = await readBundle(resolve(root));
  if (!(await readSetup(bundle))) {
    await setupBundle(bundle.root, {
      env: options.env,
      signal: options.signal,
      onStep: (step: SetupStep) => options.onProgress?.({ step }),
    });
    bundle = await readBundle(bundle.root);
  }
  return runtimeOf(bundle);
}

/** A bundle's entry points as a runtime. */
export function runtimeOf(bundle: Bundle): Runtime {
  const { root, info } = bundle;
  return {
    source: "bundle",
    node: join(root, info.node.path),
    runtimeEntry: join(root, info.entries.runtime),
    cliEntry: join(root, info.entries.cli),
    bundle,
  };
}

/** A development checkout's runtime: `packages/runtime/dist/bin.js` beside this package. */
function development(): Runtime | undefined {
  const root = packageRoot();
  const entry = resolve(root, "..", "runtime", "dist", "bin.js");
  if (!existsSync(entry)) return undefined;
  const cli = resolve(root, "..", "cli", "dist", "bin.js");
  return {
    source: "development",
    node: process.execPath,
    runtimeEntry: entry,
    ...(existsSync(cli) ? { cliEntry: cli } : {}),
  };
}

/**
 * Finds the runtime to spawn, downloading and setting up the pinned bundle when nothing nearer
 * exists. Throws `MOSTRA_PLATFORM_UNSUPPORTED`, `MOSTRA_ENV_RUNTIME_MISSING` (a
 * `MOSTRA_RUNTIME_BIN` that doesn't exist), `MOSTRA_ENV_BUNDLE_UNAVAILABLE`,
 * `MOSTRA_ENV_BUNDLE_INVALID` or `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`.
 */
export async function resolveRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const env = options.env ?? process.env;
  const named = options.bundle ?? (env["MOSTRA_BUNDLE"] || undefined);
  if (named !== undefined) return fromBundle(named, { ...options, env });
  const override = env["MOSTRA_RUNTIME_BIN"];
  if (override) {
    if (!existsSync(override)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", {
          message: `MOSTRA_RUNTIME_BIN names ${override}, which doesn't exist.`,
        }),
      );
    }
    return { source: "override", node: process.execPath, runtimeEntry: override };
  }
  const enclosing = enclosingBundle();
  if (enclosing !== undefined) return fromBundle(enclosing, { ...options, env });
  const pins = readPins(env);
  if (pins !== undefined) {
    const bundle = await installPinned(pins, {
      env,
      platform: bundlePlatform(),
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return runtimeOf(bundle);
  }
  const checkout = development();
  if (checkout !== undefined) return checkout;
  throw new RpcError(
    createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
      message:
        "This build of @mostra/sdk pins no runtime bundle and has no runtime beside it; set MOSTRA_BUNDLE to an extracted bundle.",
    }),
  );
}
