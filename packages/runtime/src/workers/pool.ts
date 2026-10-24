/**
 * The worker pool (RT-03, RT-04, D62, FAILURE_MODEL §2): one worker per active artifact version
 * with server code, started on first need through the `WorkerLauncher`, stopped after its idle
 * minutes, watched by a 10 s event-loop watchdog, restarted after a crash with exponential backoff
 * (1 s to 60 s) and parked after more than 5 crashes in 10 minutes. A crash, an out-of-memory abort
 * or a hang ends only that worker: the supervisor and every other worker keep serving.
 */
import {
  type CallContext,
  createDiagnostic,
  DEFAULT_WORKER_LIMITS,
  type Frame,
  RpcError,
  RpcPeer,
  type RunProgress,
  WORKER_METHODS,
  WorkerBatchParams,
  type WorkerCallOutcome,
  WorkerCallOutcome as WorkerCallOutcomeSchema,
  type WorkerLimits,
  WorkerPingResult,
  type WorkerStartResult,
  WorkerStartResult as WorkerStartResultSchema,
  type WorkerStatus,
  type WorkerVersionRef,
} from "@mostra/protocol";
import type { Environment, Log } from "../log.ts";
import type { WorkerChannel, WorkerExit, WorkerLauncher } from "./launcher.ts";

/** What the pool needs to know about a version to start its worker. */
export interface WorkerVersion {
  readonly artifactId: string;
  readonly ref: WorkerVersionRef;
  /** The server bundle, relative to the version (the render mode's `serverEntry`). */
  readonly entry: string;
  readonly limits: WorkerLimits;
  readonly sourceDir?: string;
  /** The IDs of the version's server functions, from its `registry.json` (the builder's scan). */
  readonly functions: ReadonlySet<string>;
}

/** A call's link back to the caller: its batches, progress and log lines as they come. */
export interface CallListener {
  onBatch?(batch: readonly Frame[]): void;
  onProgress?(progress: RunProgress): void;
  onLog?(line: string): void;
}

/** Who a call is for, as the bridge sees a worker's requests during it. */
export interface CallInfo {
  readonly callId: string;
  readonly context: CallContext;
  readonly viewerId?: string;
}

/** What a worker asks of the supervisor, and the live values it produces. */
export interface WorkerBridge {
  /**
   * Answers a worker's request (`server/secret`, `server/signal`, `server/emit`,
   * `server/state.*`); `call` is the call it came from, when it names one.
   */
  request(
    worker: { readonly artifactId: string; readonly versionId: string },
    method: string,
    params: unknown,
    call: CallInfo | undefined,
  ): Promise<unknown>;
  /** A line a worker logged outside any call. */
  log(worker: { readonly artifactId: string; readonly versionId: string }, line: string): void;
  /** A live value or failure (`server/live.value`). */
  liveValue(
    worker: { readonly artifactId: string; readonly versionId: string },
    params: unknown,
  ): void;
}

/** A running worker, as the pool hands it out. */
export interface WorkerHandle {
  readonly versionId: string;
  readonly artifactId: string;
  readonly started: WorkerStartResult;
  /** Runs a server function; the outcome arrives after every batch was given to `listener`. */
  call(
    info: {
      readonly fnId: string;
      readonly args: unknown;
      readonly context: CallContext;
      readonly viewerId?: string;
    },
    listener: CallListener,
  ): { readonly callId: string; readonly outcome: Promise<WorkerCallOutcome> };
  /** Aborts a call's `abortSignal`. */
  cancel(callId: string, reason?: string): void;
  /** Starts a live producer; it keeps the worker from idling until stopped. */
  liveStart(key: string): Promise<void>;
  liveStop(key: string): Promise<void>;
  liveRefresh(key: string): void;
}

/** Why a worker ended unexpectedly, and what happens next. */
export interface WorkerCrash {
  readonly artifactId: string;
  readonly versionId: string;
  /** For people: "it ran out of memory (heap limit 1024 MiB)". */
  readonly cause: string;
  readonly kind: "crash" | "oom" | "hang";
  readonly backoffMs: number;
  readonly parked: boolean;
  /** The calls that were running in it. */
  readonly callIds: readonly string[];
  /** The live producers that were running in it. */
  readonly liveKeys: readonly string[];
}

/** Options for {@link createWorkerPool}. */
export interface WorkerPoolOptions {
  readonly launcher: WorkerLauncher;
  readonly log: Log;
  readonly bridge: WorkerBridge;
  /** The environment every worker gets: the artifact allowlist, never secrets. */
  readonly env: Environment;
  /** Reports a crash, after the pool recorded it: append `worker.crashed`, end runs. */
  readonly onCrash: (crash: WorkerCrash) => void;
  /** How often the watchdog asks; default 1000 ms. */
  readonly watchdogIntervalMs?: number;
  /** Idle time in ms, overriding the versions' `idleMinutes` (tests). */
  readonly idleMsOverride?: number;
  /** The crash window and its limit (FAILURE_MODEL §2: 5 in 10 minutes). */
  readonly parkAfter?: { readonly crashes: number; readonly windowMs: number };
  /** The first backoff after a crash, doubling to 60 s (FAILURE_MODEL §2: 1 s; tests shorten it). */
  readonly backoffMinMs?: number;
  readonly now?: () => number;
}

/** The pool. */
export interface WorkerPool {
  /**
   * The version's worker, started if it isn't; waits out a backoff. Throws
   * `MOSTRA_RUNTIME_WORKER_PARKED` for a parked version and `MOSTRA_RUNTIME_WORKER_CRASHED` when
   * the worker couldn't start.
   */
  acquire(version: WorkerVersion): Promise<WorkerHandle>;
  /** The worker if it runs now, without starting one. */
  running(versionId: string): WorkerHandle | undefined;
  /**
   * Stops a version's worker now if it runs nothing (no call, no producer), rather than after its
   * idle time: for a worker started only to say what its live sources are.
   */
  release(versionId: string): void;
  /** Clears the park and crash history of every version of an artifact (a publish, `verify`). */
  clear(artifactId: string): void;
  /**
   * Replaces a version's server bundle (`mostra dev` only, D140 item 12): stops its worker, busy
   * or not, so the next call starts `version`, the same version ID with a new output digest, and
   * clears its crash history.
   */
  replace(version: WorkerVersion): Promise<void>;
  /** Every version's worker state, for `instance/status`. */
  status(): WorkerStatus[];
  /** How many calls and producers run in all workers: the daemon stays while any do (D62). */
  activity(): number;
  /** Stops every worker. */
  stopAll(): Promise<void>;
}

const CRASH_LIMIT = { crashes: 5, windowMs: 10 * 60_000 } as const;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const START_TIMEOUT_MS = 60_000;

interface Slot {
  version: WorkerVersion;
  state: WorkerStatus["state"];
  crashes: number[];
  lastCause?: string;
  retryAt?: number;
  starting?: Promise<Running>;
  current?: Running;
}

interface Running {
  readonly handle: WorkerHandle;
  readonly channel: WorkerChannel;
  readonly peer: RpcPeer;
  readonly calls: Map<string, { info: CallInfo; listener: CallListener }>;
  readonly live: Set<string>;
  stopping: boolean;
  /**
   * Set until `worker/start` answers: a worker that ends before then failed to start, which
   * `acquire` records once, with the start's message (Opus review 5).
   */
  starting: boolean;
  hung?: number;
  /** The watchdog stopped it for not answering at all, rather than for a blocked event loop. */
  silent?: boolean;
  /** The heap in use at the last answered ping, in bytes: near the limit, a stall is memory. */
  heapUsed?: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setInterval>;
}

let nextCall = 0;

/** Unanswered pings in a row, each as long as the watchdog's limit, before a worker is stopped. */
const PINGS_MISSED_BEFORE_STOP = 3;

/**
 * The share of its heap limit a worker had in use at its last answered ping for a watchdog stop
 * to count as running out of memory rather than hanging.
 */
const OOM_STALL_FRACTION = 0.8;

/**
 * An exit code as people look it up: a Windows status (`0xC0000005`, an access violation) in
 * hexadecimal, any other code as a number. Node.js reports a Windows status as an unsigned
 * 32-bit number; on POSIX codes are below 256.
 */
export function exitCodeText(code: number | null): string {
  if (code === null) return "?";
  if (code >= 0x80000000 || code < 0) {
    return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  }
  return String(code);
}

function crashed(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_RUNTIME_WORKER_CRASHED", { message }));
}

/** A worker that couldn't start, and how it ended. */
class StartFailure extends RpcError {
  readonly kind: WorkerCrash["kind"];
  constructor(message: string, kind: WorkerCrash["kind"]) {
    super(createDiagnostic("MOSTRA_RUNTIME_WORKER_CRASHED", { message }));
    this.kind = kind;
  }
}

/** Creates the pool. */
export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  const slots = new Map<string, Slot>();
  const now = options.now ?? Date.now;
  const park = options.parkAfter ?? CRASH_LIMIT;
  const watchdogEvery = options.watchdogIntervalMs ?? 1000;
  const backoffMin = options.backoffMinMs ?? BACKOFF_MIN_MS;
  let stopped = false;

  const idleMs = (version: WorkerVersion): number =>
    options.idleMsOverride ?? version.limits.idleMinutes * 60_000;

  const scheduleIdle = (slot: Slot, running: Running): void => {
    if (running.idleTimer !== undefined) clearTimeout(running.idleTimer);
    delete running.idleTimer;
    if (running.calls.size > 0 || running.live.size > 0 || running.stopping) return;
    running.idleTimer = setTimeout(() => {
      if (running.calls.size > 0 || running.live.size > 0) return;
      options.log.info("worker.idle_stop", { versionId: slot.version.ref.versionId });
      void stopRunning(running);
    }, idleMs(slot.version));
    running.idleTimer.unref?.();
  };

  const stopRunning = async (running: Running): Promise<void> => {
    running.stopping = true;
    if (running.watchdog !== undefined) clearInterval(running.watchdog);
    if (running.idleTimer !== undefined) clearTimeout(running.idleTimer);
    await running.peer.request(WORKER_METHODS.stop, {}, { timeoutMs: 2000 }).catch(() => {});
    const timer = setTimeout(() => running.channel.kill(), 3000);
    await running.channel.ended;
    clearTimeout(timer);
  };

  const classify = (
    exit: WorkerExit,
    running: Running,
    limits: WorkerLimits,
  ): { kind: WorkerCrash["kind"]; cause: string } => {
    const tail = exit.stderrTail.join("\n");
    if (
      /heap out of memory|Allocation failed|Reached heap limit/i.test(tail) ||
      exit.signal === "SIGABRT" ||
      exit.code === 134
    ) {
      return { kind: "oom", cause: `it ran out of memory (heap limit ${limits.heapMb} MiB)` };
    }
    if (running.hung !== undefined) {
      // Near its heap limit, V8 collects garbage over and over and the event loop stalls before
      // the heap gives out: the watchdog stops it first, and the cause is memory (seen on Linux).
      if ((running.heapUsed ?? 0) >= OOM_STALL_FRACTION * limits.heapMb * 1024 * 1024) {
        return {
          kind: "oom",
          cause: `it ran out of memory (heap limit ${limits.heapMb} MiB): collecting garbage blocked its event loop for ${Math.round(running.hung / 1000)} s`,
        };
      }
      return {
        kind: "hang",
        cause: running.silent
          ? `it answered nothing for ${Math.round(running.hung / 1000)} s (watchdog limit ${limits.watchdogMs / 1000} s)`
          : `its event loop was blocked for ${Math.round(running.hung / 1000)} s (watchdog limit ${limits.watchdogMs / 1000} s)`,
      };
    }
    // Node ends an uncaught exception's report with its version; the error line says what
    // happened (`Error: …`, `TypeError: …`), so it is the cause, else the last line written.
    const lines = exit.stderrTail.filter(
      (line) => line.trim() !== "" && !/^Node\.js v\d/.test(line.trim()),
    );
    const last =
      lines.findLast((line) => /^[A-Za-z_$][\w$.]*(?:Error|Exception)\b.*:/.test(line.trim())) ??
      lines.findLast((line) => !/^\s+at\s/.test(line)) ??
      lines.at(-1);
    const how =
      exit.signal !== null
        ? `it was ended by ${exit.signal}`
        : `it exited with code ${exitCodeText(exit.code)}`;
    return { kind: "crash", cause: last ? `${how}: ${last.slice(0, 300)}` : how };
  };

  /** Records a crash: the backoff or the park it leads to, the log and the caller's report. */
  const recordCrash = (
    slot: Slot,
    kind: WorkerCrash["kind"],
    cause: string,
    callIds: readonly string[],
    liveKeys: readonly string[],
  ): void => {
    const at = now();
    slot.crashes = [...slot.crashes.filter((when) => at - when < park.windowMs), at];
    slot.lastCause = cause;
    const parked = slot.crashes.length > park.crashes;
    const backoffMs = parked
      ? 0
      : Math.min(BACKOFF_MAX_MS, backoffMin * 2 ** (slot.crashes.length - 1));
    slot.state = parked ? "parked" : "backoff";
    if (parked) delete slot.retryAt;
    else slot.retryAt = at + backoffMs;
    options.log.warn("worker.crashed", {
      versionId: slot.version.ref.versionId,
      kind,
      cause,
      backoffMs,
      parked,
    });
    options.onCrash({
      artifactId: slot.version.artifactId,
      versionId: slot.version.ref.versionId,
      cause,
      kind,
      backoffMs,
      parked,
      callIds,
      liveKeys,
    });
  };

  const onEnded = (slot: Slot, running: Running, exit: WorkerExit): void => {
    if (running.watchdog !== undefined) clearInterval(running.watchdog);
    if (running.idleTimer !== undefined) clearTimeout(running.idleTimer);
    running.peer.close();
    if (slot.current === running) delete slot.current;
    if (running.stopping || stopped) {
      if (slot.state === "ready") slot.state = "stopped";
      return;
    }
    // A worker that ends during its start failed to start: `acquire` records that, once.
    if (running.starting) return;
    const { kind, cause } = classify(exit, running, slot.version.limits);
    recordCrash(slot, kind, cause, [...running.calls.keys()], [...running.live]);
  };

  const start = async (slot: Slot): Promise<Running> => {
    const { version } = slot;
    const who = { artifactId: version.artifactId, versionId: version.ref.versionId };
    const channel = await options.launcher.launch({
      artifactId: version.artifactId,
      version: version.ref,
      env: options.env,
      limits: version.limits,
      ...(version.sourceDir ? { sourceDir: version.sourceDir } : {}),
    });
    const calls: Running["calls"] = new Map();
    const live = new Set<string>();
    const peer = new RpcPeer({
      send: (message) => channel.send(message),
      onRequest: (method, params) => {
        const callId = (params as { callId?: unknown } | undefined)?.callId;
        const call = typeof callId === "string" ? calls.get(callId)?.info : undefined;
        return options.bridge.request(who, method, params, call);
      },
      onNotification: (method, params) => {
        const callId = (params as { callId?: unknown } | undefined)?.callId;
        const entry = typeof callId === "string" ? calls.get(callId) : undefined;
        switch (method) {
          case WORKER_METHODS.batch: {
            const parsed = WorkerBatchParams.safeParse(params);
            if (parsed.success) entry?.listener.onBatch?.(parsed.data.batch);
            return;
          }
          case WORKER_METHODS.progress: {
            const { callId: _call, ...progress } = params as RunProgress & { callId: string };
            entry?.listener.onProgress?.(progress);
            return;
          }
          case WORKER_METHODS.log: {
            const line = String((params as { line?: unknown }).line ?? "");
            if (entry) entry.listener.onLog?.(line);
            else options.bridge.log(who, line);
            return;
          }
          case WORKER_METHODS.liveValue:
            options.bridge.liveValue(who, params);
            return;
        }
      },
      onInternalError: (error, method) =>
        options.log.error("worker.channel_error", { versionId: who.versionId, method, error }),
    });
    channel.onMessage((message) => peer.receive(message));

    const running: Running = {
      channel,
      peer,
      calls,
      live,
      stopping: false,
      starting: true,
      handle: undefined as unknown as WorkerHandle,
    };
    void channel.ended.then((exit) => onEnded(slot, running, exit));

    let started: WorkerStartResult;
    try {
      const raw = await peer.request(
        WORKER_METHODS.start,
        {
          artifactId: version.artifactId,
          version: version.ref,
          entry: version.entry,
          limits: version.limits,
        },
        { timeoutMs: START_TIMEOUT_MS },
      );
      started = WorkerStartResultSchema.parse(raw);
      running.starting = false;
    } catch (error) {
      running.stopping = true;
      channel.kill();
      const exit = await channel.ended;
      const tail = exit.stderrTail
        .filter((line) => line.trim() !== "")
        .slice(-3)
        .join(" / ");
      // How it ended: a worker that ran out of memory while loading is an OOM, not a crash.
      const { kind } = classify(exit, running, version.limits);
      throw new StartFailure(
        `The server code of ${version.ref.versionId} couldn't start: ${error instanceof RpcError ? error.diagnostic.message : String(error)}${tail ? ` (${tail})` : ""}`,
        kind,
      );
    }

    const handle: WorkerHandle = {
      versionId: version.ref.versionId,
      artifactId: version.artifactId,
      started,
      call(info, listener) {
        nextCall += 1;
        const callId = `call_${nextCall}`;
        const callInfo: CallInfo = {
          callId,
          context: info.context,
          ...(info.viewerId === undefined ? {} : { viewerId: info.viewerId }),
        };
        calls.set(callId, { info: callInfo, listener });
        scheduleIdle(slot, running);
        const outcome = (async (): Promise<WorkerCallOutcome> => {
          try {
            const raw = await peer.request(WORKER_METHODS.call, {
              callId,
              fnId: info.fnId,
              args: info.args as never,
              context: info.context as never,
            });
            return WorkerCallOutcomeSchema.parse(raw);
          } catch (error) {
            if (
              error instanceof RpcError &&
              error.diagnostic.code === "MOSTRA_HOST_CONNECTION_CLOSED"
            ) {
              throw crashed(
                `The server code of ${version.ref.versionId} stopped during the call: ${slot.lastCause ?? "its worker ended"}.`,
              );
            }
            throw error;
          } finally {
            calls.delete(callId);
            scheduleIdle(slot, running);
          }
        })();
        return { callId, outcome };
      },
      cancel(callId, reason) {
        peer.notify(WORKER_METHODS.cancel, { callId, ...(reason ? { reason } : {}) });
      },
      async liveStart(key) {
        live.add(key);
        scheduleIdle(slot, running);
        try {
          await peer.request(WORKER_METHODS.liveStart, { key }, { timeoutMs: 30_000 });
        } catch (error) {
          live.delete(key);
          scheduleIdle(slot, running);
          throw error;
        }
      },
      async liveStop(key) {
        if (!live.delete(key)) return;
        scheduleIdle(slot, running);
        await peer.request(WORKER_METHODS.liveStop, { key }, { timeoutMs: 10_000 }).catch(() => {});
      },
      liveRefresh(key) {
        peer.notify(WORKER_METHODS.liveRefresh, { key });
      },
    };
    (running as { handle: WorkerHandle }).handle = handle;

    // The watchdog (D62): a worker whose event loop stays blocked past its limit, or that stops
    // answering, is stopped and reported as hung.
    let asking = false;
    // Pings missed in a row. The channel thread answers even while artifact code blocks the
    // event loop, so silence means the channel is congested (a large result ahead of the answer,
    // a slow link to a launcher elsewhere) or the process is gone; only a long silence stops it.
    let missed = 0;
    running.watchdog = setInterval(() => {
      if (asking || running.stopping) return;
      asking = true;
      const limit = version.limits.watchdogMs;
      peer
        .request(WORKER_METHODS.ping, {}, { timeoutMs: limit })
        .then((raw) => {
          const ping = WorkerPingResult.parse(raw);
          missed = 0;
          running.heapUsed = ping.heapUsed;
          if (!ping.waitingForSecret && ping.blockedMs > limit) {
            running.hung = ping.blockedMs;
            channel.kill();
          }
        })
        .catch(() => {
          if (running.stopping || peer.closed) return;
          missed += 1;
          if (missed < PINGS_MISSED_BEFORE_STOP) return;
          running.hung = limit * missed;
          running.silent = true;
          channel.kill();
        })
        .finally(() => {
          asking = false;
        });
    }, watchdogEvery);
    running.watchdog.unref?.();
    scheduleIdle(slot, running);
    return running;
  };

  const slotOf = (version: WorkerVersion): Slot => {
    let slot = slots.get(version.ref.versionId);
    if (!slot) {
      slot = { version, state: "stopped", crashes: [] };
      slots.set(version.ref.versionId, slot);
    }
    return slot;
  };

  return {
    async acquire(version) {
      if (stopped) throw crashed("The instance is stopping.");
      const slot = slotOf(version);
      for (;;) {
        if (stopped) throw crashed("The instance is stopping.");
        if (slot.current && !slot.current.stopping) return slot.current.handle;
        if (slot.current?.stopping) {
          // An idle stop in progress: the version keeps one worker, so its replacement starts
          // only once this one has gone (RT-03).
          await slot.current.channel.ended;
          await Promise.resolve();
          if (slot.current?.stopping) delete slot.current;
          continue;
        }
        if (slot.state === "parked") {
          throw new RpcError(
            createDiagnostic("MOSTRA_RUNTIME_WORKER_PARKED", {
              message: `The server code of this artifact crashed ${slot.crashes.length} times in 10 minutes, so it is parked; the last cause: ${slot.lastCause ?? "unknown"}.`,
            }),
          );
        }
        if (slot.starting) {
          await slot.starting.catch(() => {});
          if (slot.current) continue;
          throw crashed(
            `The server code of ${version.ref.versionId} couldn't start: ${slot.lastCause ?? "it failed"}.`,
          );
        }
        if (slot.retryAt !== undefined && slot.retryAt > now()) {
          await new Promise((resolve) => setTimeout(resolve, (slot.retryAt ?? now()) - now()));
          continue;
        }
        slot.state = "starting";
        slot.starting = start(slot);
        try {
          const running = await slot.starting;
          if (slot.current === undefined && !running.stopping) {
            slot.current = running;
            slot.state = "ready";
          } else if (!running.stopping) {
            // Never left running untracked: a worker the slot can't hold is stopped at once.
            void stopRunning(running);
          }
          delete slot.retryAt;
        } catch (error) {
          // A worker that can't start crashed as surely as one that died later: it backs off,
          // and a version that never starts is parked like one that keeps crashing.
          recordCrash(
            slot,
            error instanceof StartFailure ? error.kind : "crash",
            error instanceof RpcError ? error.diagnostic.message : String(error),
            [],
            [],
          );
          throw error;
        } finally {
          delete slot.starting;
        }
      }
    },
    running(versionId) {
      const current = slots.get(versionId)?.current;
      return current && !current.stopping ? current.handle : undefined;
    },
    release(versionId) {
      const current = slots.get(versionId)?.current;
      if (!current || current.stopping || current.calls.size > 0 || current.live.size > 0) return;
      options.log.info("worker.idle_stop", { versionId, reason: "released" });
      void stopRunning(current);
    },
    async replace(version) {
      const slot = slots.get(version.ref.versionId);
      if (!slot) return;
      slot.version = version;
      slot.crashes = [];
      delete slot.retryAt;
      if (slot.state === "parked" || slot.state === "backoff") slot.state = "stopped";
      await slot.starting?.catch(() => {});
      const current = slot.current;
      if (current && !current.stopping) {
        options.log.info("worker.replaced", { versionId: version.ref.versionId });
        await stopRunning(current);
      }
    },
    clear(artifactId) {
      for (const slot of slots.values()) {
        if (slot.version.artifactId !== artifactId) continue;
        slot.crashes = [];
        delete slot.retryAt;
        if (slot.state === "parked" || slot.state === "backoff") slot.state = "stopped";
      }
    },
    status() {
      const at = now();
      return [...slots.values()].map((slot) => {
        const running = slot.current;
        const recent = slot.crashes.filter((when) => at - when < park.windowMs).length;
        return {
          artifactId: slot.version.artifactId,
          versionId: slot.version.ref.versionId,
          state: slot.state,
          ...(running?.channel.pid !== undefined ? { pid: running.channel.pid } : {}),
          crashes: recent,
          ...(slot.lastCause ? { lastCause: slot.lastCause } : {}),
          ...(slot.retryAt !== undefined && slot.state === "backoff"
            ? { retryAt: new Date(slot.retryAt).toISOString() }
            : {}),
          active: running ? running.calls.size + running.live.size : 0,
        };
      });
    },
    activity() {
      let count = 0;
      for (const slot of slots.values()) {
        if (slot.current) count += slot.current.calls.size + slot.current.live.size;
      }
      return count;
    },
    async stopAll() {
      stopped = true;
      await Promise.all(
        [...slots.values()].flatMap((slot) => (slot.current ? [stopRunning(slot.current)] : [])),
      );
    },
  };
}

/** The limits of a version from its manifest's `limits` (D62), within sane bounds. */
export function workerLimits(manifest: {
  readonly limits?: {
    readonly heapMb?: number;
    readonly watchdogMs?: number;
    readonly idleMinutes?: number;
  };
}): WorkerLimits {
  const limits = manifest.limits ?? {};
  const clamp = (value: number | undefined, fallback: number, min: number, max: number): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  return {
    heapMb: Math.round(clamp(limits.heapMb, DEFAULT_WORKER_LIMITS.heapMb, 64, 65_536)),
    watchdogMs: Math.round(
      clamp(limits.watchdogMs, DEFAULT_WORKER_LIMITS.watchdogMs, 1000, 3_600_000),
    ),
    idleMinutes: clamp(limits.idleMinutes, DEFAULT_WORKER_LIMITS.idleMinutes, 0.05, 7 * 24 * 60),
  };
}
