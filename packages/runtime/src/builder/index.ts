/**
 * The builder (ARCHITECTURE §1, §3; ROUND-3 §7): the internal `RenderMode` contract with SPA as
 * its implementation (D19 seam 5), and the supervisor's side of the builder child. The supervisor
 * never loads the bundler: it starts a child per build through the process manager, which runs
 * `child/main.ts`, and turns a crash or a timeout into `MOSTRA_BUILD_CRASHED` or
 * `MOSTRA_BUILD_TIMEOUT` (FAILURE_MODEL §2, §9).
 *
 * ```ts
 * const spa = createSpaRenderMode({ processes, log });
 * const result = await spa.build({ stagingDir, entry: "index.tsx", entryHasDefault: true, manifest, nodeModules, … });
 * ```
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Faults } from "../faults.ts";
import type { Environment, Log } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";
import type { FieldCoverage } from "./coverage.ts";
import {
  BUILD_METHOD,
  type BuildRequest,
  type BuildResponse,
  DEV_CHANGED_METHOD,
  DEV_METHOD,
  DEV_RELOAD_METHOD,
  DEV_SERVER_NOTIFICATION,
  DEV_UPDATE_NOTIFICATION,
  type DevChange,
  type DevReady,
  type DevRequest,
  type DevServerBuild,
  STAGING_FILES,
} from "./types.ts";

export { coverageMatcher, type FieldCoverage, type FieldEntry } from "./coverage.ts";
export {
  type BuildRequest,
  type BuildResponse,
  DEV_SECRET_HEADER,
  type DevChange,
  type DevReady,
  type DevRequest,
  type DevServerBuild,
  LIVE_DECLARATION,
  type VersionRegistry,
} from "./types.ts";

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
const SPA_CONFIG_REVISION = 7;

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
  /**
   * Builds the snapshot in `request.stagingDir` into `request.outDir`, resolving packages from
   * `request.nodeModules`: the warm layout or the artifact's lock layout (D95).
   */
  build(request: BuildRequest): Promise<BuildResponse>;
  /** The server bundle a worker loads from a version directory, when the version has one. */
  serverEntry(versionDir: string): string | undefined;
  /**
   * `mostra dev` (VR-08, D140 item 12): a dev server in a builder child of its own, over the dev
   * root's mirror of the source, until {@link DevChild.stop}. Throws `MOSTRA_BUILD_CRASHED` when
   * the child can't start it.
   */
  dev(request: DevRequest, events: DevEvents): Promise<DevChild>;
}

/** What a dev child tells the supervisor as the source changes. */
export interface DevEvents {
  /** The server bundle was built again, or failed to build; `files` changed. */
  server(build: DevServerBuild, files: readonly string[]): void;
  /** Client modules of `files` were updated in place. */
  update(files: readonly string[]): void;
}

/** A running dev child. */
export interface DevChild {
  readonly ready: DevReady;
  /** Tells every page to load again. */
  reload(): Promise<void>;
  /** These files of the mirror changed; resolves once the child acted on them. */
  changed(changes: readonly DevChange[]): Promise<void>;
  /** Resolves when the child ended, for whatever reason. */
  readonly exited: Promise<{ readonly stderrTail: readonly string[] }>;
  stop(): Promise<void>;
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
  /** Default {@link BUILD_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The environment the builder's minimal environment takes `PATH` and `HOME` from. */
  readonly env?: Environment;
  /** Test fault points: `builder:build` with `hang` stops each build's child before it builds. */
  readonly faults?: Faults;
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
      const entry = spaServerEntry(versionDir);
      return entry === undefined ? undefined : join(versionDir, entry);
    },
    async dev(request, events) {
      const child = await options.processes.spawn({
        kind: "builder",
        ownerRef: request.root,
        command: process.execPath,
        args: [childEntry(root)],
        cwd: request.root,
        // A dev server builds for development; nothing else of the supervisor's environment.
        env: { ...childEnv, NODE_ENV: "development" },
        ipc: {
          onNotification: (method, params) => {
            const body = (params ?? {}) as { build?: DevServerBuild; files?: string[] };
            if (method === DEV_SERVER_NOTIFICATION && body.build)
              events.server(body.build, body.files ?? []);
            if (method === DEV_UPDATE_NOTIFICATION) events.update(body.files ?? []);
          },
        },
      });
      const outcome = await Promise.race([
        child
          .request(DEV_METHOD, request as unknown as Record<string, unknown>, {
            timeoutMs: timeoutMs + 1000,
          })
          .then(
            (ready) => ({ kind: "ready" as const, ready: ready as DevReady }),
            (error: unknown) => ({ kind: "error" as const, error }),
          ),
        child.exited.then((exit) => ({ kind: "exit" as const, exit })),
      ]);
      if (outcome.kind !== "ready") {
        await child.stop(2000);
        const why =
          outcome.kind === "error"
            ? ((outcome.error as Error).message ?? String(outcome.error))
            : `it exited (${outcome.exit.signal ?? `code ${outcome.exit.code}`})${outcome.exit.stderrTail.length > 0 ? `\n${outcome.exit.stderrTail.slice(-10).join("\n")}` : ""}`;
        throw new RpcError(
          createDiagnostic("MOSTRA_BUILD_CRASHED", {
            message: `The dev server couldn't start: ${why}`,
          }),
        );
      }
      return {
        ready: outcome.ready,
        reload: async () => {
          await child.request(DEV_RELOAD_METHOD, {}, { timeoutMs: 5000 });
        },
        changed: async (changes) => {
          await child.request(
            DEV_CHANGED_METHOD,
            { changes: changes as unknown as Record<string, unknown>[] },
            { timeoutMs: timeoutMs + 1000 },
          );
        },
        exited: child.exited,
        stop: async () => {
          await child.stop(3000);
        },
      };
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
      // A builder that hangs (issue #18): told to, so it never answers and the limit ends it. A
      // signal from outside raced a fast build; the child itself can't.
      const wire: BuildRequest = options.faults?.hangs("builder:build")
        ? { ...request, hang: true }
        : request;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          child
            .request(BUILD_METHOD, wire as unknown as Record<string, unknown>, {
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

/**
 * The SPA mode's server bundle of a built version, relative to it (`server/entry.mjs`), or
 * `undefined` for a version without server code, which never gets a worker (RT-05).
 */
function spaServerEntry(versionDir: string): string | undefined {
  return existsSync(join(versionDir, "server", "entry.mjs")) ? "server/entry.mjs" : undefined;
}

/** The IDs of the server functions a version's `registry.json` lists, empty when it has none. */
export function readServerFunctions(versionDir: string): ReadonlySet<string> {
  try {
    const registry = JSON.parse(readFileSync(join(versionDir, "registry.json"), "utf8")) as {
      readonly actions?: unknown;
    };
    if (!Array.isArray(registry.actions)) return new Set();
    return new Set(
      registry.actions
        .map((entry) => (entry as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === "string"),
    );
  } catch {
    return new Set();
  }
}

/** The live sources a version's `registry.json` lists (D56), empty when it has none. */
export function readLiveSources(
  versionDir: string,
): readonly { readonly key: string; readonly always?: boolean }[] {
  try {
    const registry = JSON.parse(readFileSync(join(versionDir, "registry.json"), "utf8")) as {
      readonly liveSources?: unknown;
    };
    if (!Array.isArray(registry.liveSources)) return [];
    return registry.liveSources.filter(
      (entry): entry is { key: string; always?: boolean } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { key?: unknown }).key === "string",
    );
  } catch {
    return [];
  }
}

/**
 * The field coverage a published version recorded in its `registry.json` (D109), or `undefined`
 * for a version built before WP-07 or one whose registry can't be read: such a version covers
 * every field ID, so nothing is orphaned by a guess.
 */
export function readFieldCoverage(versionDir: string): FieldCoverage | undefined {
  try {
    const registry = JSON.parse(readFileSync(join(versionDir, "registry.json"), "utf8")) as {
      readonly fields?: FieldCoverage;
    };
    const fields = registry.fields;
    if (fields === undefined || typeof fields.open !== "boolean" || !Array.isArray(fields.entries))
      return undefined;
    return fields;
  } catch {
    return undefined;
  }
}
