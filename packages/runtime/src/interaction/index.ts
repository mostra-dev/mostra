/**
 * The interaction core (ARCHITECTURE §6). This release holds the event log's append path: every
 * durable change appends one event in the same ledger transaction as the change, with a home-wide
 * cursor and a per-artifact sequence (DATA_MODEL §3, §4, IN-08). WP-06 adds drafts, submissions,
 * the outbox and reading, filtering and subscribing on the same table.
 *
 * ```ts
 * ledger.write((db) => {
 *   db.run("INSERT INTO version …");
 *   const cursor = appendEvent(db, { artifactId, type: "version.published", payload: { … } });
 * });
 * ```
 */
import type { LedgerDb } from "../ledger/index.ts";

/** Who caused an event (DATA_MODEL §4). */
export interface EventActor {
  readonly kind: "viewer" | "agent" | "host" | "mostra";
  readonly id?: string;
}

/** One event to append. */
export interface NewEvent {
  /** The artifact the event belongs to, or `null` for a home-wide event. */
  readonly artifactId: string | null;
  /** The event type from DATA_MODEL §4's catalog (`version.published` …). */
  readonly type: string;
  /** Who caused it. Default: an agent, the publisher of versions. */
  readonly actor?: EventActor;
  /** What caused it: a run, a mutation, a submission. */
  readonly causation?: Readonly<Record<string, string>>;
  /** The event's data, JSON. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Appends one event inside the caller's write transaction and returns its cursor (a decimal
 * string, INTERFACES §1). The per-artifact sequence continues from the artifact's last event.
 */
export function appendEvent(db: LedgerDb, event: NewEvent): string {
  const seq =
    event.artifactId === null
      ? null
      : (db.get<{ next: number }>(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM event WHERE artifact_id = ?",
          event.artifactId,
        )?.next ?? 1);
  const result = db.run(
    "INSERT INTO event (artifact_id, seq, type, actor_json, causation_json, payload_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    event.artifactId,
    seq,
    event.type,
    JSON.stringify(event.actor ?? { kind: "agent" }),
    event.causation === undefined ? null : JSON.stringify(event.causation),
    JSON.stringify(event.payload),
    new Date().toISOString(),
  );
  return String(result.lastInsertRowid);
}
