/**
 * The worker channel (D124, ARCHITECTURE §7): JSON-RPC 2.0 between the supervisor and an artifact
 * version's worker, over whatever the `WorkerLauncher` connects (a pipe for the local launcher, a
 * socket for a launcher whose worker runs elsewhere). Every message is serializable, so a worker
 * that runs as a separate process, or on another machine, fits without a change. Secrets reach a
 * worker only as answers to its own `server/secret` requests, never through its environment.
 *
 * The supervisor validates everything a worker sends: a worker runs agent-authored code with full
 * capability (D05), and a malformed message must never take the supervisor down.
 */
import * as z from "zod";
import { ActionError, Batches, LIVE_KEY_PATTERN, type RunProgress } from "./actions.ts";
import type { MutationResult } from "./interaction.ts";
import { DocumentRevision, FieldOp } from "./interaction.ts";
import type { Frame, WireError } from "./serializer.ts";

/** The worker channel's revision, which a worker states in its `worker/start` answer. */
export const WORKER_CHANNEL_REVISION = "2026-10-16";

/** The limits a worker runs under (D62): stability, never security. */
export interface WorkerLimits {
  /** The V8 old-space heap, in MiB (default 1024). */
  readonly heapMb: number;
  /** How long the event loop may be blocked before the worker is stopped, in ms (default 10 000). */
  readonly watchdogMs: number;
  /** Idle minutes before the worker is evicted (default 10). */
  readonly idleMinutes: number;
}

/** The default limits (D62). */
export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  heapMb: 1024,
  watchdogMs: 10_000,
  idleMinutes: 10,
};

/**
 * Names a version for a launcher (D124): its ID, the digest of its build output, and where its
 * portable bundle is. A local launcher resolves a `home:` locator to the version's directory in
 * its home; a remote one fetches the bundle and checks the digest. Never a directory path.
 */
export interface WorkerVersionRef {
  /** The version. */
  readonly versionId: string;
  /** The SHA-256 of the version's build output (DATA_MODEL §2). */
  readonly outputDigest: string;
  /** `home:versions/<versionId>` for the home's own store; other schemes for other launchers. */
  readonly locator: string;
}

/** The Zod schema of the `WorkerVersionRef` type. */
export const WorkerVersionRef: z.ZodType<WorkerVersionRef> = z.object({
  versionId: z.string(),
  outputDigest: z.string().regex(/^[0-9a-f]{64}$/),
  locator: z.string().min(1),
});

/** Who a call runs for, as `@mostra/server` exposes it (`viewer()`, `dryRun()`). */
export interface CallContext {
  /** `call`: a plain call. `run`: an action run. */
  readonly kind: "call" | "run";
  /** The run's `run_` ID. */
  readonly runId?: string;
  /** The view the page was opened as (D104). */
  readonly viewId?: string;
  /** The viewer, when there is one. */
  readonly viewer?: { readonly id: string; readonly name?: string };
  /** True only during `verify`'s smoke test (D55). */
  readonly dryRun: boolean;
}

const CallContextSchema: z.ZodType<CallContext> = z.object({
  kind: z.enum(["call", "run"]),
  runId: z.string().exactOptional(),
  viewId: z.string().exactOptional(),
  viewer: z.object({ id: z.string(), name: z.string().exactOptional() }).exactOptional(),
  dryRun: z.boolean(),
});

/** How a live source produces values, as the worker found it in `live.ts`. */
export interface LiveSourceInfo {
  /** The live source's key. */
  readonly key: string;
  /** Whether it has a `load` function. */
  readonly load: boolean;
  /** The refresh interval, in ms. */
  readonly refreshMs?: number;
  /** The globs it watches. */
  readonly watch?: readonly string[];
  /** Whether it has a `stream` function. */
  readonly stream: boolean;
  /** Whether it runs without viewers (D63). */
  readonly always: boolean;
  /** How many values it keeps for append mode. */
  readonly ring?: number;
}

const LiveSourceInfoSchema: z.ZodType<LiveSourceInfo> = z.object({
  key: z.string().regex(LIVE_KEY_PATTERN),
  load: z.boolean(),
  refreshMs: z.int().min(1).exactOptional(),
  watch: z.array(z.string()).readonly().exactOptional(),
  stream: z.boolean(),
  always: z.boolean(),
  ring: z.int().min(1).exactOptional(),
});

// ── Supervisor → worker ────────────────────────────────────────────────────────────────────

/** `worker/start`: the first request; the worker loads the version's server bundle. */
export interface WorkerStartParams {
  /** The artifact. */
  readonly artifactId: string;
  /** The version to load. */
  readonly version: WorkerVersionRef;
  /** The server bundle to load, relative to the version (the render mode's `serverEntry`, D19). */
  readonly entry: string;
  /** The limits it runs under. */
  readonly limits: WorkerLimits;
}

/** What a started worker serves. */
export interface WorkerStartResult {
  /** The value's revision. */
  readonly revision: string;
  /** The server function IDs of the version. */
  readonly functions: readonly string[];
  /** The live sources of `live.ts`. */
  readonly live: readonly LiveSourceInfo[];
}

/** The Zod schema of the `WorkerStartResult` type (the supervisor checks the worker's answer). */
export const WorkerStartResult: z.ZodType<WorkerStartResult> = z.object({
  revision: z.string(),
  functions: z.array(z.string()).readonly(),
  live: z.array(LiveSourceInfoSchema).readonly(),
});

/** The Zod schema of the `WorkerStartParams` type. */
export const WorkerStartParams: z.ZodType<WorkerStartParams> = z.object({
  artifactId: z.string(),
  version: WorkerVersionRef,
  entry: z.string().min(1),
  limits: z.object({
    heapMb: z.int().min(16),
    watchdogMs: z.int().min(100),
    idleMinutes: z.number().min(0),
  }),
});

/**
 * `worker/call`: runs a server function. Its result streams as `worker/batch` notifications
 * before the answer, which says how it ended.
 */
export interface WorkerCallParams {
  /** Unique on this channel; batches, cancellation and server requests name it. */
  readonly callId: string;
  /** The server function: `<module path>#<export>`. */
  readonly fnId: string;
  /** The arguments, serialized as one array value. */
  readonly args: Batches;
  /** Who the call runs for. */
  readonly context: CallContext;
}

/** The Zod schema of the `WorkerCallParams` type. */
export const WorkerCallParams: z.ZodType<WorkerCallParams> = z.object({
  callId: z.string().min(1).max(64),
  fnId: z.string().min(1),
  args: Batches,
  context: CallContextSchema,
});

/** How a call ended. */
export type WorkerCallOutcome =
  | { readonly status: "succeeded" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly error: ActionError };

/** The Zod schema of the `WorkerCallOutcome` type. */
export const WorkerCallOutcome: z.ZodType<WorkerCallOutcome> = z.union([
  z.object({ status: z.literal("succeeded") }),
  z.object({ status: z.literal("cancelled") }),
  z.object({ status: z.literal("failed"), error: ActionError }),
]);

/** `worker/cancel` (notification): aborts a call's `abortSignal`. */
export interface WorkerCancelParams {
  /** The call to cancel. */
  readonly callId: string;
  /** Why, for the run's log. */
  readonly reason?: string;
}

/** `worker/ping`: the watchdog's question. */
export interface WorkerPingResult {
  /** How long the worker's event loop has gone without a turn, in ms. */
  readonly blockedMs: number;
  /** Whether it is blocked on purpose, waiting for a secret (`secret()` is synchronous). */
  readonly waitingForSecret: boolean;
  /** The V8 heap in use, in bytes. */
  readonly heapUsed: number;
}

/** The Zod schema of the `WorkerPingResult` type. */
export const WorkerPingResult: z.ZodType<WorkerPingResult> = z.object({
  blockedMs: z.number().min(0),
  waitingForSecret: z.boolean(),
  heapUsed: z.number().min(0),
});

/** `worker/live.start` and `worker/live.stop` (requests), `worker/live.refresh` (notification). */
export interface WorkerLiveParams {
  /** The live source's key. */
  readonly key: string;
}

// ── Worker → supervisor ────────────────────────────────────────────────────────────────────

/** `worker/batch` (notification): a batch of a call's result. */
export interface WorkerBatchParams {
  /** The call it belongs to. */
  readonly callId: string;
  /** One batch of the result. */
  readonly batch: readonly Frame[];
}

/** The Zod schema of the `WorkerBatchParams` type. */
export const WorkerBatchParams: z.ZodType<WorkerBatchParams> = z.object({
  callId: z.string(),
  batch: z.array(z.record(z.string(), z.unknown())).readonly(),
}) as unknown as z.ZodType<WorkerBatchParams>;

/** `server/progress` (notification). */
export interface ServerProgressParams extends RunProgress {
  /** The call it belongs to. */
  readonly callId: string;
}

/** The Zod schema of the `ServerProgressParams` type. */
export const ServerProgressParams: z.ZodType<ServerProgressParams> = z.object({
  callId: z.string(),
  fraction: z.number().min(0).max(1).exactOptional(),
  message: z.string().max(1000).exactOptional(),
});

/** `server/log` (notification): a line of a run's log, or of the worker's own log. */
export interface ServerLogParams {
  /** The call it belongs to. */
  readonly callId?: string;
  /** One line. */
  readonly line: string;
}

/** The Zod schema of the `ServerLogParams` type. */
export const ServerLogParams: z.ZodType<ServerLogParams> = z.object({
  callId: z.string().exactOptional(),
  line: z.string(),
});

/** `server/secret`: a secret by name (D44); `MOSTRA_SECRET_MISSING` when no store has it. */
export interface ServerSecretParams {
  /** The secret's name. */
  readonly name: string;
}

/** The Zod schema of the `ServerSecretParams` type. */
export const ServerSecretParams: z.ZodType<ServerSecretParams> = z.object({ name: z.string() });

/** `server/signal`: raises `signal.raised` with `source: "action"` (AC-05). */
export interface ServerSignalParams {
  /** The call it belongs to. */
  readonly callId?: string;
  /** The signal's name. */
  readonly name: string;
  /** Any JSON, at most 64 KiB. */
  readonly payload?: unknown;
}

/** The Zod schema of the `ServerSignalParams` type. */
export const ServerSignalParams: z.ZodType<ServerSignalParams> = z.object({
  callId: z.string().exactOptional(),
  name: z.string(),
  payload: z.unknown().exactOptional(),
}) as z.ZodType<ServerSignalParams>;

/** `server/emit`: appends a `host.<name>` event (AC-05). */
export interface ServerEmitParams {
  /** The call it belongs to. */
  readonly callId?: string;
  /** `host.<name>`. */
  readonly type: string;
  /** Any JSON, at most 64 KiB. */
  readonly payload?: unknown;
}

/** The Zod schema of the `ServerEmitParams` type. */
export const ServerEmitParams: z.ZodType<ServerEmitParams> = z.object({
  callId: z.string().exactOptional(),
  type: z.string(),
  payload: z.unknown().exactOptional(),
}) as z.ZodType<ServerEmitParams>;

/** `server/state.get`: reads the artifact's shared state. */
export interface ServerStateGetParams {
  /** The fields to read; absent: all. */
  readonly ids?: readonly string[];
}

/** The Zod schema of the `ServerStateGetParams` type. */
export const ServerStateGetParams: z.ZodType<ServerStateGetParams> = z.object({
  ids: z.array(z.string()).readonly().exactOptional(),
});

/** `server/state.patch`: writes the artifact's shared state as the agent (D63). */
export interface ServerStatePatchParams {
  /** The call it belongs to. */
  readonly callId?: string;
  /** The field changes. */
  readonly ops: readonly FieldOp[];
  /** The change's ID, for idempotent retries. */
  readonly mutationId?: string;
  /** The state revision read; fields changed after it conflict. */
  readonly baseRevision?: DocumentRevision;
}

/** The Zod schema of the `ServerStatePatchParams` type. */
export const ServerStatePatchParams: z.ZodType<ServerStatePatchParams> = z.object({
  callId: z.string().exactOptional(),
  ops: z.array(FieldOp).min(1).max(1000).readonly(),
  mutationId: z.string().exactOptional(),
  baseRevision: DocumentRevision.exactOptional(),
});

/** The answer of `server/state.patch`. */
export type ServerStatePatchResult = MutationResult;

/** `server/live.value` (notification): a producer's new value, or its failure. */
export interface ServerLiveValueParams {
  /** The live source's key. */
  readonly key: string;
  /** The value, serialized. */
  readonly value?: Batches;
  /** What went wrong. */
  readonly error?: WireError;
}

/** The Zod schema of the `ServerLiveValueParams` type. */
export const ServerLiveValueParams: z.ZodType<ServerLiveValueParams> = z.object({
  key: z.string().regex(LIVE_KEY_PATTERN),
  value: Batches.exactOptional(),
  error: z.object({ message: z.string(), code: z.string().exactOptional() }).exactOptional(),
});

/** The channel's method names. */
export const WORKER_METHODS = {
  start: "worker/start",
  call: "worker/call",
  cancel: "worker/cancel",
  ping: "worker/ping",
  liveStart: "worker/live.start",
  liveStop: "worker/live.stop",
  liveRefresh: "worker/live.refresh",
  stop: "worker/stop",
  batch: "worker/batch",
  progress: "server/progress",
  log: "server/log",
  secret: "server/secret",
  signal: "server/signal",
  emit: "server/emit",
  stateGet: "server/state.get",
  statePatch: "server/state.patch",
  liveValue: "server/live.value",
} as const;
