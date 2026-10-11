/**
 * The builder (ARCHITECTURE §1, §3; ROUND-3 §7): the internal `RenderMode` contract with SPA as
 * its implementation (D19 seam 5), and the supervisor's side of the builder child. The supervisor
 * never loads the bundler: it starts a child per build through the process manager, which runs
 * `child/main.ts`, and turns a crash or a timeout into `MOSTRA_BUILD_CRASHED` or
 * `MOSTRA_BUILD_TIMEOUT` (FAILURE_MODEL §2, §9).
 *
 * ```ts
 * const spa = createSpaRenderMode({ processes, log, warm: locateWarmSet(env) });
 * const result = await spa.build({ stagingDir, entry: "index.tsx", entryHasDefault: true, manifest, … });
 * ```
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Environment, Log } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";
import { BUILD_METHOD, type BuildRequest, type BuildResponse, STAGING_FILES } from "./types.ts";

export type { BuildRequest, BuildResponse } from "./types.ts";

/** How long one build may take (FAILURE_MODEL §9). */
export const BUILD_TIMEOUT_MS = 180_000;

/** Packages whose versions define the SPA build; they are part of `buildConfigDigest` (VR-01). */
const BUILD_PACKAGES = [
  "vite",
  "@vitejs/plugin-react",
  "@mdx-js/mdx",
  "remark-frontmatter",
  "remark-gfm",
  "@tailwindcss/vite",
  "oxc-parser",
] as const;

/** Bumped whenever the SPA build's settings change, so older versions aren't reused. */
const SPA_CONFIG_REVISION = 2;

/** What a render mode can deliver for a manifest (ROUND-3 §7). */
export interface RenderCapabilities {
  readonly staticExport: boolean;
  readonly mcpApp: boolean;
  readonly needsWorker: boolean;
}

/**
 * The internal render-mode contract (ROUND-3 §7, D19 seam 5). SPA is v1's only mode; an `rsc`
 * mode implements the same interface later. `dev` arrives with `mostra dev` (WP-10).
 */
export interface RenderMode {
  readonly id: "spa";
  /** The settings that define the build, hashed into `buildConfigDigest`. */
  readonly buildConfig: Readonly<Record<string, unknown>>;
  capabilities(input: { readonly hasServerCode: boolean }): RenderCapabilities;
  /** Builds the snapshot in `request.stagingDir` into `request.outDir`. */
  build(request: Omit<BuildRequest, "nodeModules">): Promise<BuildResponse>;
  /** The server bundle a worker loads from a version directory, when the version has one. */
  serverEntry(versionDir: string): string | undefined;
}

/** The warm set (D91): where its `node_modules` is and what versions it holds. */
export interface WarmSet {
  readonly nodeModules: string;
  /** Package name → installed version, written into each version's `lock.yaml`. */
  readonly packages: Readonly<Record<string, string>>;
}

/** The directory of `@mostra/runtime`'s package.json. */
function runtimeRoot(): string {
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

/** Node's lookup of an installed package's directory, from `from` upwards. */
function packageDir(name: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function versionOf(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string })
    .version;
}

function warmMissing(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_WARM_MISSING", { message }));
}

/**
 * Finds the warm set (D91): `MOSTRA_WARM_DIR`, else the `warm` directory beside the runtime
 * package, as the runtime bundle and this repository lay it out.
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
    const installed = join(nodeModules, name);
    if (!existsSync(join(installed, "package.json"))) {
      throw warmMissing(`The warm package set at ${dir} lacks ${name}.`);
    }
    packages[name] = versionOf(installed);
  }
  return { nodeModules: realpathSync(nodeModules), packages };
}

/** The builder child's entry: the compiled one beside the compiled supervisor, else the source. */
function childEntry(root: string): string {
  return fileURLToPath(import.meta.url).endsWith(".ts")
    ? join(root, "src/builder/child/main.ts")
    : join(root, "dist/builder/child/main.js");
}

/** Options for {@link createSpaRenderMode}. */
export interface SpaRenderModeOptions {
  readonly processes: ProcessManager;
  readonly log: Log;
  readonly warm: WarmSet;
  /** Default {@link BUILD_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The environment the builder's minimal environment takes `PATH` and `HOME` from. */
  readonly env?: Environment;
}

/** The SPA render mode (D19): every build in its own builder child. */
export function createSpaRenderMode(options: SpaRenderModeOptions): RenderMode {
  const root = runtimeRoot();
  const buildPackages: Record<string, string> = {};
  for (const name of BUILD_PACKAGES) {
    const dir = packageDir(name, root);
    if (!dir) throw new Error(`The runtime is missing its build dependency ${name}.`);
    buildPackages[name] = versionOf(dir);
  }
  const buildConfig = {
    mode: "spa",
    revision: SPA_CONFIG_REVISION,
    base: "/",
    sourcemap: true,
    packages: buildPackages,
    stagingFiles: STAGING_FILES,
  };
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  const env = options.env ?? process.env;
  // The builder gets only what it needs: no secrets, nothing that could reach a bundle.
  const childEnv: Environment = {
    PATH: env["PATH"] ?? "/usr/bin:/bin",
    HOME: env["HOME"] ?? "/",
    NODE_ENV: "production",
    ...(env["TMPDIR"] ? { TMPDIR: env["TMPDIR"] } : {}),
  };

  return {
    id: "spa",
    buildConfig,
    capabilities: ({ hasServerCode }) => ({
      staticExport: !hasServerCode,
      mcpApp: true,
      needsWorker: hasServerCode,
    }),
    serverEntry(versionDir) {
      const entry = join(versionDir, "server", "entry.mjs");
      return existsSync(entry) ? entry : undefined;
    },
    async build(request) {
      const child = await options.processes.spawn({
        kind: "builder",
        ownerRef: request.stagingDir,
        command: process.execPath,
        args: [childEntry(root)],
        cwd: request.stagingDir,
        env: childEnv,
        ipc: {},
      });
      const full: BuildRequest = { ...request, nodeModules: options.warm.nodeModules };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          child
            .request(BUILD_METHOD, full as unknown as Record<string, unknown>, {
              timeoutMs: timeoutMs + 1000,
            })
            .then(
              (result) => ({ kind: "result" as const, result: result as BuildResponse }),
              (error: unknown) => ({ kind: "error" as const, error }),
            ),
          child.exited.then((exit) => ({ kind: "exit" as const, exit })),
          new Promise<{ kind: "timeout" }>((done) => {
            timer = setTimeout(() => done({ kind: "timeout" }), timeoutMs);
          }),
        ]);
        if (outcome.kind === "result") return outcome.result;
        if (outcome.kind === "timeout") {
          return failed(
            "MOSTRA_BUILD_TIMEOUT",
            `The build took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
          );
        }
        let exit: Awaited<typeof child.exited> | undefined =
          outcome.kind === "exit" ? outcome.exit : undefined;
        if (outcome.kind === "error") {
          // A crash closes the IPC channel first; give the exit a moment to arrive.
          exit = await Promise.race([
            child.exited,
            new Promise<undefined>((done) => setTimeout(() => done(undefined), 1000)),
          ]);
          if (exit === undefined) {
            options.log.error("builder.failed", { error: outcome.error });
            return failed(
              "MOSTRA_BUILD_CRASHED",
              `The builder failed unexpectedly: ${(outcome.error as Error).message ?? String(outcome.error)}`,
            );
          }
        }
        if (exit === undefined) throw new Error("unreachable");
        const tail = exit.stderrTail.slice(-10).join("\n");
        options.log.warn("builder.crashed", { code: exit.code, signal: exit.signal });
        return failed(
          "MOSTRA_BUILD_CRASHED",
          `The builder exited (${exit.signal ?? `code ${exit.code}`}) before it finished.${tail ? `\n${tail}` : ""}`,
        );
      } finally {
        if (timer) clearTimeout(timer);
        await child.stop(2000);
      }
    },
  };
}

function failed(
  code: "MOSTRA_BUILD_TIMEOUT" | "MOSTRA_BUILD_CRASHED",
  message: string,
): BuildResponse {
  return { ok: false, diagnostics: [createDiagnostic(code, { message })] };
}
