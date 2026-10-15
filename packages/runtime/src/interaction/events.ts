/**
 * The event log (IN-08, DATA_MODEL §3, §4): every durable change appends one event in the same
 * ledger transaction as the change, with a home-wide cursor and a per-artifact sequence. Readers
 * take events after a cursor, in cursor order, through one filter; since the supervisor is the
 * only writer and every commit is serialized, a reader can never see a later cursor before an
 * earlier one commits, so reading on from the last cursor never skips an event.
 *
 * ```ts
 * ledger.write((db) => {
 *   db.run("INSERT INTO version …");
 *   const cursor = appendEvent(db, { artifactId, type: "version.published", payload: { … } });
 * });
 * const { events, cursor } = ledger.read((db) => readEvents(db, { filter, after: "41" }));
 * ```
 */
import {
  type Actor,
  type Cursor,
  createDiagnostic,
  type EventFilter,
  type EventRecord,
  RpcError,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";

/** Who caused an event (DATA_MODEL §4). */
export type EventActor = Actor;

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
  /** The event's data, JSON. Never a sensitive field's value (D52). */
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

/** An `event` row. */
export interface EventRow {
  readonly cursor: number;
  readonly artifact_id: string | null;
  readonly seq: number | null;
  readonly type: string;
  readonly actor_json: string;
  readonly causation_json: string | null;
  readonly payload_json: string;
  readonly at: string;
}

/** An event row as the wire carries it. */
export function eventRecord(row: EventRow): EventRecord {
  return {
    cursor: String(row.cursor) as Cursor,
    artifactId: row.artifact_id,
    seq: row.seq,
    type: row.type,
    at: row.at,
    actor: JSON.parse(row.actor_json) as Actor,
    ...(row.causation_json !== null
      ? { causation: JSON.parse(row.causation_json) as Record<string, string> }
      : {}),
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

/** The newest cursor in the home, or 0 before the first event. */
export function latestCursor(db: LedgerDb): number {
  return db.get<{ cursor: number }>("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM event")
    ?.cursor as number;
}

/** The type of the event compaction leaves behind (DATA_MODEL §4). */
export const COMPACTED = "artifact.compacted";

/** The SQL condition and parameters of a filter, applied before any row is parsed. */
function filterSql(filter: EventFilter | undefined): {
  where: string;
  params: (string | number)[];
} {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.artifacts) {
    if (filter.artifacts.length === 0) return { where: "0", params: [] };
    clauses.push(`artifact_id IN (${filter.artifacts.map(() => "?").join(", ")})`);
    params.push(...filter.artifacts);
  }
  if (filter?.types) {
    const alternatives = [`type = '${COMPACTED}'`];
    for (const pattern of filter.types) {
      if (pattern.endsWith(".*")) {
        const prefix = pattern.slice(0, -1);
        alternatives.push("substr(type, 1, ?) = ?");
        params.push(prefix.length, prefix);
      } else {
        alternatives.push("type = ?");
        params.push(pattern);
      }
    }
    clauses.push(`(${alternatives.join(" OR ")})`);
  }
  return { where: clauses.length === 0 ? "1" : clauses.join(" AND "), params };
}

/**
 * Refuses a read whose cursor falls inside a compacted range of an artifact the filter covers
 * (DATA_MODEL §4): the reader already had events there, and the ones after it are gone. A reader
 * before the range gets the `artifact.compacted` summary in its place, in order.
 */
export function checkCompaction(
  db: LedgerDb,
  filter: EventFilter | undefined,
  after: number,
): void {
  const { where, params } = filterSql(filter?.artifacts ? { artifacts: filter.artifacts } : {});
  const hit = db.get<{ cursor: number }>(
    `SELECT cursor FROM event WHERE type = '${COMPACTED}' AND ${where} AND cursor <= ? AND json_extract(payload_json, '$.through') > ? ORDER BY cursor LIMIT 1`,
    ...params,
    after,
    after,
  );
  if (hit) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOST_CURSOR_COMPACTED", {
        message: `Events after cursor ${after} were compacted; read again after cursor ${hit.cursor - 1} to receive the summary (events from other artifacts may repeat).`,
      }),
    );
  }
}

/** Options for {@link readEvents}. */
export interface ReadOptions {
  readonly filter?: EventFilter | undefined;
  /** Events after this cursor. */
  readonly after: number;
  /** At most this many events. */
  readonly limit: number;
}

/**
 * Reads matching events after a cursor, in order, inside the caller's read transaction. The
 * returned cursor is where the next read continues: the last event returned when the page is full,
 * else the newest cursor examined, so non-matching events are never examined twice.
 */
export function readEvents(
  db: LedgerDb,
  options: ReadOptions,
): { readonly events: EventRecord[]; readonly cursor: string } {
  checkCompaction(db, options.filter, options.after);
  const upTo = latestCursor(db);
  const { where, params } = filterSql(options.filter);
  const rows = db.all<EventRow>(
    `SELECT * FROM event WHERE cursor > ? AND cursor <= ? AND ${where} ORDER BY cursor LIMIT ?`,
    options.after,
    upTo,
    ...params,
    options.limit,
  );
  const events = rows.map(eventRecord);
  const last = rows.at(-1)?.cursor;
  const cursor =
    rows.length === options.limit && last !== undefined ? last : Math.max(upTo, options.after);
  return { events, cursor: String(cursor) };
}

/** What compaction left behind: the `artifact.compacted` event's payload (DATA_MODEL §4). */
export interface CompactionSummary {
  /** The last cursor the summary covers: the artifact's events up to it were replaced. */
  readonly through: number;
  /** How many events it replaced. */
  readonly removed: number;
  /** How many of each type. */
  readonly types: Readonly<Record<string, number>>;
  /** The latest version published within the range. */
  readonly latestVersion?: {
    readonly versionId: unknown;
    readonly number: unknown;
    readonly cursor: number;
  };
}

/**
 * Compacts an artifact's events before `before` (`mostra gc --compact-events`, D47): they are
 * replaced, in this transaction, by one `artifact.compacted` event at the first replaced cursor,
 * whose payload summarizes them. Returns the summary, or `undefined` when nothing was there.
 */
export function compactEvents(
  db: LedgerDb,
  artifactId: string,
  before: number,
): CompactionSummary | undefined {
  const rows = db.all<EventRow>(
    "SELECT * FROM event WHERE artifact_id = ? AND cursor < ? ORDER BY cursor",
    artifactId,
    before,
  );
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return undefined;
  const types: Record<string, number> = {};
  let removed = 0;
  let latestVersion: CompactionSummary["latestVersion"];
  for (const row of rows) {
    if (row.type === COMPACTED) {
      // An earlier summary folds into this one.
      const earlier = JSON.parse(row.payload_json) as CompactionSummary;
      removed += earlier.removed;
      for (const [type, count] of Object.entries(earlier.types))
        types[type] = (types[type] ?? 0) + count;
      if (earlier.latestVersion) latestVersion = earlier.latestVersion;
      continue;
    }
    removed += 1;
    types[row.type] = (types[row.type] ?? 0) + 1;
    if (row.type === "version.published") {
      const payload = JSON.parse(row.payload_json) as { versionId?: unknown; number?: unknown };
      latestVersion = { versionId: payload.versionId, number: payload.number, cursor: row.cursor };
    }
  }
  const summary: CompactionSummary = {
    through: last.cursor,
    removed,
    types,
    ...(latestVersion ? { latestVersion } : {}),
  };
  db.run("DELETE FROM event WHERE artifact_id = ? AND cursor < ?", artifactId, before);
  db.run(
    "INSERT INTO event (cursor, artifact_id, seq, type, actor_json, causation_json, payload_json, at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
    first.cursor,
    artifactId,
    first.seq,
    COMPACTED,
    JSON.stringify({ kind: "mostra" }),
    JSON.stringify(summary),
    new Date().toISOString(),
  );
  return summary;
}
