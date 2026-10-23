/**
 * The worker's main thread (ARCHITECTURE §7, D124): loads one artifact version's server bundle and
 * runs its server functions and live producers, each call inside the request context of
 * `@mostra/server` (D19 seam 3). It speaks the worker channel (`@mostra/protocol`'s `worker.ts`)
 * through its channel thread, never sees a cookie, a token or a raw browser request, and gets
 * secrets only by asking for them by name.
 */
import {
  type Dirent,
  type FSWatcher,
  readdirSync,
  realpathSync,
  statSync,
  watch as watchFiles,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { isBuiltin, registerHooks } from "node:module";
import { join, matchesGlob, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  type Batches,
  createDiagnostic,
  deserializeAll,
  encodeLine,
  type Frame,
  type LiveSourceInfo,
  RpcError,
  RpcPeer,
  SerializationError,
  serializeAll,
  ValueWriter,
  WORKER_CHANNEL_REVISION,
  WORKER_METHODS,
  type WorkerCallOutcome,
  WorkerCallParams,
  WorkerStartParams,
  type WorkerStartResult,
  wireError,
} from "@mostra/protocol";
import {
  currentCall,
  installServerHost,
  type LiveSourceOptions,
  liveSourceOptions,
  parseDuration,
  runWithContext,
  type StateSnapshot,
} from "@mostra/server/host";
import { createSharedState, SECRET_SLOT, sharedViews } from "./shared.ts";

/** How the worker is started. */
export interface WorkerOptions {
  /** `fd:<n>` (a pipe the launcher passed) or `unix:<path>` (a socket to connect to). */
  readonly channel: string;
  /** The version's directory, which the launcher resolved from the version reference. */
  readonly versionDir: string;
  /** The artifact's source directory, when it still exists: `watch` globs are relative to it. */
  readonly sourceDir?: string;
  /**
   * The `node_modules` the version's packages resolve from (D135): the layout of the version's
   * lockfile, or the warm set's. The server bundle keeps every package import external, so the
   * packages run from their own directories: native addons load, and files a package reads
   * beside itself are there.
   */
  readonly modules?: string;
}

type AnyFunction = (...args: unknown[]) => unknown;

/** The longest wait for a secret: the host port's 30 s and a margin. */
const SECRET_WAIT_MS = 40_000;

/** How often the event loop proves it turns, for the watchdog (D62). */
const BEAT_MS = 100;

const ownExtension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";

/** Whether `specifier` names a package (`react`, `@scope/name/sub`), not a path, URL or built-in. */
function isPackageSpecifier(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return false; // node:, file:, data:, https:
  return !isBuiltin(specifier);
}

/**
 * Resolves the version's imports (D135): `@mostra/server` is this worker's own copy, so they share
 * context; every other package the server bundle imports resolves from `modules`, the layout the
 * version was built against, as though the bundle sat beside it. Imports inside packages resolve
 * as Node resolves them, from the packages' own directories.
 */
function resolveVersionImports(versionDir: string, modules: string | undefined): void {
  const entries = {
    "@mostra/server": import.meta.resolve("@mostra/server"),
    "@mostra/server/host": import.meta.resolve("@mostra/server/host"),
  } as Record<string, string>;
  // The bundle's imports name it by its real path (Node resolves symlinks), the launcher's
  // argument perhaps through one (macOS's /tmp): either form is the version.
  const versionUrls = [resolve(versionDir), realpathSync(versionDir)].map(
    (dir) => `${pathToFileURL(dir).href}/`,
  );
  const layoutParent =
    modules === undefined
      ? undefined
      : pathToFileURL(join(modules, "..", "mostra-server.mjs")).href;
  registerHooks({
    resolve(specifier, context, next) {
      const url = entries[specifier];
      if (url) return { url, shortCircuit: true };
      if (
        layoutParent !== undefined &&
        versionUrls.some((url) => context.parentURL?.startsWith(url) === true) &&
        isPackageSpecifier(specifier)
      ) {
        return next(specifier, { ...context, parentURL: layoutParent });
      }
      return next(specifier, context);
    },
  });
}

interface Call {
  readonly controller: AbortController;
  readonly pending: Set<Promise<unknown>>;
  writer?: ValueWriter;
}

/** Runs a worker until its channel closes. */
export async function runWorker(options: WorkerOptions): Promise<void> {
  resolveVersionImports(options.versionDir, options.modules);
  const shared = createSharedState();
  const views = sharedViews(shared);
  const thread = new Worker(new URL(`./channel-thread${ownExtension}`, import.meta.url), {
    workerData: { channel: options.channel, shared },
  });
  thread.unref();

  const beat = (): void => {
    Atomics.store(views.beat, 0, BigInt(Date.now()));
    Atomics.store(views.beat, 1, BigInt(process.memoryUsage().heapUsed));
  };
  beat();
  setInterval(beat, BEAT_MS);

  const calls = new Map<string, Call>();
  const functions = new Map<string, AnyFunction>();
  const ids = new Map<AnyFunction, string>();
  const producers = new Map<string, Producer>();
  const sources = new Map<string, LiveSourceOptions<unknown>>();

  const shutdown = (code: number): never => {
    for (const producer of producers.values()) producer.stop();
    // Children of server code die with the worker: on POSIX it leads its own process group,
    // which it signals; on Windows there is no group to signal, and its gate's Job Object ends
    // them once it exits (D150).
    if (process.platform !== "win32") {
      try {
        process.kill(-process.pid, "SIGTERM");
      } catch {
        // Not a group leader (a launcher that runs the worker elsewhere): only this process ends.
      }
    }
    process.exit(code);
  };

  const peer: RpcPeer = new RpcPeer({
    send(message) {
      thread.postMessage({ type: "line", line: encodeLine(message) });
    },
    onRequest(method, params) {
      switch (method) {
        case WORKER_METHODS.start:
          return start(params);
        case WORKER_METHODS.call:
          return call(params);
        case WORKER_METHODS.liveStart:
          return liveStart(params);
        case WORKER_METHODS.liveStop: {
          const key = String((params as { key?: unknown }).key);
          producers.get(key)?.stop();
          producers.delete(key);
          return {};
        }
        case WORKER_METHODS.stop:
          setImmediate(() => shutdown(0));
          return {};
        default:
          throw new RpcError(
            createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
              message: `The worker serves no method ${method}.`,
            }),
          );
      }
    },
    onNotification(method, params) {
      if (method === WORKER_METHODS.cancel) {
        const { callId, reason } = params as { callId?: string; reason?: string };
        const entry = callId === undefined ? undefined : calls.get(callId);
        if (entry) {
          const error = new Error(reason ?? "The run was cancelled.");
          (error as Error & { code: string }).code = "MOSTRA_ACTION_CANCELLED";
          error.name = "AbortError";
          entry.controller.abort(error);
        }
      } else if (method === WORKER_METHODS.liveRefresh) {
        producers.get(String((params as { key?: unknown }).key))?.refresh();
      }
    },
    onInternalError(error) {
      process.stderr.write(`mostra worker: ${(error as Error)?.stack ?? String(error)}\n`);
    },
  });

  thread.on("message", (message: { type: string; line?: string }) => {
    if (message.type === "line" && message.line !== undefined) peer.receiveLine(message.line);
    else if (message.type === "closed") shutdown(0);
  });
  thread.on("error", (error) => {
    process.stderr.write(`mostra worker: the channel failed: ${error.message}\n`);
    shutdown(1);
  });
  thread.on("exit", () => shutdown(0));

  // ── @mostra/server's host ────────────────────────────────────────────────────────────────

  const track = (callId: string | undefined, promise: Promise<unknown>): void => {
    const entry = callId === undefined ? undefined : calls.get(callId);
    const settled = promise.catch((error: unknown) => {
      const line = `${(error as Error)?.message ?? String(error)}`;
      peer.notify(WORKER_METHODS.log, {
        ...(callId === undefined ? {} : { callId }),
        line: `Mostra couldn't record it: ${line}`,
      });
    });
    if (entry) {
      entry.pending.add(settled);
      void settled.finally(() => entry.pending.delete(settled));
    }
  };

  installServerHost({
    secret(name) {
      Atomics.store(views.control, SECRET_SLOT.state, 1);
      thread.postMessage({ type: "secret", name });
      const outcome = Atomics.wait(views.control, SECRET_SLOT.state, 1, SECRET_WAIT_MS);
      const length = Atomics.load(views.control, SECRET_SLOT.length);
      const status = Atomics.load(views.control, SECRET_SLOT.status);
      const text = new TextDecoder().decode(views.secretBytes.slice(0, length));
      Atomics.store(views.control, SECRET_SLOT.state, 0);
      if (outcome === "timed-out") {
        throw Object.assign(new Error(`Reading the secret ${name} timed out.`), {
          code: "MOSTRA_SECRET_MISSING",
        });
      }
      if (status !== 0) {
        const failure = JSON.parse(text) as { code: string; message: string };
        throw Object.assign(new Error(failure.message), { code: failure.code });
      }
      return text;
    },
    progress(callId, p) {
      peer.notify(WORKER_METHODS.progress, { callId, ...p });
    },
    log(callId, line) {
      peer.notify(WORKER_METHODS.log, { ...(callId === undefined ? {} : { callId }), line });
    },
    signal(callId, name, payload) {
      track(
        callId,
        peer.request(WORKER_METHODS.signal, {
          ...(callId === undefined ? {} : { callId }),
          name,
          ...(payload === undefined ? {} : { payload }),
        }),
      );
    },
    emit(callId, type, payload) {
      track(
        callId,
        peer.request(WORKER_METHODS.emit, {
          ...(callId === undefined ? {} : { callId }),
          type,
          ...(payload === undefined ? {} : { payload }),
        }),
      );
    },
    async stateGet(stateIds) {
      return (await peer.request(WORKER_METHODS.stateGet, {
        ...(stateIds === undefined ? {} : { ids: [...stateIds] }),
      })) as StateSnapshot;
    },
    async statePatch(callId, ops, writeOptions) {
      return (await peer.request(WORKER_METHODS.statePatch, {
        ...(callId === undefined ? {} : { callId }),
        ops: [...ops],
        ...writeOptions,
      })) as never;
    },
  });

  // Console output inside a call also goes to its run's log.
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const active = currentCall();
      if (active) {
        const line = args
          .map((arg) => (typeof arg === "string" ? arg : inspectLine(arg)))
          .join(" ");
        peer.notify(WORKER_METHODS.log, { callId: active.callId, line });
      }
    };
  }

  // ── Requests ─────────────────────────────────────────────────────────────────────────────

  async function start(raw: unknown): Promise<WorkerStartResult> {
    const params = WorkerStartParams.parse(raw);
    const manifest = JSON.parse(
      await readFile(join(options.versionDir, "manifest.json"), "utf8"),
    ) as { outputDigest?: string };
    if (manifest.outputDigest !== params.version.outputDigest) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: `The version directory doesn't hold ${params.version.versionId}: its output digest differs.`,
        }),
      );
    }
    const entry = resolve(options.versionDir, params.entry);
    if (!entry.startsWith(`${resolve(options.versionDir)}${sep}`)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: "The server entry leaves the version.",
        }),
      );
    }
    const bundle = (await import(pathToFileURL(entry).href)) as {
      functions?: Record<string, unknown>;
      live?: Record<string, unknown>;
    };
    for (const [id, fn] of Object.entries(bundle.functions ?? {})) {
      if (typeof fn !== "function") continue;
      functions.set(id, fn as AnyFunction);
      ids.set(fn as AnyFunction, id);
    }
    const live: LiveSourceInfo[] = [];
    for (const [key, value] of Object.entries(bundle.live ?? {})) {
      const source = liveSourceOptions(value);
      if (!source) continue;
      sources.set(key, source);
      live.push(describeSource(key, source));
    }
    return { revision: WORKER_CHANNEL_REVISION, functions: [...functions.keys()], live };
  }

  async function call(raw: unknown): Promise<WorkerCallOutcome> {
    const params = WorkerCallParams.parse(raw);
    const fn = functions.get(params.fnId);
    if (!fn) {
      return {
        status: "failed",
        error: {
          code: "MOSTRA_ACTION_UNKNOWN_FUNCTION",
          message: `This version has no server function ${params.fnId}.`,
        },
      };
    }
    const entry: Call = { controller: new AbortController(), pending: new Set() };
    calls.set(params.callId, entry);
    try {
      let args: unknown;
      try {
        // A page's arguments arrive whole and are read in argument mode: no symbols or
        // iterables, bounded bigints, and every promise in them settled (Opus review 1, 13).
        args = await deserializeAll(params.args, {
          mode: "argument",
          serverFunction: (id) => serverFunction(id),
        });
      } catch (error) {
        return { status: "failed", error: errorOf(error, "MOSTRA_ACTION_UNSERIALIZABLE") };
      }
      if (!Array.isArray(args)) {
        return {
          status: "failed",
          error: { code: "MOSTRA_ACTION_UNSERIALIZABLE", message: "The arguments aren't a list." },
        };
      }
      const context = {
        kind: params.context.kind,
        callId: params.callId,
        dryRun: params.context.dryRun,
        signal: entry.controller.signal,
        ...(params.context.runId === undefined ? {} : { runId: params.context.runId }),
        ...(params.context.viewer === undefined ? {} : { viewer: params.context.viewer }),
      } satisfies Parameters<typeof runWithContext>[0];
      let result: unknown;
      try {
        result = await runWithContext(context, () => fn(...(args as unknown[])));
      } catch (error) {
        await settlePending(entry);
        if (entry.controller.signal.aborted && isAbort(error, entry.controller.signal)) {
          return { status: "cancelled" };
        }
        return { status: "failed", error: errorOf(error, "MOSTRA_ACTION_THREW") };
      }
      const writer = new ValueWriter({
        mode: "result",
        serverFunctionId: (candidate) => ids.get(candidate as AnyFunction),
        onBatch: (batch) =>
          peer.notify(WORKER_METHODS.batch, { callId: params.callId, batch: batch as Frame[] }),
      });
      entry.writer = writer;
      const stop = (): void => writer.abort();
      try {
        await runWithContext(context, async () => {
          await writer.write(result);
          // The action returned, so it ran to its end (FAILURE_MODEL §6, AC-04): a cancel from
          // here on stops only the parts of the result still streaming, and the run is
          // `cancelled` only if it cut one short.
          if (entry.controller.signal.aborted) writer.abort();
          else entry.controller.signal.addEventListener("abort", stop, { once: true });
          await writer.done;
        });
      } catch (error) {
        await settlePending(entry);
        return {
          status: "failed",
          error: errorOf(
            error,
            error instanceof SerializationError ? error.code : "MOSTRA_ACTION_THREW",
          ),
        };
      }
      await settlePending(entry);
      return { status: writer.cutShort ? "cancelled" : "succeeded" };
    } finally {
      calls.delete(params.callId);
    }
  }

  async function settlePending(entry: Call): Promise<void> {
    while (entry.pending.size > 0) await Promise.all([...entry.pending]);
  }

  function serverFunction(id: string): AnyFunction {
    const fn = functions.get(id);
    if (!fn) throw new SerializationError(`names no server function of this version (${id}).`);
    return fn;
  }

  function liveStart(raw: unknown): Record<string, never> {
    const key = String((raw as { key?: unknown }).key);
    if (producers.has(key)) return {};
    const source = sources.get(key);
    if (!source) {
      throw new RpcError(
        createDiagnostic("MOSTRA_LIVE_SOURCE_FAILED", {
          message: `live.ts defines no live source ${key}.`,
        }),
      );
    }
    const producer = new Producer(key, source, options.sourceDir, peer);
    producers.set(key, producer);
    producer.start();
    return {};
  }

  // The worker lives until its channel closes (`shutdown`).
  await new Promise<never>(() => {});
}

function inspectLine(value: unknown): string {
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return error === signal.reason || (error as Error)?.name === "AbortError";
}

function errorOf(
  error: unknown,
  fallback: string,
): { code: string; message: string; stack?: string } {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    code: typeof code === "string" && /^MOSTRA_[A-Z]+_[A-Z0-9_]+$/.test(code) ? code : fallback,
    message,
    ...(stack === undefined ? {} : { stack }),
  };
}

function describeSource(key: string, source: LiveSourceOptions<unknown>): LiveSourceInfo {
  const watch =
    source.watch === undefined
      ? undefined
      : typeof source.watch === "string"
        ? [source.watch]
        : [...source.watch];
  return {
    key,
    load: typeof source.load === "function",
    stream: typeof source.stream === "function",
    always: source.always === true,
    ...(source.refresh === undefined ? {} : { refreshMs: parseDuration(source.refresh) }),
    ...(watch === undefined ? {} : { watch }),
    ...(source.ring === undefined ? {} : { ring: source.ring }),
  };
}

/** How often watched files are compared, besides file events. */
const WATCH_POLL_MS = 2000;

/** Directories a watch never descends into. */
const UNWATCHED = new Set(["node_modules", ".git", ".mostra"]);

/** The sizes and change times of the files under `dir` that `matches`, as one string. */
function fingerprintOf(dir: string, matches: (path: string) => boolean): string {
  const parts: string[] = [];
  const walk = (relativeDir: string, depth: number): void => {
    if (depth > 16) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(dir, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!UNWATCHED.has(entry.name)) walk(path, depth + 1);
      } else if (matches(path)) {
        try {
          const stats = statSync(join(dir, path));
          parts.push(`${path}:${stats.size}:${stats.mtimeMs}`);
        } catch {
          // Removed while walking: the next comparison sees it.
        }
      }
    }
  };
  walk("", 0);
  return parts.sort().join("|");
}

/** One running live source: its loads, refreshes, file watching and stream (D56). */
class Producer {
  readonly #key: string;
  readonly #source: LiveSourceOptions<unknown>;
  readonly #sourceDir: string | undefined;
  readonly #peer: RpcPeer;
  #controller: AbortController | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #watcher: FSWatcher | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #loading = false;
  #again = false;

  constructor(
    key: string,
    source: LiveSourceOptions<unknown>,
    sourceDir: string | undefined,
    peer: RpcPeer,
  ) {
    this.#key = key;
    this.#source = source;
    this.#sourceDir = sourceDir;
    this.#peer = peer;
  }

  start(): void {
    if (this.#controller) return;
    const controller = new AbortController();
    this.#controller = controller;
    if (this.#source.load) {
      this.refresh();
      if (this.#source.refresh) {
        this.#timer = setInterval(() => this.refresh(), parseDuration(this.#source.refresh));
      }
      if (this.#source.watch !== undefined) this.#watch();
    }
    if (this.#source.stream) void this.#stream(controller.signal);
  }

  stop(): void {
    this.#controller?.abort();
    this.#controller = undefined;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#debounce !== undefined) clearTimeout(this.#debounce);
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
  }

  /** Loads again now; a load already running is followed by one more. */
  refresh(): void {
    const load = this.#source.load;
    if (!load || !this.#controller) return;
    if (this.#loading) {
      this.#again = true;
      return;
    }
    this.#loading = true;
    void (async () => {
      try {
        do {
          this.#again = false;
          try {
            await this.#publish(await load());
          } catch (error) {
            this.#fail(error);
          }
        } while (this.#again && this.#controller);
      } finally {
        this.#loading = false;
      }
    })();
  }

  #watch(): void {
    const globs =
      typeof this.#source.watch === "string"
        ? [this.#source.watch]
        : [...(this.#source.watch ?? [])];
    const dir = this.#sourceDir;
    if (!dir) {
      this.#fail(
        Object.assign(
          new Error(
            `The live source ${this.#key} watches files, but its artifact's source directory is gone.`,
          ),
          { code: "MOSTRA_LIVE_SOURCE_FAILED" },
        ),
      );
      return;
    }
    const patterns = globs.map((glob) => glob.replace(/^\.\//, ""));
    const matches = (path: string): boolean =>
      patterns.some((pattern) => matchesGlob(path, pattern));
    const changed = (): void => {
      if (this.#debounce !== undefined) clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.refresh(), 100);
    };
    try {
      this.#watcher = watchFiles(dir, { recursive: true }, (_event, name) => {
        if (name === null) return;
        const path = relative(dir, resolve(dir, name.toString())).split(sep).join("/");
        if (matches(path)) changed();
      });
    } catch (error) {
      this.#fail(error);
      return;
    }
    // File events can be dropped (macOS coalesces and delays them), so the matching files'
    // sizes and times are also compared every two seconds: a change is never missed for long.
    let fingerprint = fingerprintOf(dir, matches);
    this.#poll = setInterval(() => {
      const next = fingerprintOf(dir, matches);
      if (next !== fingerprint) {
        fingerprint = next;
        changed();
      }
    }, WATCH_POLL_MS);
  }

  async #stream(signal: AbortSignal): Promise<void> {
    const stream = this.#source.stream;
    if (!stream) return;
    let backoff = 1_000;
    while (!signal.aborted) {
      try {
        for await (const value of stream(signal)) {
          if (signal.aborted) return;
          await this.#publish(value);
          backoff = 1_000;
        }
        return;
      } catch (error) {
        if (signal.aborted) return;
        this.#fail(error);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async #publish(value: unknown): Promise<void> {
    if (!this.#controller) return;
    let batches: Batches;
    try {
      batches = await serializeAll(value, { mode: "argument" });
    } catch (error) {
      this.#fail(error);
      return;
    }
    this.#peer.notify(WORKER_METHODS.liveValue, {
      key: this.#key,
      value: batches as unknown as Batches,
    } as never);
  }

  #fail(error: unknown): void {
    const failure = wireError(error);
    this.#peer.notify(WORKER_METHODS.liveValue, {
      key: this.#key,
      error: {
        message: failure.message,
        code:
          failure.code && /^MOSTRA_/.test(failure.code)
            ? failure.code
            : "MOSTRA_LIVE_SOURCE_FAILED",
      },
    });
  }
}
