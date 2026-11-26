/**
 * Web demos (D185, TM-08): a demo is a front end an artifact builds from its own source and keeps
 * in its version. This module builds them: one build at a time per demo folder, as a child of the
 * process manager in its own group (a Job Object on Windows), ended with everything it started on
 * its time limit or a cancel, in the user's own environment with `MOSTRA_DEMO_BASE`, the path the
 * demo is served under; checks the output (a page, every file under the base); and keeps it in the
 * home's cache by the digest of its inputs (its source's content, command, settings and base), so
 * an unchanged demo is never built twice.
 *
 * ```ts
 * const demos = createDemos({ home, processes, log, env });
 * const inputs = await demos.inputs("app", spec, artifactDir);   // its digest joins envDigest
 * const built = await demos.build(inputs);                        // { status, dir } or a failure
 * ```
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  createDiagnostic,
  DEMO_TIMEOUT_DEFAULT_MS,
  type DemoBuildSpec,
  type DemoSpec,
  type Diagnostic,
  demoBase,
  durationMs,
  isDemoBuild,
  RpcError,
} from "@mostra/protocol";
import ignore from "ignore";
import type { Environment, Log } from "../log.ts";
import { programCommand, removeTree, renamePath } from "../platform/index.ts";
import { demoEnvironment, type ProcessManager } from "../processes/index.ts";
import { canonicalJson, listingDigest, sha256Hex } from "../publish/digest.ts";

/** Folders a demo's source digest never reads: installs, caches and build tools' own state. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".mostra",
  ".next",
  ".turbo",
  ".cache",
  ".vite",
  ".svelte-kit",
  ".parcel-cache",
  ".angular",
]);
/** Files a demo's source digest never reads: editors' and Finder's own. */
const SKIPPED_FILE = /^(?:\.DS_Store|\.#.*|#.*#|.*~|.*\.sw[a-px])$/;
/** How many lines of a build's log a failure shows. */
const LOG_LINES = 30;
/** How many lines of a build's log are kept while it runs. */
const LOG_KEPT = 400;
/** How long a stopped build gets before its group is killed. */
const STOP_GRACE_MS = 3000;

/** What a demo is built from, and the digest of all of it. */
export interface DemoInputs {
  readonly name: string;
  readonly spec: DemoBuildSpec;
  /** The demo's project folder, absolute. */
  readonly sourceDir: string;
  /** The folder its build writes, absolute. */
  readonly outputDir: string;
  /** The path it is built for (`MOSTRA_DEMO_BASE`). */
  readonly base: string;
  /** SHA-256 of its source listing, command, settings and base. */
  readonly digest: string;
}

/** A demo built, or found built. */
export interface BuiltDemo {
  readonly status: "built" | "cached";
  /** The cached output: the folder the version's `client/_mostra/demos/<name>/` copies. */
  readonly dir: string;
  readonly files: number;
  readonly ms: number;
}

/** A demo's build that failed: its diagnostic, with the build's last log lines. */
export interface FailedDemo {
  readonly status: "failed";
  readonly diagnostic: Diagnostic;
}

/** Builds demos and keeps their output. */
export interface Demos {
  /** A demo's inputs as its source is now; throws `MOSTRA_DEMO_SOURCE_MISSING`. */
  inputs(
    name: string,
    spec: DemoBuildSpec,
    artifactDir: string,
    base?: string,
  ): Promise<DemoInputs>;
  /** Builds a demo, or finds its build in the cache. */
  build(
    inputs: DemoInputs,
    options?: { readonly force?: boolean; readonly signal?: AbortSignal },
  ): Promise<BuiltDemo | FailedDemo>;
}

/**
 * `demoDigest` (DATA_MODEL §2): the SHA-256 of each demo's inputs' digest by name, or `undefined`
 * for an artifact without demos, so its version keeps the ID it had before demos existed.
 */
export function demoDigestOf(inputs: readonly DemoInputs[]): string | undefined {
  if (inputs.length === 0) return undefined;
  return sha256Hex(canonicalJson(Object.fromEntries(inputs.map((one) => [one.name, one.digest]))));
}

/**
 * What `verify` refuses of a manifest's demos before any build (D185 item 3): a demo declared as a
 * dev server.
 */
export function demoProblems(demos: Readonly<Record<string, DemoSpec>> | undefined): Diagnostic[] {
  const problems: Diagnostic[] = [];
  for (const [name, spec] of Object.entries(demos ?? {})) {
    if (isDemoBuild(spec)) continue;
    problems.push(
      createDiagnostic("MOSTRA_DEMO_UNSUPPORTED", {
        message: `The demo "${name}" is declared as a dev server (${"attach" in spec ? "attach" : "command"}); Mostra shows demos as built front ends.`,
      }),
    );
  }
  return problems;
}

/** The demos a manifest declares as builds, in its order. */
export function demoBuilds(
  demos: Readonly<Record<string, DemoSpec>> | undefined,
): [string, DemoBuildSpec][] {
  return Object.entries(demos ?? {}).filter((entry): entry is [string, DemoBuildSpec] =>
    isDemoBuild(entry[1]),
  );
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Reads a file of ignore rules, or none. */
async function rulesOf(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * The canonical listing digest of a demo's source (DATA_MODEL §2's form): every file under it but
 * installs, caches, its own output and what its `.gitignore` and `.mostraignore` name.
 */
export async function demoSourceDigest(sourceDir: string, outputDir: string): Promise<string> {
  const rules = ignore()
    .add(await rulesOf(join(sourceDir, ".gitignore")))
    .add(await rulesOf(join(sourceDir, ".mostraignore")));
  const output = relative(sourceDir, outputDir).replaceAll("\\", "/");
  const files: { path: string; executable: boolean; sha256: string }[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = (rel ? `${rel}/${entry.name}` : entry.name).normalize("NFC");
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name) || path === output || rules.ignores(`${path}/`)) continue;
        await walk(absolute, path);
      } else if (entry.isFile()) {
        if (SKIPPED_FILE.test(entry.name) || rules.ignores(path)) continue;
        const info = await stat(absolute);
        files.push({
          path,
          executable: (info.mode & 0o111) !== 0,
          sha256: await hashFile(absolute),
        });
      }
    }
  };
  await walk(sourceDir, "");
  return listingDigest(files);
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (at: string, rel: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(at, entry.name), path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await walk(dir, "");
  return found.sort();
}

/** The paths a document loads by `src` or `href`. */
const DOCUMENT_URL = /\b(?:src|href)\s*=\s*(["'])([^"']*)\1/gi;

/**
 * Checks a demo's output (D185 item 4): its `index.html`, and every path its documents load from
 * the site's root staying under `base`. `undefined` when it is sound.
 */
export async function checkDemoOutput(
  name: string,
  dir: string,
  base: string,
): Promise<Diagnostic | undefined> {
  const files = await filesUnder(dir);
  if (!files.includes("index.html")) {
    return createDiagnostic("MOSTRA_DEMO_OUTPUT_MISSING", {
      message: `The demo "${name}" built, but its output holds no index.html.`,
    });
  }
  const outside = new Set<string>();
  for (const file of files.filter((path) => /\.html?$/i.test(path))) {
    const html = await readFile(join(dir, file), "utf8");
    for (const match of html.matchAll(DOCUMENT_URL)) {
      const url = match[2] as string;
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      if (url.startsWith(base) || `${url}/` === base) continue;
      outside.add(`${file}: ${url}`);
    }
  }
  if (outside.size === 0) return undefined;
  const shown = [...outside].slice(0, 5);
  return createDiagnostic("MOSTRA_DEMO_BASE_MISMATCH", {
    message: `The demo "${name}" loads files from outside ${base}: ${shown.join(", ")}${outside.size > shown.length ? ` and ${outside.size - shown.length} more` : ""}.`,
  });
}

/**
 * Writes the review agent into every HTML document of a demo the version keeps (D185 item 5,
 * D183 item 7), so comments anchor inside it: inline, so it needs no path wherever the demo is
 * served or exported, or by `agentPath` when its text would end an inline script early.
 */
export async function injectDemoAgent(
  dir: string,
  agent: string,
  agentPath: string,
): Promise<void> {
  const tag = /<\/script|<!--/i.test(agent)
    ? `<script src="/${agentPath}"></script>`
    : `<script>${agent}</script>`;
  for (const file of (await filesUnder(dir)).filter((path) => /\.html?$/i.test(path))) {
    const html = await readFile(join(dir, file), "utf8");
    const head = /<head\b[^>]*>/i.exec(html);
    const at = head ? head.index + head[0].length : 0;
    await writeFile(join(dir, file), `${html.slice(0, at)}${tag}${html.slice(at)}`);
  }
}

/** Options for {@link createDemos}. */
export interface DemosOptions {
  /** The home: builds are kept under `cache/demos/`. */
  readonly home: string;
  readonly processes: ProcessManager;
  readonly log: Log;
  /** The supervisor's environment, from which a build's is made. */
  readonly env: Environment;
}

/** Removes what a stopped instance left of builds being kept. */
export async function recoverDemos(home: string): Promise<void> {
  const dir = join(home, "cache", "demos");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".tmp-")) await removeTree(join(dir, entry)).catch(() => undefined);
  }
}

/** Creates the demo builder of one instance. */
export function createDemos(options: DemosOptions): Demos {
  const { log } = options;
  const cacheDir = join(options.home, "cache", "demos");
  /** One build at a time per demo folder: the build writes its output there. */
  const turns = new Map<string, Promise<unknown>>();
  const inTurn = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const before = turns.get(key) ?? Promise.resolve();
    const run = before.then(task, task);
    const settled = run.catch(() => undefined);
    turns.set(key, settled);
    void settled.then(() => {
      if (turns.get(key) === settled) turns.delete(key);
    });
    return run;
  };

  const cached = async (digest: string): Promise<BuiltDemo | undefined> => {
    try {
      const marker = JSON.parse(await readFile(join(cacheDir, digest, "demo.json"), "utf8")) as {
        files?: number;
      };
      return {
        status: "cached",
        dir: join(cacheDir, digest, "out"),
        files: marker.files ?? 0,
        ms: 0,
      };
    } catch {
      return undefined;
    }
  };

  const runBuild = async (
    inputs: DemoInputs,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; ms: number } | FailedDemo> => {
    const { name, spec } = inputs;
    const env = demoEnvironment(options.env, spec.env ?? {}, inputs.base);
    const program = programCommand(spec.build, env);
    if (program === undefined) {
      return {
        status: "failed",
        diagnostic: createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
          message: `The demo "${name}"'s build couldn't start: no program ${spec.build[0] ?? ""} on PATH.`,
        }),
      };
    }
    const lines: string[] = [];
    const keep = (line: string): void => {
      lines.push(line);
      if (lines.length > LOG_KEPT) lines.shift();
    };
    const limitMs = spec.timeout !== undefined ? durationMs(spec.timeout) : DEMO_TIMEOUT_DEFAULT_MS;
    const started = Date.now();
    log.info("demos.build_started", { name, source: inputs.sourceDir, digest: inputs.digest });
    let child: Awaited<ReturnType<ProcessManager["spawn"]>>;
    try {
      child = await options.processes.spawn({
        kind: "demo-build",
        ownerRef: name,
        command: program.command,
        args: program.args,
        cwd: inputs.sourceDir,
        env,
        onStdout: keep,
        onStderr: keep,
      });
    } catch (error) {
      return {
        status: "failed",
        diagnostic: createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
          message: `The demo "${name}"'s build couldn't start: ${(error as Error).message}`,
        }),
      };
    }
    let ended: "timeout" | "cancelled" | undefined;
    const stop = (why: "timeout" | "cancelled"): void => {
      if (ended !== undefined) return;
      ended = why;
      void child.stop(STOP_GRACE_MS).catch(() => undefined);
    };
    const timer = setTimeout(() => stop("timeout"), limitMs);
    const onAbort = (): void => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const exit = await child.exited;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    const ms = Date.now() - started;
    const tail = lines.slice(-LOG_LINES).join("\n");
    if (ended === "timeout") {
      log.warn("demos.build_timeout", { name, ms });
      return {
        status: "failed",
        diagnostic: createDiagnostic("MOSTRA_DEMO_BUILD_TIMEOUT", {
          message: `The demo "${name}"'s build ran past its ${spec.timeout ?? "10m"} limit and was ended with everything it started.${tail ? `\nIts last lines:\n${tail}` : ""}`,
        }),
      };
    }
    if (ended === "cancelled") {
      return {
        status: "failed",
        diagnostic: createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
          message: `The demo "${name}"'s build was cancelled.`,
        }),
      };
    }
    if (exit.code !== 0) {
      log.warn("demos.build_failed", { name, code: exit.code, signal: exit.signal, ms });
      return {
        status: "failed",
        diagnostic: createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
          message: `The demo "${name}"'s build (${spec.build.join(" ")}) ended with ${exit.code !== null ? `exit code ${exit.code}` : `signal ${exit.signal}`}.${tail ? `\nIts last lines:\n${tail}` : ""}`,
        }),
      };
    }
    log.info("demos.build_finished", { name, ms });
    return { ok: true, ms };
  };

  return {
    async inputs(name, spec, artifactDir, base = demoBase(name)) {
      const sourceDir = resolve(artifactDir, spec.source);
      let info: import("node:fs").Stats | undefined;
      try {
        info = await stat(sourceDir);
      } catch {
        info = undefined;
      }
      if (!info?.isDirectory()) {
        throw new RpcError(
          createDiagnostic("MOSTRA_DEMO_SOURCE_MISSING", {
            message: `The demo "${name}"'s source folder ${sourceDir} doesn't exist.`,
          }),
        );
      }
      const outputDir = resolve(sourceDir, spec.output);
      const source = await demoSourceDigest(sourceDir, outputDir);
      const digest = sha256Hex(
        canonicalJson({
          source,
          build: spec.build,
          output: spec.output.replaceAll("\\", "/"),
          env: spec.env ?? {},
          base,
        }),
      );
      return { name, spec, sourceDir, outputDir, base, digest };
    },

    build(inputs, how = {}) {
      return inTurn(`${inputs.sourceDir}\0${inputs.outputDir}`, async () => {
        if (!how.force) {
          const found = await cached(inputs.digest);
          if (found) return found;
        }
        const ran = await runBuild(inputs, how.signal);
        if (!("ok" in ran)) return ran;
        let problem: Diagnostic | undefined;
        try {
          problem = await checkDemoOutput(inputs.name, inputs.outputDir, inputs.base);
        } catch {
          problem = createDiagnostic("MOSTRA_DEMO_OUTPUT_MISSING", {
            message: `The demo "${inputs.name}" built, but its output folder ${inputs.outputDir} doesn't exist.`,
          });
        }
        if (problem) return { status: "failed", diagnostic: problem };
        // Kept whole or not at all: a scratch folder renamed into place.
        await mkdir(cacheDir, { recursive: true });
        const scratch = join(cacheDir, `.tmp-${randomBytes(6).toString("hex")}`);
        await cp(inputs.outputDir, join(scratch, "out"), { recursive: true, dereference: true });
        const files = (await filesUnder(join(scratch, "out"))).length;
        await writeFile(
          join(scratch, "demo.json"),
          `${JSON.stringify({ name: inputs.name, digest: inputs.digest, base: inputs.base, files, builtAt: new Date().toISOString() }, null, 2)}\n`,
        );
        const target = join(cacheDir, inputs.digest);
        await rm(target, { recursive: true, force: true });
        await renamePath(scratch, target);
        return { status: "built", dir: join(target, "out"), files, ms: ran.ms };
      });
    },
  };
}
