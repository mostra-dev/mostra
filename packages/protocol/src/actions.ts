/**
 * Actions, live data and secrets (INTERFACES §2.4, §4, §6; D24, D44, D54, D56): the shapes the
 * browser protocol, the host protocol and the worker channel share. Server-function arguments and
 * results travel as the serializer's batches (`Batches`).
 *
 * ```ts
 * const run: RunState = await post("runs", { viewId, fnId: "actions.ts#sendReply", args, clientKey });
 * if (run.status === "succeeded") show(await deserializeAll(run.batches));
 * ```
 */
import * as z from "zod";
import { ViewId } from "./ids.ts";
import type { Frame, WireError } from "./serializer.ts";
import { wireRegistry } from "./wire-registry.ts";

/** A value written by the serializer: its batches, in order (`serializeAll`). */
export type Batches = readonly (readonly Frame[])[];

/**
 * The Zod schema of the `Batches` type: a list of batches, each a list of frames. The frames
 * themselves are checked by the reader (`ValueReader`), which refuses anything malformed.
 */
export const Batches: z.ZodType<Batches> = z
  .array(z.array(z.record(z.string(), z.unknown())).readonly())
  .readonly()
  .register(wireRegistry, {
    id: "Batches",
    description: "A serialized server-function value: its batches of frames, in order.",
  }) as unknown as z.ZodType<Batches>;

/** An error as runs, calls and live sources report it. */
export interface ActionError extends WireError {
  /** The stack of the thrown error, kept in the run log and never sent to a page. */
  readonly stack?: string;
}

/** The Zod schema of the `ActionError` type. */
export const ActionError: z.ZodType<ActionError> = z
  .object({
    message: z.string(),
    code: z.string().exactOptional(),
    stack: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "ActionError",
    description: "An error from server code: its message and diagnostic code.",
  });

/** The largest serialized arguments a call or run takes, in characters of JSON. */
export const ACTION_ARGS_MAX: number = 16 * 1024 * 1024;

/** The largest serialized result a run keeps, in characters of JSON (larger fails the run). */
export const ACTION_RESULT_MAX: number = 16 * 1024 * 1024;

/** The cap of a run's log, in UTF-16 code units of its lines (D47's 1 MB). */
export const RUN_LOG_MAX: number = 1024 * 1024;

/** The line a capped log ends with. */
export const RUN_LOG_TRUNCATED = "[log truncated at 1 MB]";

/** The longest run key, in characters. */
export const RUN_KEY_MAX = 256;

/**
 * A run's state (D24, ARCHITECTURE §7). `queued`: recorded, not yet started in a worker.
 * `running`: started. `waiting` is reserved for a remote server's run that waits for its owner's
 * instance (WP-28, D117); a page that doesn't know it treats it like `queued`. The others are
 * final.
 */
export type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

/** Every run status. */
export const RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
];

/** Whether a run in `status` has ended. */
export function isFinalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/**
 * Why a run ended the way it did, beside its status: `interrupted` (its worker or the instance
 * stopped while it ran, D24), `threw` (the action threw), `unserializable` (its result is outside
 * the type set), `too-large`, `parked` (its artifact's worker keeps crashing), `cancelled` (by a
 * viewer), `unknown-function`. Later releases add reasons.
 */
export type RunReason = string;

/** A run's progress, as the action last reported it. */
export interface RunProgress {
  /** From 0 to 1. */
  readonly fraction?: number;
  /** One short line for people. */
  readonly message?: string;
}

/** The Zod schema of the `RunProgress` type. */
export const RunProgress: z.ZodType<RunProgress> = z
  .object({
    fraction: z.number().min(0).max(1).exactOptional(),
    message: z.string().max(1000).exactOptional(),
  })
  .register(wireRegistry, {
    id: "RunProgress",
    description: "A run's progress: fraction and message.",
  });

/**
 * One action run as a page reads it (D54): its state, progress, log and the result written so far.
 * A result that is an async iterable grows item by item while the run is `running`.
 */
export interface RunState {
  /** The run's `run_` ID. */
  readonly runId: string;
  /** The server function it runs: `<module path>#<export>`. */
  readonly fnId: string;
  /** The idempotency key it was started with, if any. */
  readonly key?: string;
  /** The run's state. */
  readonly status: RunStatus;
  /** Why it ended, for `failed` and `cancelled`. */
  readonly reason?: RunReason;
  /** Its latest progress. */
  readonly progress?: RunProgress;
  /** The log lines, capped at 1 MB with a marker line. */
  readonly log: readonly string[];
  /** The result's batches so far. */
  readonly batches: Batches;
  /** For `failed`: what went wrong, without the stack. */
  readonly error?: WireError;
  /** When it was recorded. */
  readonly startedAt: string;
  /** When it ended. */
  readonly finishedAt?: string;
  /** Whether this request joined a run that already existed (a key or a retried `clientKey`). */
  readonly joined?: boolean;
  /**
   * The index of the first line in `log`, when the request said which lines the page holds
   * (`RunAttachRequest.held`); absent: 0, the whole log.
   */
  readonly logFrom?: number;
  /** The index of the first batch in `batches`, as `logFrom`; absent: 0. */
  readonly batchFrom?: number;
}

/** The Zod schema of the `RunState` type. */
export const RunState: z.ZodType<RunState> = z
  .object({
    runId: z.string(),
    fnId: z.string(),
    key: z.string().exactOptional(),
    status: z.enum(RUN_STATUSES as [RunStatus, ...RunStatus[]]),
    reason: z.string().exactOptional(),
    progress: RunProgress.exactOptional(),
    log: z.array(z.string()).readonly(),
    batches: Batches,
    error: z.object({ message: z.string(), code: z.string().exactOptional() }).exactOptional(),
    startedAt: z.string(),
    finishedAt: z.string().exactOptional(),
    joined: z.boolean().exactOptional(),
    logFrom: z.number().int().nonnegative().exactOptional(),
    batchFrom: z.number().int().nonnegative().exactOptional(),
  })
  .register(wireRegistry, {
    id: "RunState",
    description: "An action run: status, progress, log and the result written so far.",
  });

/**
 * What changed in a run since a page last heard: a lossy notification on the event stream. Lines
 * start at `logFrom` and batches at `batchFrom`; a page that holds fewer reads the run again
 * (`runs/attach`).
 */
export interface RunDelta {
  /** The run's `run_` ID. */
  readonly runId: string;
  /** The run's state. */
  readonly status: RunStatus;
  /** Why it ended so, for `failed` and `cancelled`. */
  readonly reason?: RunReason;
  /** Its latest progress. */
  readonly progress?: RunProgress;
  /** The index of the first line in `log`. */
  readonly logFrom: number;
  /** Log lines, starting at `logFrom`. */
  readonly log: readonly string[];
  /** The index of the first batch in `batches`. */
  readonly batchFrom: number;
  /** Result batches, starting at `batchFrom`. */
  readonly batches: Batches;
  /** What went wrong. */
  readonly error?: WireError;
  /** When it ended. */
  readonly finishedAt?: string;
}

/** A live source's value as a page reads it (D56). */
export interface LiveState {
  /** The idempotency key it was started with, if any. */
  readonly key: string;
  /** The value's revision, a decimal string that only grows; absent before any value. */
  readonly revision?: string;
  /** When the value was produced. */
  readonly at?: string;
  /** The latest value, serialized. */
  readonly value?: Batches;
  /**
   * Append mode (`useLive(key, { mode: "append" })`): the values kept in the source's ring, oldest
   * first, at most the window the page asked for.
   */
  readonly ring?: readonly {
    readonly revision: string;
    readonly at: string;
    readonly value: Batches;
  }[];
  /** The producer's last failure, while the last good value stays (FAILURE_MODEL §6). */
  readonly error?: WireError;
  /**
   * `true` while the source has no value and no failure and the artifact's latest version has a
   * producer whose first `load` is on its way: the page shows it loading, and verify waits for it.
   * Absent for a key nothing produces (one only `mostra push` writes) and for a source that only
   * streams, whose first value may never come (WP-14's Opus review).
   */
  readonly awaiting?: boolean;
}

/** One live update on the event stream: never stored as an event (D63, LL-04). */
export interface LiveUpdate {
  /** The live source's key. */
  readonly key: string;
  /** The value's revision. */
  readonly revision?: string;
  /** When the value was produced. */
  readonly at?: string;
  /** The value, serialized. */
  readonly value?: Batches;
  /** What went wrong. */
  readonly error?: WireError;
  /**
   * `false` when a source read as {@link LiveState.awaiting} turned out to have no first `load`
   * (its producer only streams): the page stops waiting for a first value.
   */
  readonly awaiting?: boolean;
}

/**
 * An ephemeral message on a page's event stream (SSE `event: run` or `event: live`, without an
 * `id`, so a reconnect's cursor is untouched) or in a poll's `ephemeral`: lossy, coalesced, and
 * never stored as an event.
 */
export type EphemeralMessage =
  | { readonly kind: "run"; readonly run: RunDelta }
  | { readonly kind: "live"; readonly live: LiveUpdate };

/** `POST …/call/{fnId}`: a plain server-function call, no durable record (D54). */
export interface CallRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** The arguments, serialized as one array value. */
  readonly args: Batches;
}

/** The Zod schema of the `CallRequest` type. */
export const CallRequest: z.ZodType<CallRequest> = z
  .object({ viewId: ViewId.schema, args: Batches })
  .register(wireRegistry, {
    id: "CallRequest",
    description: "A plain server-function call: the view and the serialized arguments.",
  });

/**
 * One line of a plain call's answer (`application/x-ndjson`): a batch of the result, then the end.
 */
export type CallLine =
  | { readonly batch: readonly Frame[] }
  | { readonly end: { readonly status: "succeeded" } }
  | { readonly end: { readonly status: "failed"; readonly error: WireError } };

/** `POST …/runs`: start a durable action run, or join one (D54, AC-02, AC-03). */
export interface RunRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** `<module path>#<export>`. */
  readonly fnId: string;
  /** The arguments, serialized as one array value. */
  readonly args: Batches;
  /** The author's idempotency key: one run per artifact, function and key, ever. */
  readonly key?: string;
  /** A fresh ID per invocation, so a retried request joins the run it already started. */
  readonly clientKey: string;
}

/** The Zod schema of the `RunRequest` type. */
export const RunRequest: z.ZodType<RunRequest> = z
  .object({
    viewId: ViewId.schema,
    fnId: z.string().min(3).max(1024),
    args: Batches,
    key: z.string().min(1).max(RUN_KEY_MAX).exactOptional(),
    clientKey: z.string().min(8).max(64),
  })
  .register(wireRegistry, {
    id: "RunRequest",
    description: "Start or join an action run: the function, its arguments and keys.",
  });

/**
 * `POST …/runs/attach`: read runs and hear their changes on the event stream for the next minute
 * (re-attach after a reload, AC-02). By ID, or by function and key.
 */
export interface RunAttachRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** Runs by ID. */
  readonly runIds?: readonly string[];
  /** Runs by function and key. */
  readonly keyed?: readonly { readonly fnId: string; readonly key: string }[];
  /**
   * What the page already holds of runs it names by ID: so many log lines and batches. Each such
   * run's answer starts there (`RunState.logFrom`, `batchFrom`), so a page renewing its interest
   * doesn't read the whole run again (Opus review 14).
   */
  readonly held?: readonly {
    readonly runId: string;
    readonly log: number;
    readonly batches: number;
  }[];
}

/** The Zod schema of the `RunAttachRequest` type. */
export const RunAttachRequest: z.ZodType<RunAttachRequest> = z
  .object({
    viewId: ViewId.schema,
    runIds: z.array(z.string().max(64)).max(100).readonly().exactOptional(),
    keyed: z
      .array(
        z.object({ fnId: z.string().min(3).max(1024), key: z.string().min(1).max(RUN_KEY_MAX) }),
      )
      .max(100)
      .readonly()
      .exactOptional(),
    held: z
      .array(
        z.object({
          runId: z.string().max(64),
          log: z.number().int().nonnegative(),
          batches: z.number().int().nonnegative(),
        }),
      )
      .max(100)
      .readonly()
      .exactOptional(),
  })
  .register(wireRegistry, {
    id: "RunAttachRequest",
    description: "Runs a page reads and follows: by ID, or by function and key.",
  });

/** `POST …/runs/{id}/cancel`. */
export interface RunCancelRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
}

/** The Zod schema of the `RunCancelRequest` type. */
export const RunCancelRequest: z.ZodType<RunCancelRequest> = z
  .object({ viewId: ViewId.schema })
  .register(wireRegistry, { id: "RunCancelRequest", description: "Cancel a run, from a view." });

/** The keys of live sources: like JavaScript export names, which is what `live.ts` declares. */
export const LIVE_KEY_PATTERN: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

/** The largest live value, in characters of serialized JSON (DATA_MODEL §5's 4 MiB). */
export const LIVE_VALUE_MAX: number = 4 * 1024 * 1024;

/** The ring size of a pushed source in append mode that no `defineLive` sized. */
export const LIVE_RING_DEFAULT = 1024;

/** The largest ring a source may keep. */
export const LIVE_RING_MAX = 100_000;

/**
 * `POST …/live`: read live sources and keep their producers running for this view for the next
 * minute (D56, LL-04); a page asks again while it shows them.
 */
export interface LiveRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /**
   * The sources, each with its append window; `refresh` asks the source's producer to load again
   * now (`useLive`'s `refresh()`).
   */
  readonly keys: readonly {
    readonly key: string;
    readonly window?: number;
    readonly refresh?: boolean;
  }[];
}

/** The Zod schema of the `LiveRequest` type. */
export const LiveRequest: z.ZodType<LiveRequest> = z
  .object({
    viewId: ViewId.schema,
    keys: z
      .array(
        z.object({
          key: z.string().regex(LIVE_KEY_PATTERN),
          window: z.int().min(1).max(LIVE_RING_MAX).exactOptional(),
          refresh: z.boolean().exactOptional(),
        }),
      )
      .max(256)
      .readonly(),
  })
  .register(wireRegistry, {
    id: "LiveRequest",
    description: "Live sources a page reads and keeps running: keys and append windows.",
  });

/** Secret names: letters, digits, `_`, `.` and `-`, starting with a letter or `_` (D44). */
export const SECRET_NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;

/** The largest secret value, in UTF-8 bytes. */
export const SECRET_VALUE_MAX: number = 64 * 1024;
