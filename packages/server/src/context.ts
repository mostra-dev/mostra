/**
 * The request context of server code (D19 seam 3): which call is running, for whom, and how to
 * reach the supervisor. Every call runs inside `AsyncLocalStorage`, so concurrent calls in one
 * worker each see their own viewer, run and `abortSignal` across every `await`. The worker installs
 * the {@link ServerHost} once; this module never does I/O of its own.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FieldOp, MutationResult } from "@mostra/protocol";

/** One call as server code sees it. */
export interface ServerCallContext {
  /** `call`: a plain call, no durable record. `run`: an action run (D54). */
  readonly kind: "call" | "run";
  /** The channel's ID of the call: progress, logs and signals name it. */
  readonly callId: string;
  /** The action run, for `kind: "run"`. */
  readonly runId?: string;
  /** Who the call is for. */
  readonly viewer?: { readonly id: string; readonly name?: string };
  /** True only during `verify`'s smoke test (D55). */
  readonly dryRun: boolean;
  /** Aborted when the run is cancelled or the caller goes away (AC-04). */
  readonly signal: AbortSignal;
}

/** The artifact's shared state as the supervisor answers it. */
export interface StateSnapshot {
  /** The state document's revision. */
  readonly revision: string;
  /** Its fields by ID. */
  readonly fields: Readonly<
    Record<string, { readonly value?: unknown; readonly deleted?: boolean }>
  >;
}

/** What `@mostra/server` needs from the process it runs in: the worker implements it. */
export interface ServerHost {
  /** The secret's value; throws an error with `code: "MOSTRA_SECRET_MISSING"` when there is none. */
  secret(name: string): string;
  /** Reports a call's progress. */
  progress(callId: string, progress: { fraction?: number; message?: string }): void;
  /** Adds a line to a call's log, or to the worker's own outside calls. */
  log(callId: string | undefined, line: string): void;
  /** Raises a signal (already checked). */
  signal(callId: string | undefined, name: string, payload: unknown): void;
  /** Appends a host event (already checked). */
  emit(callId: string | undefined, type: string, payload: unknown): void;
  /** Reads the artifact's shared state. */
  stateGet(ids: readonly string[] | undefined): Promise<StateSnapshot>;
  /** Writes the artifact's shared state as the agent. */
  statePatch(
    callId: string | undefined,
    ops: readonly FieldOp[],
    options: { readonly mutationId?: string; readonly baseRevision?: string },
  ): Promise<MutationResult>;
}

const storage = new AsyncLocalStorage<ServerCallContext>();
let installed: ServerHost | undefined;

/** Installs the process's {@link ServerHost}; the worker calls it once, before loading code. */
export function installServerHost(host: ServerHost): void {
  installed = host;
}

/** The installed host, or an error naming where server code must run. */
export function serverHost(): ServerHost {
  if (!installed) {
    throw Object.assign(
      new Error(
        '@mostra/server works only inside an artifact\'s worker: call it from a "use server" function or a live source.',
      ),
      { code: "MOSTRA_TARGET_UNAVAILABLE" },
    );
  }
  return installed;
}

/** The current call, or `undefined` outside any (module scope, a timer started at load). */
export function currentCall(): ServerCallContext | undefined {
  return storage.getStore();
}

/** Runs `fn` as `context`: everything it awaits sees the same call. */
export function runWithContext<T>(context: ServerCallContext, fn: () => T): T {
  return storage.run(context, fn);
}
