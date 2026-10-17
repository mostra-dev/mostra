/**
 * Server functions as pages call them (D54, ARCHITECTURE §7): plain calls, which stream their
 * result and leave no record, and durable action runs (AC-02 to AC-04), which the interaction core
 * records before a worker starts them and which outlive the tab that started them. Runs stream
 * progress, log lines and partial results to every view that follows them, as ephemeral messages,
 * and keep them with the run, so a reloaded page re-attaches and reads what it missed.
 *
 * This module also answers what server code asks of Mostra (the worker bridge): secrets by name,
 * signals and host events, and the artifact's shared state.
 */
import {
  ACTION_ARGS_MAX,
  ACTION_RESULT_MAX,
  type Batches,
  type CallLine,
  checkArgumentFrames,
  createDiagnostic,
  type Frame,
  RpcError,
  type RunDelta,
  type RunProgress,
  type RunState,
  ServerEmitParams,
  ServerSecretParams,
  ServerSignalParams,
  ServerStateGetParams,
  ServerStatePatchParams,
  type WireError,
  WORKER_METHODS,
} from "@mostra/protocol";
import type { EphemeralBus, Interaction, PageIdentity, RunRow } from "../interaction/index.ts";
import { type Log, type Redactor, redactFrames, redactValue } from "../log.ts";
import type { Secrets } from "../secrets/index.ts";
import type {
  WorkerBridge,
  WorkerCrash,
  WorkerHandle,
  WorkerPool,
  WorkerVersion,
} from "../workers/index.ts";

/** How often a running run's output is written and sent to its views. */
const FLUSH_MS = 200;

/** Options for {@link createActions}. */
export interface ActionsOptions {
  readonly interaction: Interaction;
  readonly pool: WorkerPool;
  readonly bus: EphemeralBus;
  readonly secrets: Secrets;
  readonly redactor: Redactor;
  readonly log: Log;
  /** What the pool needs to start a version's worker, or `undefined` for a version without server code. */
  readonly version: (versionId: string) => WorkerVersion | undefined;
  /**
   * A verify run's dry-run policy (D55, D138). With it, a function that opted into `dryRun()` runs
   * with `dryRun: true`, and any other is refused with `MOSTRA_VERIFY_ACTION_SKIPPED` before a run
   * is recorded or a worker starts, for plain calls and runs alike. Absent for viewers' pages.
   */
  readonly dryRun?: {
    readonly optedIn: (versionId: string, fnId: string) => boolean;
    /** Told about each refused function, for the verdict's `skippedActions`. */
    readonly skipped: (fnId: string) => void;
  };
}

/** Plain calls and action runs, and the bridge workers ask through. */
export interface Actions {
  /**
   * A plain call (D54): resolves once its worker has it (refusals throw here), with the result's
   * batches as they come and then how it ended.
   */
  call(
    page: PageIdentity,
    input: { readonly viewId: string; readonly fnId: string; readonly args: Batches },
    signal: AbortSignal,
  ): Promise<AsyncIterable<CallLine>>;
  /** Starts or joins a run (AC-02, AC-03); the page follows it from here. */
  startRun(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly fnId: string;
      readonly args: Batches;
      readonly key?: string;
      readonly clientKey: string;
    },
  ): RunState;
  /** Reads runs and follows them for a minute (re-attach, AC-02). */
  attach(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly runIds?: readonly string[];
      readonly keyed?: readonly { readonly fnId: string; readonly key: string }[];
    },
  ): RunState[];
  /** Cancels a run (AC-04): its `abortSignal` fires; a queued run ends at once. */
  cancel(page: PageIdentity, viewId: string, runId: string): RunState;
  /** What workers ask of the supervisor. */
  readonly bridge: Omit<WorkerBridge, "liveValue">;
  /** A worker crashed: its runs end `interrupted` (D24), the crash is an event. */
  crashed(crash: WorkerCrash): void;
  /** Ends the runs a stopped instance left open as `interrupted` (FAILURE_MODEL §2). */
  recover(): void;
  /** How many runs and calls are in flight: the daemon stays while any are (D62). */
  activity(): number;
}

/** A run this instance is executing. */
interface Executing {
  handle?: WorkerHandle;
  callId?: string;
  cancelled: boolean;
  /** Ends the run now: set while it waits for its worker, so a cancel needn't wait for one. */
  endNow?: () => void;
}

function failed(code: string, message: string): RpcError {
  return new RpcError(createDiagnostic(code as never, { message }));
}

/** Creates the actions module. */
export function createActions(options: ActionsOptions): Actions {
  const { interaction, pool, bus, log } = options;
  /** Runs executing in this instance: their worker call, for cancel and crashes. */
  const executing = new Map<string, Executing>();
  /** Which run each worker call is, for crashes. */
  const callRuns = new Map<string, string>();
  /** Why a run's worker stopped under it, until its `execute` ends it. */
  const crashCauses = new Map<string, string>();
  let calls = 0;

  const redact = (text: string): string => options.redactor.redact(text);
  const redactError = (error: WireError): WireError => ({
    message: redact(error.message),
    ...(error.code ? { code: error.code } : {}),
  });

  const versionOf = (versionId: string): WorkerVersion => {
    const version = options.version(versionId);
    if (!version) {
      throw failed(
        "MOSTRA_ACTION_UNKNOWN_FUNCTION",
        "This version has no server code, so it has no server functions to call.",
      );
    }
    return version;
  };

  /**
   * The view's version, which must have the function: a page can't record runs, start workers or
   * spend a key for a function its version doesn't have (INTERFACES §4; Opus review 6).
   */
  const functionOf = (versionId: string, fnId: string): WorkerVersion => {
    const version = versionOf(versionId);
    if (!version.functions.has(fnId)) {
      throw failed(
        "MOSTRA_ACTION_UNKNOWN_FUNCTION",
        `This version has no server function ${fnId.slice(0, 200)}.`,
      );
    }
    const policy = options.dryRun;
    if (policy && !policy.optedIn(versionId, fnId)) {
      policy.skipped(fnId);
      throw failed(
        "MOSTRA_VERIFY_ACTION_SKIPPED",
        `Skipped in verify: the server function ${fnId.slice(0, 200)} doesn't check dryRun(), so verify never runs it.`,
      );
    }
    return version;
  };

  const checkArgs = (args: Batches): void => {
    if (JSON.stringify(args).length > ACTION_ARGS_MAX) {
      throw failed(
        "MOSTRA_ACTION_TOO_LARGE",
        "The serialized arguments are larger than 16 MiB; pass less data, such as identifiers.",
      );
    }
    // What a worker would refuse is refused before one starts or a run is recorded: a page can't
    // make server code hold memory for the life of its process (Opus review 1).
    try {
      checkArgumentFrames(args);
    } catch (error) {
      throw failed("MOSTRA_ACTION_UNSERIALIZABLE", (error as Error).message);
    }
  };

  const publish = (artifactId: string, run: RunDelta): void =>
    bus.publishRun(artifactId, { kind: "run", run });

  /** Runs a recorded run in its version's worker, writing its output as it comes. */
  const execute = async (row: RunRow): Promise<void> => {
    const entry: Executing = { cancelled: false };
    executing.set(row.id, entry);
    let pendingLines: string[] = [];
    let pendingBatches: Frame[][] = [];
    let pendingProgress: RunProgress | undefined;
    let tooLarge = false;
    let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (pendingLines.length === 0 && pendingBatches.length === 0 && pendingProgress === undefined)
        return;
      const output = {
        lines: pendingLines,
        batches: pendingBatches,
        ...(pendingProgress ? { progress: pendingProgress } : {}),
      };
      pendingLines = [];
      pendingBatches = [];
      const progress = pendingProgress;
      pendingProgress = undefined;
      const written = interaction.runOutput(row.id, output);
      if (!written) return;
      publish(row.artifact_id, {
        runId: row.id,
        status: "running",
        ...(progress ? { progress } : {}),
        logFrom: written.logFrom,
        log: written.log,
        batchFrom: written.batchFrom,
        batches: written.batches,
      });
    };
    const soon = (): void => {
      timer ??= setTimeout(flush, FLUSH_MS);
    };
    const end = (
      status: "succeeded" | "failed" | "cancelled",
      reason?: string,
      error?: WireError,
    ): void => {
      flush();
      const state = interaction.endRun(row.id, {
        status,
        ...(reason ? { reason } : {}),
        ...(error ? { error: redactError(error) } : {}),
      });
      if (state) {
        publish(row.artifact_id, {
          runId: row.id,
          status: state.status,
          ...(state.reason ? { reason: state.reason } : {}),
          logFrom: state.log.length,
          log: [],
          batchFrom: state.batches.length,
          batches: [],
          ...(state.error ? { error: state.error } : {}),
          ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
        });
      }
    };

    let ended = false;
    try {
      let handle: WorkerHandle;
      // A cancel while the worker starts (or backs off after a crash) ends the run at once.
      entry.endNow = () => {
        ended = true;
        end("cancelled", "cancelled");
      };
      try {
        handle = await pool.acquire(versionOf(row.version_id));
      } catch (error) {
        delete entry.endNow;
        if (ended) return;
        const diagnostic = error instanceof RpcError ? error.diagnostic : undefined;
        end("failed", diagnostic?.code === "MOSTRA_RUNTIME_WORKER_PARKED" ? "parked" : "crashed", {
          code: diagnostic?.code ?? "MOSTRA_RUNTIME_WORKER_CRASHED",
          message: diagnostic?.message ?? String(error),
        });
        return;
      }
      delete entry.endNow;
      if (ended) return;
      if (entry.cancelled) {
        end("cancelled", "cancelled");
        return;
      }
      interaction.runRunning(row.id);
      publish(row.artifact_id, {
        runId: row.id,
        status: "running",
        logFrom: 0,
        log: [],
        batchFrom: 0,
        batches: [],
      });
      const viewer = row.viewer_id ? interaction.viewer(row.viewer_id) : undefined;
      const { callId, outcome } = handle.call(
        {
          fnId: row.action,
          args: JSON.parse(row.args_json) as Batches,
          context: {
            kind: "run",
            runId: row.id,
            ...(row.view_id ? { viewId: row.view_id } : {}),
            ...(viewer
              ? { viewer: { id: viewer.id, ...(viewer.name ? { name: viewer.name } : {}) } }
              : {}),
            dryRun: options.dryRun !== undefined,
          },
          ...(row.viewer_id ? { viewerId: row.viewer_id } : {}),
        },
        {
          onBatch(batch) {
            if (tooLarge) return;
            size += JSON.stringify(batch).length;
            if (size > ACTION_RESULT_MAX) {
              tooLarge = true;
              handle.cancel(callId, "The result grew past 16 MiB.");
              return;
            }
            pendingBatches.push(redactFrames([...batch], options.redactor));
            soon();
          },
          onProgress(progress) {
            pendingProgress = redactValue(progress, options.redactor);
            soon();
          },
          onLog(line) {
            pendingLines.push(redact(line));
            soon();
          },
        },
      );
      entry.handle = handle;
      entry.callId = callId;
      callRuns.set(callId, row.id);
      if (entry.cancelled) handle.cancel(callId, "The run was cancelled.");
      let result: Awaited<typeof outcome>;
      try {
        result = await outcome;
      } catch (error) {
        // The worker ended during the run (D24: interrupted, never retried by Mostra).
        const cause = crashCauses.get(row.id);
        crashCauses.delete(row.id);
        const message = cause
          ? `The run was interrupted: the artifact's server code stopped (${cause}).`
          : error instanceof RpcError
            ? error.diagnostic.message
            : String(error);
        end("failed", "interrupted", { code: "MOSTRA_ACTION_INTERRUPTED", message });
        return;
      } finally {
        callRuns.delete(callId);
      }
      if (tooLarge) {
        end("failed", "too-large", {
          code: "MOSTRA_ACTION_TOO_LARGE",
          message: "The run's result grew past 16 MiB; the run was stopped.",
        });
      } else if (result.status === "succeeded") {
        end("succeeded");
      } else if (result.status === "cancelled") {
        end("cancelled", "cancelled");
      } else {
        // The stack goes to the run's log, never to the page (INTERFACES §2.4).
        if (result.error.stack) pendingLines.push(...redact(result.error.stack).split("\n"));
        end(
          "failed",
          result.error.code === "MOSTRA_ACTION_UNSERIALIZABLE" ? "unserializable" : "threw",
          { code: result.error.code ?? "MOSTRA_ACTION_THREW", message: result.error.message },
        );
      }
    } catch (error) {
      log.error("action.run_failed", { runId: row.id, error });
      end("failed", "interrupted", {
        code: "MOSTRA_ACTION_INTERRUPTED",
        message: "Mostra couldn't finish running this action.",
      });
    } finally {
      executing.delete(row.id);
    }
  };

  /** A plain call's lines, from a worker that has it. */
  async function* stream(
    page: PageIdentity,
    input: { readonly viewId: string; readonly fnId: string; readonly args: Batches },
    signal: AbortSignal,
    handle: WorkerHandle,
  ): AsyncGenerator<CallLine> {
    const viewer = interaction.viewer(page.viewerId);
    const queue: CallLine[] = [];
    let wake: (() => void) | undefined;
    let size = 0;
    let tooLarge = false;
    const { callId, outcome } = handle.call(
      {
        fnId: input.fnId,
        args: input.args,
        context: {
          kind: "call",
          viewId: input.viewId,
          viewer: { id: viewer.id, ...(viewer.name ? { name: viewer.name } : {}) },
          dryRun: options.dryRun !== undefined,
        },
        viewerId: page.viewerId,
      },
      {
        onBatch(batch) {
          if (tooLarge) return;
          // The same bound as a run's result, so a call never buffers without limit (D131).
          size += JSON.stringify(batch).length;
          if (size > ACTION_RESULT_MAX) {
            tooLarge = true;
            handle.cancel(callId, "The result grew past 16 MiB.");
            return;
          }
          queue.push({ batch: redactFrames([...batch], options.redactor) });
          wake?.();
        },
      },
    );
    calls += 1;
    const abort = (): void => handle.cancel(callId, "The page went away.");
    signal.addEventListener("abort", abort, { once: true });
    let ended: CallLine | undefined;
    void outcome.then(
      (result) => {
        ended = tooLarge
          ? {
              end: {
                status: "failed",
                error: {
                  code: "MOSTRA_ACTION_TOO_LARGE",
                  message: "The call's result grew past 16 MiB; the call was stopped.",
                },
              },
            }
          : result.status === "succeeded"
            ? { end: { status: "succeeded" } }
            : result.status === "cancelled"
              ? {
                  end: {
                    status: "failed",
                    error: { code: "MOSTRA_ACTION_CANCELLED", message: "The call was cancelled." },
                  },
                }
              : {
                  end: {
                    status: "failed",
                    error: redactError({
                      message: result.error.message,
                      code: result.error.code ?? "MOSTRA_ACTION_THREW",
                    }),
                  },
                };
        wake?.();
      },
      (error: unknown) => {
        const diagnostic = error instanceof RpcError ? error.diagnostic : undefined;
        ended = {
          end: {
            status: "failed",
            error: {
              code: diagnostic?.code ?? "MOSTRA_RUNTIME_WORKER_CRASHED",
              message: redact(diagnostic?.message ?? String(error)),
            },
          },
        };
        wake?.();
      },
    );
    try {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift() as CallLine;
          continue;
        }
        if (ended) {
          yield ended;
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } finally {
      calls -= 1;
      signal.removeEventListener("abort", abort);
      // A reader that stopped early (the response failed) leaves nothing running.
      if (!ended) handle.cancel(callId, "The page went away.");
    }
  }

  const bridge: Actions["bridge"] = {
    async request(worker, method, params, call) {
      const runId = call?.context.runId;
      switch (method) {
        case WORKER_METHODS.secret: {
          const { name } = ServerSecretParams.parse(params);
          return { value: await options.secrets.resolve(worker.artifactId, name) };
        }
        case WORKER_METHODS.signal: {
          const parsed = ServerSignalParams.parse(params);
          return {
            cursor: interaction.serverSignal(worker.artifactId, {
              name: parsed.name,
              ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
              ...(runId !== undefined ? { runId } : {}),
              ...(call?.viewerId !== undefined ? { viewerId: call.viewerId } : {}),
            }),
          };
        }
        case WORKER_METHODS.emit: {
          const parsed = ServerEmitParams.parse(params);
          if (!/^host\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parsed.type)) {
            throw failed(
              "MOSTRA_ACTION_EVENT_INVALID",
              `${parsed.type.slice(0, 80)} isn't a host event type.`,
            );
          }
          return {
            cursor: interaction.serverEmit(worker.artifactId, {
              type: parsed.type,
              ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
              ...(runId !== undefined ? { runId } : {}),
              ...(call?.viewerId !== undefined ? { viewerId: call.viewerId } : {}),
            }),
          };
        }
        case WORKER_METHODS.stateGet: {
          const parsed = ServerStateGetParams.parse(params);
          return interaction.serverState(worker.artifactId, parsed.ids);
        }
        case WORKER_METHODS.statePatch: {
          const parsed = ServerStatePatchParams.parse(params);
          return interaction.serverPatch(worker.artifactId, {
            ops: redactValue(parsed.ops, options.redactor),
            ...(parsed.mutationId !== undefined ? { mutationId: parsed.mutationId } : {}),
            ...(parsed.baseRevision !== undefined ? { baseRevision: parsed.baseRevision } : {}),
            ...(runId !== undefined ? { runId } : {}),
          });
        }
        default:
          throw failed("MOSTRA_HOST_METHOD_UNKNOWN", `Mostra serves workers no method ${method}.`);
      }
    },
    log(worker, line) {
      log.info("worker.log", { versionId: worker.versionId, line: redact(line) });
    },
  };

  return {
    async call(page, input, signal) {
      checkArgs(input.args);
      const versionId = interaction.viewVersion(page, input.viewId);
      const handle = await pool.acquire(functionOf(versionId, input.fnId));
      return stream(page, input, signal, handle);
    },

    startRun(page, input) {
      checkArgs(input.args);
      const versionId = interaction.viewVersion(page, input.viewId);
      functionOf(versionId, input.fnId);
      const { state, row, started } = interaction.startRun(page, input);
      bus.attachRuns(page.artifactId, input.viewId, [state.runId]);
      if (started) void execute(row);
      return state;
    },

    attach(page, input) {
      const states = interaction.runsFor(page, input);
      bus.attachRuns(
        page.artifactId,
        input.viewId,
        states.map((state) => state.runId),
      );
      return states;
    },

    cancel(page, viewId, runId) {
      const row = interaction.runFor(page, viewId, runId);
      const running = executing.get(row.id);
      if (running) {
        running.cancelled = true;
        if (running.handle && running.callId) {
          running.handle.cancel(running.callId, "Cancelled from a page.");
        } else running.endNow?.();
      } else if (row.status === "queued" || row.status === "running" || row.status === "waiting") {
        // Recorded but not in this instance (it restarted): nothing runs it, so it ends here.
        interaction.endRun(row.id, { status: "cancelled", reason: "cancelled" });
      }
      return interaction.runState(row.id) as RunState;
    },

    bridge,

    crashed(crash) {
      // The runs' own `execute` ends them, flushing what they logged first; this only says why.
      for (const callId of crash.callIds) {
        const runId = callRuns.get(callId);
        if (runId) crashCauses.set(runId, crash.cause);
      }
    },

    recover() {
      for (const row of interaction.openRuns()) {
        interaction.endRun(row.id, {
          status: "failed",
          reason: "interrupted",
          error: {
            code: "MOSTRA_ACTION_INTERRUPTED",
            message: "The run was interrupted: Mostra stopped while it ran.",
          },
        });
      }
    },

    activity() {
      return executing.size + calls;
    },
  };
}
