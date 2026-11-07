/**
 * The relay on a hosted home (D117, D165 item 4; ARCHITECTURE §15.5, INTERFACES §18.3, FAILURE_MODEL
 * §11.1): a hosted page's runs and plain calls run on the artifact's owner instance, over that
 * instance's binding. The hosted home records each run as a local instance does, then sends it to
 * the owner, which records it under the same ID, runs it in its own pool with its own secrets and
 * reports its progress, log, result and end back (`relay/run.update`). While the owner is away a
 * run waits (`waiting`), as the artifact's offline policy says, in a capped queue that drains in
 * order at a bounded rate when the owner returns; after every reconnect, before anything drains,
 * the runs the owner accepted and hasn't finished are reconciled with it. A run whose end the owner
 * never reported within the offline limit becomes `unknown`, never `failed`, since it may have
 * taken effect; the owner's later report replaces it once.
 *
 * Plain calls aren't durable: they go out only while the owner is connected.
 */
import {
  ACTION_ARGS_MAX,
  ArtifactManifest,
  type Batches,
  type CallLine,
  checkArgumentFrames,
  createDiagnostic,
  durationMs,
  HOSTED_OFFLINE_LIMIT_DEFAULT,
  isFinalRunStatus,
  type JsonRpcParams,
  type PortRelayReconcileResult,
  portRelayCallMethod,
  portRelayCancelMethod,
  portRelayLiveMethod,
  portRelayReconcileMethod,
  portRelayRunMethod,
  RpcError,
  type RunState,
  relayCallBatchMethod,
  relayEffectMethod,
  relayLiveValueMethod,
  relayRunUpdateMethod,
  type ServerLiveValueParams,
  TALLY_LIVE_PREFIX,
} from "@mostra/protocol";
import type { Actions } from "../actions/index.ts";
import {
  appendRunOutput,
  type EphemeralBus,
  finishRun,
  type Interaction,
  markRunning,
  markUnknown,
  markWaiting,
  type RunRow,
  runState,
} from "../interaction/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { handler, type MethodHandler, type Session } from "../protocol-server/index.ts";

/** How long a relay port call may take: the owner answers once it recorded the run. */
const PORT_CALL_MS = 30_000;
/** How long a run its connected owner never acknowledged waits before it is sent again. */
const RESEND_MS = PORT_CALL_MS + 5_000;
/** Failures of the connection rather than answers of the owner: the run may yet be recorded. */
const TRANSPORT_FAILURES: ReadonlySet<string> = new Set([
  "MOSTRA_HOST_CONNECTION_CLOSED",
  "MOSTRA_HOST_TIMEOUT",
]);
/** The most waiting runs per artifact, by default (a server setting, D165 item 4). */
export const WAITING_RUNS_DEFAULT = 100;
/** How many waiting runs go out per second per artifact when the owner returns, by default. */
export const DRAIN_PER_SECOND_DEFAULT = 2;

/** A version's relay facts: its server functions and its offline policy (`hosted.offline`). */
interface RelayVersion {
  readonly functions: ReadonlySet<string>;
  readonly policy: "queue" | "fail";
  readonly limitMs: number;
  /** Who may trigger its relayed actions (`hosted.actions`, D159): default signed-in viewers. */
  readonly who: "signed-in" | "link";
}

/** Options for {@link createHostedRelay}. */
export interface HostedRelayOptions {
  readonly ledger: Ledger;
  readonly interaction: Interaction;
  readonly bus: EphemeralBus;
  readonly log: Log;
  /** The artifact's owner link (`lnk_`), the one instance its runs go to (D165 item 1b). */
  readonly ownerOf: (artifactId: string) => string | undefined;
  /** The open session of an owner link that registered `relay`, if one is open. */
  readonly sessionOf: (linkId: string) => number | undefined;
  /** Calls a port method on one session. */
  readonly call: (
    session: number,
    method: string,
    params: JsonRpcParams,
    timeoutMs: number,
  ) => Promise<unknown>;
  /** The server functions a version's registry lists. */
  readonly functions: (versionId: string) => ReadonlySet<string>;
  readonly waitingRunsPerArtifact?: number;
  readonly drainPerSecond?: number;
  /**
   * Relayed runs and calls per link (`rateLimits.perLink.relayedRuns`, D159): past it a page is
   * refused before anything is recorded or relayed.
   */
  readonly perLink?: { readonly count: number; readonly perMs: number } | undefined;
  /** How often waiting and unacknowledged runs are checked against their limits; default 1 s. */
  readonly sweepMs?: number;
  /** An artifact's latest version here, whose producers its viewers want. */
  readonly latestVersion?: (artifactId: string) => string | undefined;
  /** Keeps a value an owner's producer made (`relay/live.value`). */
  readonly storeLive?: (
    artifactId: string,
    versionId: string,
    produced: ServerLiveValueParams,
  ) => { readonly revision?: string };
  /** How often viewers' interest in live sources is renewed with the owner; default 20 s. */
  readonly liveRenewMs?: number;
  readonly now?: () => number;
}

/** The relay: the gateway's actions on a hosted home, and the owner's methods. */
export interface HostedRelay extends Pick<Actions, "call" | "startRun" | "attach" | "cancel"> {
  /** `relay/run.update` and `relay/call.batch`, for the hosted home's protocol server. */
  methods(): MethodHandler[];
  /** An owner session opened: reconcile its accepted runs, then resend and drain (§18.3). */
  connected(session: Session): void;
  /** A session closed: its calls end, its runs show their owner unreachable. */
  disconnected(session: Session): void;
  /** Whether runs wait or calls run: the home stays open while they do. */
  busy(): boolean;
  /** A page read live sources: their producers are asked for on the owner now. */
  liveWanted(artifactId: string): void;
  /** Whether an artifact's owner is out of reach, so its live values can't be refreshed. */
  ownerOffline(artifactId: string): boolean;
  stop(): void;
}

/** A `relay_run` row. */
interface RelayRow {
  readonly run_id: string;
  readonly owner_link_id: string;
  readonly relay_seq: number;
  readonly attempt: number;
  readonly sent_at: string | null;
  readonly accepted_at: string | null;
  readonly owner_heard_at: string | null;
  readonly offline_limit_at: string;
  readonly last_seq: number;
  readonly cancel_requested_at: string | null;
}

/** A relayed plain call in flight: its lines as they come. */
interface PendingCall {
  readonly session: number;
  readonly lines: CallLine[];
  wake?: () => void;
  ended: boolean;
  lastSeq: number;
}

function failed(code: string, message: string): RpcError {
  return new RpcError(createDiagnostic(code as never, { message }));
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Creates a hosted home's relay. */
export function createHostedRelay(options: HostedRelayOptions): HostedRelay {
  const { ledger, interaction, bus, log } = options;
  const now = options.now ?? Date.now;
  const cap = options.waitingRunsPerArtifact ?? WAITING_RUNS_DEFAULT;
  const drainPerSecond = Math.max(1, options.drainPerSecond ?? DRAIN_PER_SECOND_DEFAULT);
  const calls = new Map<string, PendingCall>();
  /** Owner links whose reconcile finished on their current session: only then may runs go out. */
  const ready = new Map<string, number>();
  /** Runs being sent now, so a sweep or a second drain never sends one twice at once. */
  const sending = new Set<string>();
  /** When each run was last sent, for the sweep's resend while the owner stays connected. */
  const lastTry = new Map<string, number>();
  const draining = new Set<string>();
  const versions = new Map<string, RelayVersion>();
  /**
   * The highest relay sequence each owner link's ledger has accepted, as its sessions report it
   * (`relayMark`): a home restored from a backup continues above it, so no sequence is reused.
   */
  const marks = new Map<string, number>();
  /** The relay mark each open owner session reported, for a resume run again for it. */
  const sessionMarks = new Map<number, number>();
  /** A resume that failed is tried again for its session, with backoff (Opus review of WP-29, 1). */
  const retries = new Map<number, { timer: ReturnType<typeof setTimeout>; attempt: number }>();
  let stopped = false;

  const versionOf = (versionId: string): RelayVersion => {
    const known = versions.get(versionId);
    if (known) return known;
    const manifestJson = ledger.read(
      (db) =>
        db.get<{ manifest_json: string }>(
          "SELECT manifest_json FROM version WHERE id = ?",
          versionId,
        )?.manifest_json,
    );
    const manifest = manifestJson
      ? ArtifactManifest.safeParse(JSON.parse(manifestJson)).data
      : undefined;
    const offline = manifest?.hosted?.offline;
    const version: RelayVersion = {
      functions: options.functions(versionId),
      policy: offline?.actions ?? "queue",
      limitMs: durationMs(offline?.limit ?? HOSTED_OFFLINE_LIMIT_DEFAULT),
      who: manifest?.hosted?.actions ?? "signed-in",
    };
    versions.set(versionId, version);
    return version;
  };

  const functionOf = (versionId: string, fnId: string): RelayVersion => {
    const version = versionOf(versionId);
    if (!version.functions.has(fnId)) {
      throw failed(
        "MOSTRA_ACTION_UNKNOWN_FUNCTION",
        `This version has no server function ${fnId.slice(0, 200)}.`,
      );
    }
    return version;
  };

  /**
   * D159: a relayed action runs on its owner's machine with its owner's secrets, so by default
   * only a signed-in viewer or an expected respondent (a link minted for a named person) may
   * trigger one; `hosted.actions: "link"` opens it to anyone holding a link with the scope.
   * Refused before anything is recorded or relayed.
   */
  const mayTrigger = (viewerId: string, version: RelayVersion): void => {
    if (version.who === "link") return;
    const viewer = interaction.viewer(viewerId);
    const named =
      viewer.kind === "token" && viewer.ref !== undefined && !viewer.ref.startsWith("link:");
    if (viewer.kind === "account" || named) return;
    throw failed(
      "MOSTRA_REMOTE_SIGN_IN_REQUIRED",
      "Only signed-in viewers can run this page's actions; sign in, or ask its owner for a link of your own.",
    );
  };

  /** Each link's recent relayed runs and calls, for the per-link limit. */
  const linkUses = new Map<string, number[]>();
  /**
   * Counts a relayed run or call against its link (D159), refusing it past the limit with
   * `MOSTRA_REMOTE_RATE_LIMITED` and when to try again. A request that joins a run already
   * recorded (its client key, or its key) starts nothing, so it is never counted.
   */
  const limitLink = (
    tokenId: string | undefined,
    artifactId?: string,
    input?: {
      readonly clientKey: string;
      readonly key?: string | undefined;
      readonly fnId: string;
    },
  ): void => {
    const limit = options.perLink;
    if (!limit || tokenId === undefined) return;
    if (artifactId !== undefined && input !== undefined) {
      const joins = ledger.read(
        (db) =>
          db.get(
            "SELECT 1 FROM action_run WHERE artifact_id = ? AND (client_key = ? OR (key IS NOT NULL AND key = ? AND action = ?))",
            artifactId,
            input.clientKey,
            input.key ?? null,
            input.fnId,
          ) !== undefined,
      );
      if (joins) return;
    }
    const at = now();
    const recent = (linkUses.get(tokenId) ?? []).filter((used) => at - used < limit.perMs);
    if (recent.length >= limit.count) {
      const retryAfter = Math.max(1, Math.ceil(((recent[0] as number) + limit.perMs - at) / 1000));
      const error = failed(
        "MOSTRA_REMOTE_RATE_LIMITED",
        `This link ran ${limit.count} actions recently; try again in ${retryAfter} s.`,
      ) as RpcError & { retryAfter?: number };
      error.retryAfter = retryAfter;
      linkUses.set(tokenId, recent);
      throw error;
    }
    recent.push(at);
    linkUses.set(tokenId, recent);
  };

  const checkArgs = (args: Batches): void => {
    if (JSON.stringify(args).length > ACTION_ARGS_MAX) {
      throw failed(
        "MOSTRA_ACTION_TOO_LARGE",
        "The serialized arguments are larger than 16 MiB; pass less data, such as identifiers.",
      );
    }
    try {
      checkArgumentFrames(args);
    } catch (error) {
      throw failed("MOSTRA_ACTION_UNSERIALIZABLE", (error as Error).message);
    }
  };

  /** Tells a run's views what changed: the state as a delta from nothing held. */
  const publish = (state: RunState, artifactId: string): void =>
    bus.publishRun(artifactId, {
      kind: "run",
      run: {
        runId: state.runId,
        status: state.status,
        ...(state.reason !== undefined ? { reason: state.reason } : {}),
        ...(state.progress ? { progress: state.progress } : {}),
        logFrom: state.logFrom ?? 0,
        log: state.log,
        batchFrom: state.batchFrom ?? 0,
        batches: state.batches,
        ...(state.error ? { error: state.error } : {}),
        ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
      },
    });

  const relayRow = (db: LedgerDb, runId: string): RelayRow | undefined =>
    db.get<RelayRow>("SELECT * FROM relay_run WHERE run_id = ?", runId);
  const runRow = (db: LedgerDb, runId: string): RunRow | undefined =>
    db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", runId);

  /** Whether the owner of a run's artifact is connected and reconciled. */
  const sessionFor = (linkId: string): number | undefined => {
    const session = options.sessionOf(linkId);
    return session !== undefined && ready.get(linkId) === session ? session : undefined;
  };

  /** The owner never heard the run: it ends `failed` with reason `owner-offline` (never sent). */
  const endOffline = (runId: string): void => {
    const state = ledger.write((db) => {
      const row = runRow(db, runId);
      if (!row || isFinalRunStatus(row.status) || row.status === "unknown") return undefined;
      const ended = finishRun(db, runId, {
        status: "failed",
        reason: "owner-offline",
        error: {
          code: "MOSTRA_REMOTE_OWNER_OFFLINE",
          message: "The page's owner was offline, so the action never ran.",
        },
      });
      return ended ? { state: runState(db, ended), artifactId: ended.artifact_id } : undefined;
    });
    if (state) publish(state.state, state.artifactId);
  };

  /** Sends one run to its owner; the answer records that the owner holds it. */
  const send = async (runId: string, session: number): Promise<void> => {
    if (sending.has(runId)) return;
    const prepared = ledger.write((db) => {
      const relay = relayRow(db, runId);
      const row = runRow(db, runId);
      if (!relay || !row || isFinalRunStatus(row.status) || row.status === "unknown")
        return undefined;
      // A run never sent whose offline limit passed never happens, however the owner came back
      // (a home closed while it waited ran no sweep): it ends `failed`, `owner-offline` (Opus
      // review of WP-29, 7).
      if (relay.sent_at === null && Date.parse(relay.offline_limit_at) <= now()) return "expired";
      db.run(
        "UPDATE relay_run SET attempt = attempt + 1, sent_at = COALESCE(sent_at, ?) WHERE run_id = ?",
        iso(now()),
        runId,
      );
      return { relay, row };
    });
    if (!prepared) return;
    if (prepared === "expired") {
      endOffline(runId);
      return;
    }
    const { relay, row } = prepared;
    sending.add(runId);
    try {
      const viewer = row.viewer_id ? interaction.viewer(row.viewer_id) : undefined;
      await options.call(
        session,
        portRelayRunMethod.method,
        {
          runId,
          seq: relay.relay_seq,
          artifactId: row.artifact_id,
          versionId: row.version_id,
          fnId: row.action,
          args: JSON.parse(row.args_json) as Batches,
          ...(row.key !== null ? { key: row.key } : {}),
          ...(viewer
            ? { viewer: { id: viewer.id, ...(viewer.name ? { name: viewer.name } : {}) } }
            : {}),
          ...(row.view_id !== null ? { viewId: row.view_id } : {}),
        },
        PORT_CALL_MS,
      );
      const at = iso(now());
      const cancelled = ledger.write((db) => {
        db.run(
          "UPDATE relay_run SET accepted_at = COALESCE(accepted_at, ?), owner_heard_at = ? WHERE run_id = ?",
          at,
          at,
          runId,
        );
        return relayRow(db, runId)?.cancel_requested_at ?? null;
      });
      // A cancel pressed before the owner had it, or while its acknowledgement was on its way,
      // reaches the run now (Opus review of WP-29).
      if (cancelled !== null) void cancelOnOwner(runId, session);
    } catch (error) {
      const code = error instanceof RpcError ? error.diagnostic.code : undefined;
      if (code !== undefined && !TRANSPORT_FAILURES.has(code)) {
        // The owner answered and refused the run: it records a run before it answers, so a
        // refusal means the run never started there, and it ends failed with the owner's reason.
        refused(runId, (error as RpcError).diagnostic);
      } else {
        // Sent and not acknowledged: it is sent again (after the next reconnect, or by the sweep
        // while the owner stays connected), which joins it if the owner recorded it (§11.1).
        log.warn("relay.send_failed", { runId, error });
      }
    } finally {
      lastTry.set(runId, now());
      sending.delete(runId);
    }
  };

  /** A run its owner refused before recording it ends failed, with the owner's diagnostic. */
  const refused = (runId: string, diagnostic: { code: string; message: string }): void => {
    log.warn("relay.run_refused", { runId, code: diagnostic.code });
    const ended = ledger.write((db) => {
      const row = runRow(db, runId);
      if (!row || isFinalRunStatus(row.status) || row.status === "unknown") return undefined;
      const done = finishRun(db, runId, {
        status: "failed",
        reason: "owner-refused",
        error: { code: diagnostic.code, message: diagnostic.message },
      });
      return done ? { state: runState(db, done), artifactId: done.artifact_id } : undefined;
    });
    if (ended) publish(ended.state, ended.artifactId);
  };

  const cancelOnOwner = async (runId: string, session: number): Promise<void> => {
    try {
      await options.call(session, portRelayCancelMethod.method, { runId }, PORT_CALL_MS);
      ledger.write((db) =>
        db.run("UPDATE relay_run SET cancel_requested_at = NULL WHERE run_id = ?", runId),
      );
    } catch (error) {
      log.warn("relay.cancel_failed", { runId, error });
    }
  };

  /**
   * Applies a run's state as the owner reports it, from what the hosted home holds on: new log
   * lines and batches by position, `running`, and the end (which replaces `unknown` once).
   */
  const apply = (
    runId: string,
    report: {
      readonly running?: boolean;
      readonly progress?: RunState["progress"];
      readonly log?: readonly string[];
      readonly logFrom?: number;
      readonly batches?: Batches;
      readonly batchFrom?: number;
      readonly end?: {
        readonly status: "succeeded" | "failed" | "cancelled";
        readonly reason?: string;
        readonly error?: { readonly message: string; readonly code?: string };
      };
    },
  ): void => {
    const state = ledger.write((db) => {
      const row = runRow(db, runId);
      if (!row || isFinalRunStatus(row.status)) return undefined;
      db.run("UPDATE relay_run SET owner_heard_at = ? WHERE run_id = ?", iso(now()), runId);
      // An update from past what this home holds means one before it was lost: nothing of it is
      // kept, its end least of all, and the owner is asked for the run from what is held, so a
      // run never ends without its result (Opus review of WP-29, 4).
      if (
        (report.logFrom !== undefined && report.logFrom > row.log_lines) ||
        (report.batchFrom !== undefined && report.batchFrom > row.batches)
      ) {
        return "gap" as const;
      }
      if (
        (report.running || report.log || report.batches || report.end) &&
        row.status !== "unknown"
      ) {
        markRunning(db, runId);
      }
      // What the hosted home holds already is skipped, so a repeat appends nothing.
      const lines = report.log ?? [];
      const linesFrom = report.logFrom ?? row.log_lines;
      const freshLines = linesFrom <= row.log_lines ? lines.slice(row.log_lines - linesFrom) : [];
      const batches = report.batches ?? [];
      const batchesFrom = report.batchFrom ?? row.batches;
      const freshBatches =
        batchesFrom <= row.batches ? batches.slice(row.batches - batchesFrom) : [];
      if (freshLines.length > 0 || freshBatches.length > 0 || report.progress) {
        appendRunOutput(db, runId, {
          lines: freshLines,
          batches: freshBatches,
          ...(report.progress ? { progress: report.progress } : {}),
        });
      }
      if (report.end) {
        finishRun(db, runId, {
          status: report.end.status,
          ...(report.end.reason !== undefined ? { reason: report.end.reason } : {}),
          ...(report.end.error ? { error: report.end.error } : {}),
        });
      }
      const after = runRow(db, runId);
      return after ? { state: runState(db, after), artifactId: after.artifact_id } : undefined;
    });
    if (state === "gap") {
      log.warn("relay.update_gap", { runId });
      void catchUp(runId);
      return;
    }
    if (state) publish(state.state, state.artifactId);
  };

  /** Runs being asked for again after a gap, so one gap asks once. */
  const catchingUp = new Set<string>();
  /** Asks the owner for one run's state from what this home holds (a reconcile of that run). */
  const catchUp = async (runId: string): Promise<void> => {
    if (catchingUp.has(runId)) return;
    catchingUp.add(runId);
    try {
      const entry = ledger.read((db) => {
        const relay = relayRow(db, runId);
        const run = runRow(db, runId);
        return relay && run ? { relay, run } : undefined;
      });
      if (!entry) return;
      const session = sessionFor(entry.relay.owner_link_id);
      if (session === undefined) return;
      const answer = (await options.call(
        session,
        portRelayReconcileMethod.method,
        {
          runs: [runId],
          held: [{ runId, log: entry.run.log_lines, batches: entry.run.batches }],
        },
        PORT_CALL_MS,
      )) as PortRelayReconcileResult;
      for (const reconciled of answer.runs) applyReconciled(reconciled);
    } catch (error) {
      // The next reconnect's reconcile asks again.
      log.warn("relay.catch_up_failed", { runId, error });
    } finally {
      catchingUp.delete(runId);
    }
  };

  /** Applies the owner's answer for one run of a reconcile. */
  const applyReconciled = (entry: PortRelayReconcileResult["runs"][number]): void => {
    if (entry.state === "unknown-to-owner") {
      unknown(entry.runId);
      return;
    }
    const state = entry.state;
    apply(entry.runId, {
      running: state.status !== "queued",
      ...(state.progress ? { progress: state.progress } : {}),
      log: state.log,
      logFrom: state.logFrom ?? 0,
      batches: state.batches,
      batchFrom: state.batchFrom ?? 0,
      ...(state.status === "succeeded" || state.status === "failed" || state.status === "cancelled"
        ? {
            end: {
              status: state.status,
              ...(state.reason !== undefined ? { reason: state.reason } : {}),
              ...(state.error ? { error: state.error } : {}),
            },
          }
        : {}),
    });
  };

  /** Moves a run to `unknown`, and tells its views. */
  const unknown = (runId: string): void => {
    const state = ledger.write((db) => {
      if (!markUnknown(db, runId)) return undefined;
      const row = runRow(db, runId);
      return row ? { state: runState(db, row), artifactId: row.artifact_id } : undefined;
    });
    if (state) publish(state.state, state.artifactId);
  };

  /**
   * The runs of a link the owner accepted and the hosted home holds no end for, and every run sent
   * that became `unknown` (its acknowledgement may have been lost): the owner's report replaces
   * `unknown` once, and asking starts nothing (Opus review of WP-29, 8).
   */
  const acceptedOpen = (linkId: string): { relay: RelayRow; run: RunRow }[] =>
    ledger.read((db) =>
      db
        .all<RelayRow & { status: string }>(
          `SELECT r.*, a.status FROM relay_run r JOIN action_run a ON a.id = r.run_id
           WHERE r.owner_link_id = ?
             AND ((r.accepted_at IS NOT NULL AND a.status IN ('queued', 'running', 'waiting'))
               OR (r.sent_at IS NOT NULL AND a.status = 'unknown'))
           ORDER BY r.relay_seq`,
          linkId,
        )
        .map((relay) => ({ relay, run: runRow(db, relay.run_id) as RunRow })),
    );

  /** After a reconnect: reconcile, then resend, then drain the waiting runs in order (§18.3). */
  const resume = async (linkId: string, session: number, relayMark: number): Promise<void> => {
    try {
      // The owner's home was restored to before runs it accepted: they, and every run sent but
      // never acknowledged, become `unknown` and are never sent again.
      const high = ledger.read(
        (db) =>
          db.get<{ high: number | null }>(
            "SELECT MAX(relay_seq) AS high FROM relay_run WHERE owner_link_id = ? AND accepted_at IS NOT NULL",
            linkId,
          )?.high ?? 0,
      );
      if (relayMark < high) {
        const lost = ledger.read((db) =>
          db
            .all<{ run_id: string }>(
              `SELECT r.run_id FROM relay_run r JOIN action_run a ON a.id = r.run_id
               WHERE r.owner_link_id = ? AND r.sent_at IS NOT NULL
                 AND a.status IN ('queued', 'running', 'waiting')`,
              linkId,
            )
            .map((row) => row.run_id),
        );
        log.warn("relay.owner_regressed", { linkId, relayMark, high, runs: lost.length });
        for (const runId of lost) unknown(runId);
      } else {
        const open = acceptedOpen(linkId);
        if (open.length > 0) {
          const answer = (await options.call(
            session,
            portRelayReconcileMethod.method,
            {
              runs: open.map((entry) => entry.run.id),
              held: open.map((entry) => ({
                runId: entry.run.id,
                log: entry.run.log_lines,
                batches: entry.run.batches,
              })),
            },
            PORT_CALL_MS,
          )) as PortRelayReconcileResult;
          for (const entry of answer.runs) applyReconciled(entry);
          // A cancel made while the owner was away reaches it now.
          for (const entry of open) {
            if (entry.relay.cancel_requested_at !== null) void cancelOnOwner(entry.run.id, session);
          }
        }
      }
      if (options.sessionOf(linkId) !== session) return;
      ready.set(linkId, session);
      // The sources its viewers want start again on the owner that came back.
      asked.clear();
      renewLive();
      // Sent and never acknowledged: sent again, which joins the owner's record if it has one.
      const unacknowledged = ledger.read((db) =>
        db
          .all<{ run_id: string }>(
            `SELECT r.run_id FROM relay_run r JOIN action_run a ON a.id = r.run_id
             WHERE r.owner_link_id = ? AND r.sent_at IS NOT NULL AND r.accepted_at IS NULL
               AND a.status IN ('queued', 'running', 'waiting') ORDER BY r.relay_seq`,
            linkId,
          )
          .map((row) => row.run_id),
      );
      for (const runId of unacknowledged) await send(runId, session);
      retries.delete(session);
      void drain(linkId);
    } catch (error) {
      log.warn("relay.resume_failed", { linkId, error });
      // A reconcile that timed out or failed leaves the owner unready: tried again for the same
      // session, 1 s doubling to 60 s, while it stays its link's session.
      if (stopped || options.sessionOf(linkId) !== session) return;
      const attempt = (retries.get(session)?.attempt ?? 0) + 1;
      const timer = setTimeout(
        () => {
          if (options.sessionOf(linkId) === session && ready.get(linkId) !== session) {
            void resume(linkId, session, relayMark);
          }
        },
        Math.min(60_000, 1000 * 2 ** (attempt - 1)),
      );
      timer.unref();
      retries.set(session, { timer, attempt });
    }
  };

  /** Sends a link's waiting runs, oldest first, at most `drainPerSecond` a second per artifact. */
  const drain = async (linkId: string): Promise<void> => {
    if (draining.has(linkId)) return;
    draining.add(linkId);
    try {
      const sentAt = new Map<string, number[]>();
      for (;;) {
        if (stopped) return;
        const session = sessionFor(linkId);
        if (session === undefined) return;
        const next = ledger.read((db) =>
          db.get<{ run_id: string; artifact_id: string }>(
            `SELECT r.run_id, a.artifact_id FROM relay_run r JOIN action_run a ON a.id = r.run_id
             WHERE r.owner_link_id = ? AND r.sent_at IS NULL
               AND a.status IN ('queued', 'waiting') ORDER BY r.relay_seq LIMIT 1`,
            linkId,
          ),
        );
        if (!next) return;
        const times = (sentAt.get(next.artifact_id) ?? []).filter((at) => now() - at < 1000);
        if (times.length >= drainPerSecond) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 - (now() - (times[0] as number))),
          );
          continue;
        }
        times.push(now());
        sentAt.set(next.artifact_id, times);
        await send(next.run_id, session);
      }
    } finally {
      draining.delete(linkId);
    }
  };

  /** Checks waiting and unacknowledged runs against their offline limit's two clocks. */
  const sweep = (): void => {
    const rows = ledger.read((db) =>
      db.all<RelayRow & { status: string; version_id: string; started_at: string }>(
        `SELECT r.*, a.status, a.version_id, a.started_at FROM relay_run r
         JOIN action_run a ON a.id = r.run_id WHERE a.status IN ('queued', 'running', 'waiting')`,
      ),
    );
    const open = new Set(rows.map((row) => row.run_id));
    for (const id of lastTry.keys()) if (!open.has(id)) lastTry.delete(id);
    for (const row of rows) {
      if (sending.has(row.run_id)) continue;
      if (row.sent_at === null) {
        // Never sent: counted from when it was recorded, and it never happened.
        if (Date.parse(row.offline_limit_at) <= now()) endOffline(row.run_id);
        continue;
      }
      // Sent: counted from when the owner was last heard from, and only while it is away. While
      // it stays connected, a run it never acknowledged (its answer timed out) is sent again.
      const session = sessionFor(row.owner_link_id);
      if (session !== undefined) {
        if (row.accepted_at === null && now() - (lastTry.get(row.run_id) ?? 0) >= RESEND_MS) {
          void send(row.run_id, session);
        }
        continue;
      }
      const heard = Date.parse(row.owner_heard_at ?? row.sent_at);
      if (heard + versionOf(row.version_id).limitMs <= now()) unknown(row.run_id);
    }
  };
  const sweeper = setInterval(sweep, options.sweepMs ?? 1000);
  sweeper.unref();

  /** What each artifact's owner was last asked to produce, so a source no one wants is stopped. */
  const asked = new Map<string, ReadonlySet<string>>();
  /** Asks owners for the live sources viewers want now, and stops the ones no one does (§18.3). */
  const renewLive = (only?: string): void => {
    const wanted = new Map<string, Set<string>>();
    for (const entry of bus.liveInterest()) {
      if (entry.key.startsWith(TALLY_LIVE_PREFIX)) continue;
      const keys = wanted.get(entry.artifactId) ?? new Set<string>();
      keys.add(entry.key);
      wanted.set(entry.artifactId, keys);
    }
    const artifacts = new Set([...wanted.keys(), ...asked.keys()]);
    for (const artifactId of artifacts) {
      if (only !== undefined && artifactId !== only) continue;
      const owner = options.ownerOf(artifactId);
      const session = owner === undefined ? undefined : sessionFor(owner);
      const versionId = options.latestVersion?.(artifactId);
      if (session === undefined || versionId === undefined) continue;
      const keys = wanted.get(artifactId) ?? new Set<string>();
      const before = asked.get(artifactId) ?? new Set<string>();
      const stopped = [...before].filter((key) => !keys.has(key));
      const send = (interest: "start" | "renew" | "stop", list: readonly string[]): void => {
        if (list.length === 0) return;
        void options
          .call(
            session,
            portRelayLiveMethod.method,
            { artifactId, versionId, interest, keys: list },
            PORT_CALL_MS,
          )
          .catch((error: unknown) => log.warn("relay.live_interest_failed", { artifactId, error }));
      };
      send("renew", [...keys]);
      send("stop", stopped);
      if (keys.size > 0) asked.set(artifactId, keys);
      else asked.delete(artifactId);
    }
  };
  const liveRenewer = setInterval(() => renewLive(), options.liveRenewMs ?? 20_000);
  liveRenewer.unref();

  const decorate = (state: RunState, artifactId: string): RunState => {
    if (state.status !== "running") return state;
    const owner = options.ownerOf(artifactId);
    return owner !== undefined && sessionFor(owner) !== undefined
      ? state
      : { ...state, ownerUnreachable: true };
  };

  return {
    async call(page, input, signal) {
      checkArgs(input.args);
      const versionId = interaction.viewVersion(page, input.viewId);
      mayTrigger(page.viewerId, functionOf(versionId, input.fnId));
      limitLink(page.tokenId);
      const owner = options.ownerOf(page.artifactId);
      const session = owner === undefined ? undefined : sessionFor(owner);
      if (session === undefined) {
        throw failed(
          "MOSTRA_REMOTE_OWNER_OFFLINE",
          "The page's owner is offline, so its server code can't answer now; try again later.",
        );
      }
      const callId = `call_${crypto.randomUUID()}`;
      const pending: PendingCall = { session, lines: [], ended: false, lastSeq: 0 };
      calls.set(callId, pending);
      const viewer = interaction.viewer(page.viewerId);
      try {
        await options.call(
          session,
          portRelayCallMethod.method,
          {
            callId,
            artifactId: page.artifactId,
            versionId,
            fnId: input.fnId,
            args: input.args,
            viewer: { id: viewer.id, ...(viewer.name ? { name: viewer.name } : {}) },
            viewId: input.viewId,
          },
          PORT_CALL_MS,
        );
      } catch (error) {
        calls.delete(callId);
        throw error instanceof RpcError
          ? failed(
              "MOSTRA_REMOTE_OWNER_OFFLINE",
              `The page's owner couldn't take the call: ${error.diagnostic.message}`,
            )
          : error;
      }
      const lines = async function* (): AsyncGenerator<CallLine> {
        try {
          for (;;) {
            const line = pending.lines.shift();
            if (line) {
              yield line;
              if ("end" in line) return;
              continue;
            }
            if (pending.ended || signal.aborted) return;
            await new Promise<void>((resolve) => {
              pending.wake = resolve;
            });
          }
        } finally {
          calls.delete(callId);
        }
      };
      return lines();
    },

    startRun(page, input) {
      checkArgs(input.args);
      const versionId = interaction.viewVersion(page, input.viewId);
      const version = functionOf(versionId, input.fnId);
      mayTrigger(page.viewerId, version);
      limitLink(page.tokenId, page.artifactId, input);
      const owner = options.ownerOf(page.artifactId);
      if (owner === undefined) {
        throw failed("MOSTRA_REMOTE_OWNER_OFFLINE", "This page has no owner instance to run it.");
      }
      const connected = sessionFor(owner) !== undefined;
      // Past the cap a run is refused before anything is recorded (D165 item 4). A request that
      // joins a run already recorded is never refused.
      if (!connected && version.policy === "queue") {
        const waiting = ledger.read(
          (db) =>
            db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM action_run WHERE artifact_id = ? AND status = 'waiting'",
              page.artifactId,
            )?.n ?? 0,
        );
        const joins = ledger.read(
          (db) =>
            db.get<{ id: string }>(
              `SELECT id FROM action_run WHERE artifact_id = ? AND (client_key = ? OR (key IS NOT NULL AND key = ? AND action = ?))`,
              page.artifactId,
              input.clientKey,
              input.key ?? null,
              input.fnId,
            ) !== undefined,
        );
        if (waiting >= cap && !joins) {
          throw failed(
            "MOSTRA_REMOTE_QUEUE_FULL",
            "Too many actions are waiting for this page's owner; try again once it is back.",
          );
        }
      }
      const { state, row, started } = interaction.startRun(page, input);
      bus.attachRuns(page.artifactId, input.viewId, [state.runId]);
      if (!started) return decorate(state, page.artifactId);
      // The relay's record, in the order runs were made: its sequence is unique per owner link and
      // continues above the owner's mark after a restore (§18.2).
      const recorded = Date.parse(row.started_at);
      const waitingState = ledger.write((db) => {
        const seq =
          (db.get<{ high: number | null }>(
            "SELECT MAX(relay_seq) AS high FROM relay_run WHERE owner_link_id = ?",
            owner,
          )?.high ?? 0) + 1;
        const floor = marks.get(owner) ?? 0;
        db.run(
          "INSERT INTO relay_run (run_id, owner_link_id, relay_seq, offline_limit_at) VALUES (?, ?, ?, ?)",
          row.id,
          owner,
          Math.max(seq, floor + 1),
          iso(recorded + version.limitMs),
        );
        if (connected) return undefined;
        markWaiting(db, row.id);
        const after = runRow(db, row.id);
        return after ? runState(db, after) : undefined;
      });
      if (connected) {
        const session = sessionFor(owner);
        if (session !== undefined) void send(row.id, session);
        return state;
      }
      if (version.policy === "fail") {
        endOffline(row.id);
        return interaction.runState(row.id) ?? state;
      }
      if (waitingState) publish(waitingState, page.artifactId);
      return waitingState ?? state;
    },

    attach(page, input) {
      const states = interaction.runsFor(page, input);
      bus.attachRuns(
        page.artifactId,
        input.viewId,
        states.map((state) => state.runId),
      );
      return states.map((state) => decorate(state, page.artifactId));
    },

    cancel(page, viewId, runId) {
      const row = interaction.runFor(page, viewId, runId);
      const relay = ledger.read((db) => relayRow(db, row.id));
      if (!relay || relay.sent_at === null) {
        // Never sent: it ends here without contacting the owner.
        if (!isFinalRunStatus(row.status) && row.status !== "unknown") {
          const ended = interaction.endRun(row.id, { status: "cancelled", reason: "cancelled" });
          if (ended) publish(ended, row.artifact_id);
        }
        return interaction.runState(row.id) as RunState;
      }
      ledger.write((db) =>
        db.run("UPDATE relay_run SET cancel_requested_at = ? WHERE run_id = ?", iso(now()), row.id),
      );
      const session = sessionFor(relay.owner_link_id);
      if (session !== undefined && relay.accepted_at !== null) void cancelOnOwner(row.id, session);
      return decorate(interaction.runState(row.id) as RunState, row.artifact_id);
    },

    methods() {
      return [
        handler(relayRunUpdateMethod, (params, session) => {
          const known = ledger.read((db) => relayRow(db, params.runId));
          if (!known || known.owner_link_id !== session.link?.instanceId) {
            // A home restored to before this run: the owner keeps and finishes it locally.
            log.warn("relay.update_dropped", { runId: params.runId });
            return {};
          }
          if (params.seq <= known.last_seq) return {};
          ledger.write((db) =>
            db.run("UPDATE relay_run SET last_seq = ? WHERE run_id = ?", params.seq, params.runId),
          );
          apply(params.runId, params);
          return {};
        }),
        handler(relayLiveValueMethod, (params, session) => {
          if (options.ownerOf(params.artifactId) !== session.link?.instanceId) {
            throw failed(
              "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
              "This instance doesn't own that artifact here.",
            );
          }
          return (
            options.storeLive?.(params.artifactId, params.versionId, {
              key: params.key,
              ...(params.value !== undefined ? { value: params.value } : {}),
              ...(params.error !== undefined ? { error: params.error } : {}),
            }) ?? {}
          );
        }),
        handler(relayEffectMethod, (params, session) => {
          // Only the artifact's owner instance speaks for its runs (D165 item 1b).
          if (options.ownerOf(params.artifactId) !== session.link?.instanceId) {
            throw failed(
              "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
              "This instance doesn't own that artifact here.",
            );
          }
          const row =
            params.runId !== undefined
              ? ledger.read((db) => runRow(db, params.runId as string))
              : undefined;
          if (params.runId !== undefined && row?.artifact_id !== params.artifactId) {
            throw failed("MOSTRA_ACTION_RUN_NOT_FOUND", "This home has no such run.");
          }
          const viewerId = row?.viewer_id ?? undefined;
          const common = {
            ...(params.payload !== undefined ? { payload: params.payload } : {}),
            ...(params.runId !== undefined ? { runId: params.runId } : {}),
            ...(viewerId !== undefined ? { viewerId } : {}),
          };
          if (params.kind === "signal") {
            return {
              cursor: interaction.serverSignal(params.artifactId, { name: params.name, ...common }),
            };
          }
          if (!/^host\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(params.name)) {
            throw failed(
              "MOSTRA_ACTION_EVENT_INVALID",
              `${params.name.slice(0, 80)} isn't a host event type.`,
            );
          }
          return {
            cursor: interaction.serverEmit(params.artifactId, { type: params.name, ...common }),
          };
        }),
        handler(relayCallBatchMethod, (params, session) => {
          const pending = calls.get(params.callId);
          if (!pending || pending.session !== session.id || params.seq <= pending.lastSeq)
            return {};
          pending.lastSeq = params.seq;
          for (const batch of params.batches ?? []) pending.lines.push({ batch: [...batch] });
          if (params.end) {
            pending.lines.push(
              params.end.status === "succeeded"
                ? { end: { status: "succeeded" } }
                : {
                    end: {
                      status: "failed",
                      error: params.end.error ?? { message: "The call failed on its owner." },
                    },
                  },
            );
            pending.ended = true;
          }
          pending.wake?.();
          return {};
        }),
      ];
    },

    connected(session) {
      const linkId = session.link?.instanceId;
      if (linkId === undefined || !session.ports.has("relay")) return;
      const mark = session.link?.relayMark ?? 0;
      marks.set(linkId, Math.max(marks.get(linkId) ?? 0, mark));
      sessionMarks.set(session.id, mark);
      void resume(linkId, session.id, mark);
    },

    disconnected(session) {
      const linkId = session.link?.instanceId;
      sessionMarks.delete(session.id);
      const retry = retries.get(session.id);
      if (retry) clearTimeout(retry.timer);
      retries.delete(session.id);
      if (linkId !== undefined && ready.get(linkId) === session.id) ready.delete(linkId);
      // The link's session now, if it isn't ready (it opened while this one was still the link's,
      // so its resume stopped short), is resumed: nothing else would (Opus review of WP-29, 1).
      if (linkId !== undefined) {
        const live = options.sessionOf(linkId);
        if (live !== undefined && live !== session.id && ready.get(linkId) !== live) {
          void resume(linkId, live, sessionMarks.get(live) ?? marks.get(linkId) ?? 0);
        }
      }
      for (const [callId, pending] of calls) {
        if (pending.session !== session.id) continue;
        pending.lines.push({
          end: {
            status: "failed",
            error: {
              code: "MOSTRA_REMOTE_OWNER_OFFLINE",
              message: "The page's owner went offline before the call ended.",
            },
          },
        });
        pending.ended = true;
        pending.wake?.();
        calls.delete(callId);
      }
    },

    busy() {
      return (
        calls.size > 0 ||
        ledger.read(
          (db) =>
            (db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM action_run WHERE status IN ('queued', 'running', 'waiting')",
            )?.n ?? 0) > 0,
        )
      );
    },

    liveWanted(artifactId) {
      const known = asked.get(artifactId);
      const fresh = bus
        .liveInterest()
        .some(
          (entry) =>
            entry.artifactId === artifactId &&
            !entry.key.startsWith(TALLY_LIVE_PREFIX) &&
            !(known?.has(entry.key) ?? false),
        );
      if (fresh) renewLive(artifactId);
    },

    ownerOffline(artifactId) {
      const owner = options.ownerOf(artifactId);
      return owner === undefined || sessionFor(owner) === undefined;
    },

    stop() {
      stopped = true;
      for (const retry of retries.values()) clearTimeout(retry.timer);
      retries.clear();
      clearInterval(sweeper);
      clearInterval(liveRenewer);
    },
  };
}
