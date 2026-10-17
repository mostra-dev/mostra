/**
 * Action runs in the ledger (D24, D54, AC-02, AC-03; ARCHITECTURE §7): each invocation through
 * `useAction` is recorded before any worker starts it, keyed so a double click, a second tab or a
 * reload joins the run that exists, and every change of state appends its event in the same
 * transaction. The log is capped at 1 MB with a marker (D47); the result's batches only grow while
 * the run runs, and a finished run never changes again (a trigger refuses it).
 */
import {
  type Actor,
  type Batches,
  createDiagnostic,
  type Frame,
  isFinalRunStatus,
  RpcError,
  RUN_LOG_MAX,
  RUN_LOG_TRUNCATED,
  RunId,
  type RunProgress,
  type RunState,
  type RunStatus,
  type WireError,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";

/** An `action_run` row. */
export interface RunRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly version_id: string;
  readonly view_id: string | null;
  readonly viewer_id: string | null;
  readonly action: string;
  readonly args_json: string;
  readonly key: string | null;
  readonly client_key: string;
  readonly status: RunStatus;
  readonly reason: string | null;
  readonly error_json: string | null;
  readonly progress_json: string | null;
  readonly log_text: string;
  readonly log_lines: number;
  readonly log_truncated: number;
  readonly batches: number;
  readonly result_size: number;
  readonly started_at: string;
  readonly finished_at: string | null;
}

/** A run to record. */
export interface NewRun {
  readonly artifactId: string;
  readonly versionId: string;
  readonly viewId: string;
  readonly viewerId: string;
  readonly fnId: string;
  readonly args: Batches;
  readonly key?: string;
  readonly clientKey: string;
  readonly actor: Actor;
}

/** The run a request names, by ID, of one artifact. */
export function runById(db: LedgerDb, artifactId: string, runId: string): RunRow | undefined {
  return db.get<RunRow>(
    "SELECT * FROM action_run WHERE id = ? AND artifact_id = ?",
    runId,
    artifactId,
  );
}

/** The run of an artifact, function and key, if one was ever started. */
export function runByKey(
  db: LedgerDb,
  artifactId: string,
  fnId: string,
  key: string,
): RunRow | undefined {
  return db.get<RunRow>(
    "SELECT * FROM action_run WHERE artifact_id = ? AND action = ? AND key = ?",
    artifactId,
    fnId,
    key,
  );
}

/**
 * Records a run as `queued` and appends `action.started`, or returns the run the request joins:
 * the one its client key already started (a retried request), or the one its key names (AC-03).
 */
export function createOrJoinRun(db: LedgerDb, input: NewRun): { row: RunRow; joined: boolean } {
  const retried = db.get<RunRow>(
    "SELECT * FROM action_run WHERE artifact_id = ? AND client_key = ?",
    input.artifactId,
    input.clientKey,
  );
  if (retried) {
    // A client key is one page's request: another viewer's never joins it, nor a request for
    // another function (whose run its link may not be allowed to see, Opus review 9).
    if (retried.viewer_id !== input.viewerId || retried.action !== input.fnId) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
          message: "This clientKey belongs to another request; send a new one.",
        }),
      );
    }
    return { row: retried, joined: true };
  }
  if (input.key !== undefined) {
    const keyed = runByKey(db, input.artifactId, input.fnId, input.key);
    if (keyed) return { row: keyed, joined: true };
  }
  const id = RunId.create();
  const startedAt = new Date().toISOString();
  db.run(
    `INSERT INTO action_run (id, artifact_id, version_id, view_id, viewer_id, action, args_json, key,
       client_key, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    id,
    input.artifactId,
    input.versionId,
    input.viewId,
    input.viewerId,
    input.fnId,
    JSON.stringify(input.args),
    input.key ?? null,
    input.clientKey,
    startedAt,
  );
  appendEvent(db, {
    artifactId: input.artifactId,
    type: "action.started",
    actor: input.actor,
    causation: { runId: id, viewId: input.viewId },
    payload: {
      runId: id,
      action: input.fnId,
      ...(input.key !== undefined ? { key: input.key } : {}),
      viewId: input.viewId,
    },
  });
  return {
    row: db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", id) as RunRow,
    joined: false,
  };
}

/** Moves a queued run to `running`, when its worker has it. */
export function markRunning(db: LedgerDb, runId: string): void {
  db.run("UPDATE action_run SET status = 'running' WHERE id = ? AND status = 'queued'", runId);
}

/** What a running run produced since the last flush. */
export interface RunOutput {
  readonly lines: readonly string[];
  readonly batches: readonly (readonly Frame[])[];
  readonly progress?: RunProgress;
}

/** The counts after a flush, and the lines and batches actually kept. */
export interface RunFlush {
  readonly logFrom: number;
  readonly log: readonly string[];
  readonly batchFrom: number;
  readonly batches: readonly (readonly Frame[])[];
  readonly resultSize: number;
}

/**
 * Appends a run's new log lines (until the 1 MB cap, then one marker line) and result batches,
 * and keeps its latest progress. Does nothing to a finished run.
 */
export function appendRunOutput(
  db: LedgerDb,
  runId: string,
  output: RunOutput,
): RunFlush | undefined {
  const row = db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", runId);
  if (!row || isFinalRunStatus(row.status)) return undefined;
  const kept: string[] = [];
  let text = row.log_text;
  let lines = row.log_lines;
  let truncated = row.log_truncated === 1;
  for (const raw of output.lines) {
    for (const line of raw.split(/\r?\n/)) {
      if (truncated) break;
      if (text.length + line.length + 1 > RUN_LOG_MAX) {
        truncated = true;
        kept.push(RUN_LOG_TRUNCATED);
        text += `${lines > 0 ? "\n" : ""}${RUN_LOG_TRUNCATED}`;
        lines += 1;
        break;
      }
      kept.push(line);
      text += `${lines > 0 ? "\n" : ""}${line}`;
      lines += 1;
    }
  }
  let size = row.result_size;
  output.batches.forEach((batch, index) => {
    const json = JSON.stringify(batch);
    size += json.length;
    db.run(
      "INSERT INTO action_run_batch (run_id, seq, batch_json) VALUES (?, ?, ?)",
      runId,
      row.batches + index,
      json,
    );
  });
  db.run(
    `UPDATE action_run SET log_text = ?, log_lines = ?, log_truncated = ?, batches = ?, result_size = ?,
       progress_json = COALESCE(?, progress_json) WHERE id = ?`,
    text,
    lines,
    truncated ? 1 : 0,
    row.batches + output.batches.length,
    size,
    output.progress === undefined ? null : JSON.stringify(output.progress),
    runId,
  );
  return {
    logFrom: row.log_lines,
    log: kept,
    batchFrom: row.batches,
    batches: output.batches,
    resultSize: size,
  };
}

/** How a run ended. */
export interface RunEnd {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly reason?: string;
  readonly error?: WireError;
}

/** Ends a run and appends `action.succeeded`, `action.failed` or `action.cancelled`. */
export function finishRun(db: LedgerDb, runId: string, end: RunEnd): RunRow | undefined {
  const row = db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", runId);
  if (!row || isFinalRunStatus(row.status)) return row;
  const finishedAt = new Date().toISOString();
  db.run(
    "UPDATE action_run SET status = ?, reason = ?, error_json = ?, finished_at = ? WHERE id = ?",
    end.status,
    end.reason ?? null,
    end.error === undefined ? null : JSON.stringify(end.error),
    finishedAt,
    runId,
  );
  appendEvent(db, {
    artifactId: row.artifact_id,
    type: `action.${end.status}`,
    actor: { kind: "mostra" },
    causation: { runId },
    payload: {
      runId,
      action: row.action,
      ...(end.reason !== undefined ? { reason: end.reason } : {}),
      ...(end.error?.code !== undefined ? { code: end.error.code } : {}),
    },
  });
  return db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", runId);
}

/** The runs still open (queued, running or waiting), optionally of one version. */
export function openRuns(db: LedgerDb, versionId?: string): RunRow[] {
  return versionId === undefined
    ? db.all<RunRow>("SELECT * FROM action_run WHERE status IN ('queued', 'running', 'waiting')")
    : db.all<RunRow>(
        "SELECT * FROM action_run WHERE status IN ('queued', 'running', 'waiting') AND version_id = ?",
        versionId,
      );
}

/** A run as a page reads it: state, progress, the whole log and every batch so far. */
export function runState(
  db: LedgerDb,
  row: RunRow,
  joined?: boolean,
  held?: { readonly log: number; readonly batches: number },
): RunState {
  // What the page holds already isn't read again (Opus review 14).
  const batchFrom = Math.min(held?.batches ?? 0, row.batches);
  const batches = db
    .all<{ batch_json: string }>(
      "SELECT batch_json FROM action_run_batch WHERE run_id = ? AND seq >= ? ORDER BY seq",
      row.id,
      batchFrom,
    )
    .map((entry) => JSON.parse(entry.batch_json) as Frame[]);
  const lines = row.log_text === "" && row.log_lines === 0 ? [] : row.log_text.split("\n");
  const logFrom = Math.min(held?.log ?? 0, lines.length);
  const error = row.error_json === null ? undefined : (JSON.parse(row.error_json) as WireError);
  return {
    runId: row.id,
    fnId: row.action,
    ...(row.key !== null ? { key: row.key } : {}),
    status: row.status,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.progress_json !== null
      ? { progress: JSON.parse(row.progress_json) as RunProgress }
      : {}),
    log: logFrom === 0 ? lines : lines.slice(logFrom),
    batches,
    ...(logFrom > 0 ? { logFrom } : {}),
    ...(batchFrom > 0 ? { batchFrom } : {}),
    ...(error
      ? { error: { message: error.message, ...(error.code ? { code: error.code } : {}) } }
      : {}),
    startedAt: row.started_at,
    ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
    ...(joined === undefined ? {} : { joined }),
  };
}
