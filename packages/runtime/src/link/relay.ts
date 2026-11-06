/**
 * The relay on the owner's side (D165 item 4; INTERFACES §18.3): the owner instance runs a hosted
 * artifact's runs and plain calls that its hosted home relays, in its own pool with its own
 * secrets. A relayed run is recorded here under the hosted run's ID before the answer says it was
 * accepted, so a repeated `port/relay.run` joins it and starts nothing; its progress, log, result
 * and end go back as `relay/run.update`, already redacted by the actions module. What a dropped
 * connection loses, the hosted home's reconcile after the reconnect reads again from this ledger.
 * No relay message carries a secret: `secret()` is answered here (D129).
 */
import {
  createDiagnostic,
  type PortRelayCallParams,
  type PortRelayReconcileParams,
  type PortRelayReconcileResult,
  type PortRelayRunParams,
  portRelayCallMethod,
  portRelayCancelMethod,
  portRelayReconcileMethod,
  portRelayRunMethod,
  type RelayRunUpdateParams,
  RpcError,
  relayCallBatchMethod,
  relayEffectMethod,
  relayRunUpdateMethod,
} from "@mostra/protocol";
import type { Actions, RelayedEffect, RunObserver } from "../actions/index.ts";
import { appendEvent, type RunRow, runState } from "../interaction/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { BindingSession } from "./binding.ts";

/** What the owner's relay needs. */
export interface OwnerRelayOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly actions: Pick<Actions, "runRelayed" | "cancelRelayed" | "callRelayed">;
  readonly now: () => number;
  /**
   * Tests: this many accepted runs lose their acknowledgement (the binding drops before the
   * answer), so the hosted home sends them again (`MOSTRA_TEST_RELAY_LOSE_ACK`).
   */
  readonly loseAcks?: number;
}

/** The owner's relay, for one link manager. */
export interface OwnerRelay {
  /** Whether `method` is one of the relay's port calls. */
  handles(method: string): boolean;
  /** Answers a relay port call on the binding of `server`. */
  request(
    server: string,
    session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
    method: string,
    params: unknown,
    /** Drops the binding (a test's lost acknowledgement). */
    drop: () => void,
  ): Promise<unknown>;
  /** The binding of `server` closed: its relayed calls stop. */
  closed(server: string): void;
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message }), -32602);
}

const RELAY_METHODS = new Set([
  portRelayRunMethod.method,
  portRelayCancelMethod.method,
  portRelayReconcileMethod.method,
  portRelayCallMethod.method,
]);

/** Creates the owner's relay. */
export function createOwnerRelay(options: OwnerRelayOptions): OwnerRelay {
  const { ledger, log } = options;
  let loseAcks = options.loseAcks ?? 0;
  /** Relayed calls in flight per server, so a lost binding stops them. */
  const calls = new Map<string, Map<string, AbortController>>();
  /** Each relayed run's last update sequence, from `relayed_run.seq_sent`. */
  const sequences = new Map<string, number>();
  /** Each run's updates in order: a run's messages never overtake each other. */
  const chains = new Map<string, Promise<void>>();

  const nextSeq = (runId: string): number => {
    const known =
      sequences.get(runId) ??
      ledger.read(
        (db) =>
          db.get<{ seq_sent: number }>("SELECT seq_sent FROM relayed_run WHERE run_id = ?", runId)
            ?.seq_sent ?? 0,
      );
    const seq = known + 1;
    sequences.set(runId, seq);
    ledger.write((db) =>
      db.run("UPDATE relayed_run SET seq_sent = ? WHERE run_id = ?", seq, runId),
    );
    return seq;
  };

  /** A relayed run's or call's signals and host events, appended on its hosted home. */
  const effectOf =
    (
      session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
      artifactId: string,
      of: { readonly runId: string } | { readonly callId: string },
    ): RelayedEffect =>
    async (kind, name, payload) => {
      const open = await session();
      if (!open) {
        throw new RpcError(
          createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
            message: "The page's server can't be reached now, so the signal wasn't raised there.",
          }),
        );
      }
      const answer = await open.call(relayEffectMethod, {
        artifactId,
        ...of,
        kind,
        name,
        ...(payload !== undefined ? { payload } : {}),
      });
      return answer.cursor;
    };

  /** Sends one update of a run, after the ones before it; one the binding loses is reconciled. */
  const update = (
    runId: string,
    session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
    body: Omit<RelayRunUpdateParams, "runId" | "seq">,
  ): void => {
    const previous = chains.get(runId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const open = await session();
      if (!open) return;
      try {
        await open.call(relayRunUpdateMethod, { runId, seq: nextSeq(runId), ...body });
      } catch (error) {
        log.warn("relay.update_failed", { runId, error });
      }
    });
    chains.set(runId, next);
    void next.then(() => {
      if (chains.get(runId) === next) chains.delete(runId);
    });
  };

  const observer = (
    runId: string,
    session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
  ): RunObserver => ({
    running: () => update(runId, session, { running: true }),
    output: (flush) =>
      update(runId, session, {
        log: flush.log,
        logFrom: flush.logFrom,
        batches: flush.batches,
        batchFrom: flush.batchFrom,
        ...(flush.progress ? { progress: flush.progress } : {}),
      }),
    ended: (state) => {
      ledger.write((db) =>
        db.run(
          "UPDATE relayed_run SET finished_at = ? WHERE run_id = ?",
          new Date(options.now()).toISOString(),
          runId,
        ),
      );
      if (
        state.status === "succeeded" ||
        state.status === "failed" ||
        state.status === "cancelled"
      ) {
        update(runId, session, {
          end: {
            status: state.status,
            ...(state.reason !== undefined ? { reason: state.reason } : {}),
            ...(state.error ? { error: state.error } : {}),
          },
        });
      }
    },
  });

  /** Records a relayed run under the hosted run's ID, once; then runs it. */
  const run = (
    server: string,
    session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
    params: PortRelayRunParams,
    drop: () => void,
  ): { accepted: true } => {
    const repeated = ledger.write((db): boolean => {
      const existing = db.get<{ id: string; artifact_id: string }>(
        "SELECT id, artifact_id FROM action_run WHERE id = ?",
        params.runId,
      );
      if (existing) {
        if (existing.artifact_id !== params.artifactId)
          throw invalid("That run is another artifact's.");
        return true;
      }
      // Only an artifact this instance shares to that server is its to run (D165 item 1b).
      const owned = db.get<{ artifact_id: string }>(
        "SELECT artifact_id FROM hosted_artifact WHERE artifact_id = ? AND server = ?",
        params.artifactId,
        server,
      );
      if (!owned) {
        throw new RpcError(
          createDiagnostic("MOSTRA_REMOTE_NOT_OWNER_INSTANCE", {
            message: "This instance doesn't share that artifact to this server.",
          }),
        );
      }
      const version = db.get<{ id: string }>(
        "SELECT id FROM version WHERE id = ? AND artifact_id = ?",
        params.versionId,
        params.artifactId,
      );
      if (!version) throw invalid(`This instance has no version ${params.versionId} to run.`);
      const startedAt = new Date(options.now()).toISOString();
      // No key or viewer here: the hosted home holds the run's key (D130) and its viewer, and a
      // local run's key never meets a hosted one.
      db.run(
        `INSERT INTO action_run (id, artifact_id, version_id, view_id, viewer_id, action, args_json, key,
           client_key, status, started_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?, 'queued', ?)`,
        params.runId,
        params.artifactId,
        params.versionId,
        params.fnId,
        JSON.stringify(params.args),
        `relay:${params.runId}`,
        startedAt,
      );
      appendEvent(db, {
        artifactId: params.artifactId,
        type: "action.started",
        actor: { kind: "mostra" },
        causation: { runId: params.runId },
        payload: { runId: params.runId, action: params.fnId, relayed: true, server },
      });
      db.run(
        `INSERT INTO relayed_run (run_id, server, relay_seq, artifact_id, version_id, fn_id, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params.runId,
        server,
        params.seq,
        params.artifactId,
        params.versionId,
        params.fnId,
        startedAt,
      );
      // The highest sequence this ledger accepted: a hosted home restored to before it can tell.
      db.run(
        "UPDATE remote_link SET relay_mark = MAX(relay_mark, ?) WHERE server = ?",
        params.seq,
        server,
      );
      return false;
    });
    if (repeated) {
      // A repeat joins the run: nothing starts again. One that ended while its acknowledgement was
      // lost reports its end now, from this ledger.
      const ended = ledger.read((db) => {
        const row = db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", params.runId);
        return row ? runState(db, row) : undefined;
      });
      if (
        ended &&
        (ended.status === "succeeded" || ended.status === "failed" || ended.status === "cancelled")
      ) {
        update(params.runId, session, {
          running: true,
          log: ended.log,
          logFrom: 0,
          batches: ended.batches,
          batchFrom: 0,
          ...(ended.progress ? { progress: ended.progress } : {}),
          end: {
            status: ended.status,
            ...(ended.reason !== undefined ? { reason: ended.reason } : {}),
            ...(ended.error ? { error: ended.error } : {}),
          },
        });
      }
      return { accepted: true };
    }
    options.actions.runRelayed(params.runId, {
      viewer: params.viewer,
      viewId: params.viewId,
      observer: observer(params.runId, session),
      effect: effectOf(session, params.artifactId, { runId: params.runId }),
    });
    if (loseAcks > 0) {
      loseAcks -= 1;
      log.warn("relay.test_ack_lost", { runId: params.runId });
      drop();
      throw invalid("A test lost this acknowledgement.");
    }
    return { accepted: true };
  };

  /** Each run the hosted home asks about, from what it holds on. */
  const reconcile = (params: PortRelayReconcileParams): PortRelayReconcileResult => {
    const held = new Map((params.held ?? []).map((entry) => [entry.runId, entry]));
    return {
      runs: ledger.read((db) =>
        params.runs.map((runId) => {
          const row = db.get<RunRow>(
            "SELECT a.* FROM action_run a JOIN relayed_run r ON r.run_id = a.id WHERE a.id = ?",
            runId,
          );
          if (!row) return { runId, state: "unknown-to-owner" as const };
          const position = held.get(runId);
          return {
            runId,
            state: runState(
              db,
              row,
              undefined,
              position ? { log: position.log, batches: position.batches } : undefined,
            ),
          };
        }),
      ),
    };
  };

  /** A relayed plain call: started now, its lines streamed back as `relay/call.batch`. */
  const call = async (
    server: string,
    session: () => BindingSession | undefined | Promise<BindingSession | undefined>,
    params: PortRelayCallParams,
  ): Promise<{ accepted: true }> => {
    const owned = ledger.read((db) =>
      db.get<{ artifact_id: string }>(
        "SELECT artifact_id FROM hosted_artifact WHERE artifact_id = ? AND server = ?",
        params.artifactId,
        server,
      ),
    );
    if (!owned) {
      throw new RpcError(
        createDiagnostic("MOSTRA_REMOTE_NOT_OWNER_INSTANCE", {
          message: "This instance doesn't share that artifact to this server.",
        }),
      );
    }
    const abort = new AbortController();
    const lines = await options.actions.callRelayed(
      {
        versionId: params.versionId,
        fnId: params.fnId,
        args: params.args,
        viewer: params.viewer,
        viewId: params.viewId,
        effect: effectOf(session, params.artifactId, { callId: params.callId }),
      },
      abort.signal,
    );
    const inFlight = calls.get(server) ?? new Map<string, AbortController>();
    inFlight.set(params.callId, abort);
    calls.set(server, inFlight);
    void (async () => {
      let seq = 0;
      try {
        for await (const line of lines) {
          const open = await session();
          if (!open) {
            abort.abort();
            return;
          }
          seq += 1;
          await open.call(
            relayCallBatchMethod,
            "batch" in line
              ? { callId: params.callId, seq, batches: [line.batch] }
              : { callId: params.callId, seq, end: line.end },
          );
        }
      } catch (error) {
        log.warn("relay.call_failed", { callId: params.callId, error });
        abort.abort();
      } finally {
        inFlight.delete(params.callId);
      }
    })();
    return { accepted: true };
  };

  return {
    handles: (method) => RELAY_METHODS.has(method),
    async request(server, session, method, params, drop) {
      switch (method) {
        case portRelayRunMethod.method:
          return run(server, session, portRelayRunMethod.params.parse(params), drop);
        case portRelayCancelMethod.method: {
          const { runId } = portRelayCancelMethod.params.parse(params);
          options.actions.cancelRelayed(runId);
          return {};
        }
        case portRelayReconcileMethod.method:
          return reconcile(portRelayReconcileMethod.params.parse(params));
        case portRelayCallMethod.method:
          return call(server, session, portRelayCallMethod.params.parse(params));
        default:
          throw invalid(`The relay serves no method ${method}.`);
      }
    },
    closed(server) {
      for (const abort of calls.get(server)?.values() ?? []) abort.abort();
      calls.delete(server);
    },
  };
}
