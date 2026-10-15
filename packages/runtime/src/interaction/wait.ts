/**
 * `wait` (IN-10, ARCHITECTURE §6, D103): blocks until a condition holds or the timeout passes.
 * `submitted` is level-triggered under `once` (any submission satisfies it, whatever the cursor) and
 * edge-triggered under `epochs`; `signal:`, `state:` and `event:` are edge-triggered after the
 * cursor, which defaults to the artifact's latest publish. A timeout answers `still_waiting` with
 * the newest cursor examined, so a later wait from it misses nothing: every condition is a query of
 * durable events, so nothing that happened while no one waited is lost.
 */
import {
  type Cursor,
  createDiagnostic,
  type EventRecord,
  RpcError,
  type WaitResult,
} from "@mostra/protocol";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import { COMPACTED, checkCompaction, type EventRow, eventRecord, latestCursor } from "./events.ts";
import { storedPolicy } from "./policy.ts";
import type { SubmissionRow } from "./submissions.ts";

/** The cursor a wait starts from by default: the artifact's latest publish (D103). */
export function defaultWaitCursor(db: LedgerDb, artifactId: string): number {
  const published =
    db.get<{ cursor: number | null }>(
      "SELECT MAX(cursor) AS cursor FROM event WHERE artifact_id = ? AND type = 'version.published'",
      artifactId,
    )?.cursor ?? 0;
  // A publish that was compacted away is still known by its cursor, which its summary records:
  // waiting after the summary instead would skip what happened between (Claude review finding 9).
  const compacted =
    db.get<{ cursor: number | null }>(
      `SELECT MAX(json_extract(payload_json, '$.latestVersion.cursor')) AS cursor FROM event WHERE artifact_id = ? AND type = '${COMPACTED}'`,
      artifactId,
    )?.cursor ?? 0;
  return Math.max(published, compacted);
}

/** Builds a `submission.created` record from its row, when compaction removed the event. */
function submissionEvent(db: LedgerDb, row: SubmissionRow): EventRecord {
  const event = db.get<EventRow>("SELECT * FROM event WHERE cursor = ?", row.position);
  if (event && event.type === "submission.created") return eventRecord(event);
  return {
    cursor: String(row.position) as Cursor,
    artifactId: row.artifact_id,
    seq: null,
    type: "submission.created",
    at: row.created_at,
    actor: { kind: "viewer", id: row.viewer_id },
    causation: { submissionId: row.id },
    payload: {
      submissionId: row.id,
      versionId: row.version_id,
      version: (JSON.parse(row.snapshot_json) as { version: number }).version,
      viewId: row.view_id,
      viewerId: row.viewer_id,
      channel: row.channel,
      epoch: row.epoch,
      staleView: row.stale_view === 1,
      digest: row.digest,
    },
  };
}

/**
 * Checks a condition once, inside the caller's read transaction: the event that satisfies it, or
 * the newest cursor examined. Throws `MOSTRA_SUBMIT_POLICY_NONE` for `submitted` on an artifact
 * without submissions, and `MOSTRA_HOST_CURSOR_COMPACTED` for a cursor inside a compacted range.
 */
export function checkCondition(
  db: LedgerDb,
  artifactId: string,
  until: string,
  after: number,
  explicitAfter = true,
): { readonly event: EventRecord } | { readonly cursor: number } {
  const upTo = latestCursor(db);
  const first = (sql: string, ...params: (string | number)[]): EventRow | undefined =>
    db.get<EventRow>(
      `SELECT * FROM event WHERE artifact_id = ? AND cursor > ? AND cursor <= ? AND ${sql} ORDER BY cursor LIMIT 1`,
      artifactId,
      after,
      upTo,
      ...params,
    );
  let found: EventRow | undefined;
  if (until === "submitted") {
    const artifact = db.get<{ policy_json: string | null }>(
      "SELECT policy_json FROM artifact WHERE id = ?",
      artifactId,
    );
    const policy = storedPolicy(artifact?.policy_json ?? null);
    if (policy.policy === "none") {
      throw new RpcError(
        createDiagnostic("MOSTRA_SUBMIT_POLICY_NONE", {
          message:
            "This artifact's submission policy is none: nothing will be submitted to wait for.",
        }),
      );
    }
    // Level-triggered under once per-artifact, and under once per-viewer while no cursor was
    // given: any submission satisfies it. After an explicit cursor, per-viewer is edge-triggered,
    // so a survey's agent can wait for the next respondent (D107).
    const level = policy.policy === "once" && (policy.scope !== "per-viewer" || !explicitAfter);
    const row = level
      ? db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE artifact_id = ? ORDER BY position LIMIT 1",
          artifactId,
        )
      : db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE artifact_id = ? AND position > ? AND position <= ? ORDER BY position LIMIT 1",
          artifactId,
          after,
          upTo,
        );
    if (row) return { event: submissionEvent(db, row) };
    checkCompaction(db, { artifacts: [artifactId] }, after);
    return { cursor: Math.max(upTo, after) };
  }
  checkCompaction(db, { artifacts: [artifactId] }, after);
  const separator = until.indexOf(":");
  const kind = until.slice(0, separator);
  const subject = until.slice(separator + 1);
  if (kind === "signal") {
    found = first("type = 'signal.raised' AND json_extract(payload_json, '$.name') = ?", subject);
  } else if (kind === "state") {
    found = first(
      "type = 'state.changed' AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.changes') WHERE json_extract(json_each.value, '$.id') = ?)",
      subject,
    );
  } else if (kind === "event") {
    found = subject.endsWith(".*")
      ? first("substr(type, 1, ?) = ?", subject.length - 1, subject.slice(0, -1))
      : first("type = ?", subject);
  } else {
    throw new Error(`Unknown wait condition ${until}.`);
  }
  return found ? { event: eventRecord(found) } : { cursor: Math.max(upTo, after) };
}

/** Options for {@link waitFor}. */
export interface WaitOptions {
  readonly ledger: Ledger;
  readonly artifactId: string;
  readonly until: string;
  /** The cursor to wait after; absent: the artifact's latest publish. */
  readonly after?: number | undefined;
  readonly timeoutMs: number;
  /** Ends the wait early (the connection closed, the instance stops): it answers `still_waiting`. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Waits for a condition: checks it now, then again after every commit, until it holds, the timeout
 * passes or `signal` aborts.
 */
export async function waitFor(options: WaitOptions): Promise<WaitResult> {
  const { ledger, artifactId, until } = options;
  const after = options.after ?? ledger.read((db) => defaultWaitCursor(db, artifactId));
  const explicit = options.after !== undefined;
  const check = () => ledger.read((db) => checkCondition(db, artifactId, until, after, explicit));
  const answer = (outcome: ReturnType<typeof check>): WaitResult =>
    "event" in outcome
      ? { status: "satisfied", event: outcome.event, cursor: outcome.event.cursor }
      : { status: "still_waiting", cursor: String(outcome.cursor) };
  const now = check();
  if ("event" in now || options.timeoutMs === 0 || options.signal?.aborted) return answer(now);
  return new Promise<WaitResult>((resolve, reject) => {
    let last: ReturnType<typeof check> = now;
    let settled = false;
    const finish = (result: WaitResult | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      options.signal?.removeEventListener("abort", onAbort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onCommit = (): void => {
      try {
        last = check();
      } catch (error) {
        finish(error as Error);
        return;
      }
      if ("event" in last) finish(answer(last));
    };
    const onAbort = (): void => finish(answer(last));
    const unsubscribe = ledger.onCommit(onCommit);
    const timer = setTimeout(() => {
      // One last look, so a commit at the deadline isn't missed.
      try {
        finish(answer(check()));
      } catch (error) {
        finish(error as Error);
      }
    }, options.timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
