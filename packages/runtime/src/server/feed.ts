/**
 * A hosted home's events for its operator (INTERFACES §18.6, D165 item 9): `submission.accepted`
 * (with the submission's Results), `version.pushed` and `run.ended`, read from the home's own
 * event log after `operator_cursor` and handed to the server's durable outbound queue, so each is
 * delivered at least once with a stable ID (`<home>:<incarnation>:<cursor>`). The cursor moves
 * only after the queue holds what was read; a crash between them hands the same events again,
 * under the same IDs. Submissions are counted for metering on the same read. Each event carries
 * its route's label beside its ID (D167).
 *
 * With neither an events nor a metering port, the cursor follows the head, so an operator added
 * later starts from then rather than from the home's whole history.
 */
import type { OperatorEvent } from "@mostra/protocol/operator";
import type { Interaction } from "../interaction/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { Meter } from "./metering.ts";
import type { Operator } from "./operator.ts";

/** How many events one read takes. */
const PAGE = 200;

/** Options for {@link createOperatorFeed}. */
export interface OperatorFeedOptions {
  readonly homeId: string;
  readonly ledger: Ledger;
  readonly interaction: Interaction;
  readonly operator: Operator;
  readonly meter: Meter;
  readonly account: () => string;
  readonly routeOf: (
    artifactId: string,
  ) => { readonly id: string; readonly label: string } | undefined;
  readonly incarnation: () => string;
  readonly log: Log;
}

/** The feed of one open hosted home. */
export interface OperatorFeed {
  /** Reads what is new now (after every commit, and when the home opens). */
  scan(): void;
  stop(): void;
}

interface EventRow {
  readonly cursor: number;
  readonly artifact_id: string | null;
  readonly type: string;
  readonly payload_json: string;
  readonly at: string;
}

const RUN_ENDS = new Map([
  ["action.succeeded", "succeeded"],
  ["action.failed", "failed"],
  ["action.cancelled", "cancelled"],
  ["action.unknown", "unknown"],
]);

/** Starts the feed of a home. */
export function createOperatorFeed(options: OperatorFeedOptions): OperatorFeed {
  const { ledger, operator, meter, log } = options;
  const wanted = operator.has.events || meter.on;
  let stopped = false;
  let scheduled = false;

  const cursorOf = (): number =>
    ledger.read(
      (db) =>
        db.get<{ cursor: number }>("SELECT cursor FROM operator_cursor WHERE id = 1")?.cursor ?? -1,
    );
  /**
   * Moves the cursor forward. It writes only when the cursor moves, since every write is a commit
   * that schedules another read: a write that changed nothing would read again for ever.
   */
  const setCursor = (cursor: number): void => {
    if (cursor <= cursorOf()) return;
    ledger.write((db) =>
      db.run(
        `INSERT INTO operator_cursor (id, cursor) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET cursor = MAX(cursor, excluded.cursor)`,
        cursor,
      ),
    );
  };
  const head = (): number =>
    ledger.read(
      (db) => db.get<{ head: number | null }>("SELECT MAX(cursor) AS head FROM event")?.head ?? 0,
    );

  const toEvent = (row: EventRow): OperatorEvent | undefined => {
    if (row.artifact_id === null) return undefined;
    const route = options.routeOf(row.artifact_id);
    if (!route) return undefined;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const base = {
      eventId: `${options.homeId}:${options.incarnation()}:${row.cursor}`,
      account: options.account(),
      home: options.homeId,
      routeId: route.id,
      label: route.label,
      artifactId: row.artifact_id,
      at: row.at,
    };
    if (row.type === "submission.created") {
      const results = options.interaction.resultsOf(String(payload["submissionId"]));
      return results ? { ...base, kind: "submission.accepted", payload: results } : undefined;
    }
    if (row.type === "version.published") {
      return {
        ...base,
        kind: "version.pushed",
        payload: { versionId: payload["versionId"], number: payload["number"] },
      };
    }
    const status = RUN_ENDS.get(row.type);
    if (status !== undefined) {
      return {
        ...base,
        kind: "run.ended",
        payload: { runId: payload["runId"], action: payload["action"], status },
      };
    }
    return undefined;
  };

  const scan = (): void => {
    scheduled = false;
    if (stopped) return;
    try {
      let cursor = cursorOf();
      if (!wanted || cursor < 0) {
        // No port reads the feed, or it starts now: from the head, never the whole history.
        setCursor(Math.max(0, head()));
        if (!wanted) return;
        cursor = Math.max(0, cursorOf());
      }
      for (;;) {
        const rows = ledger.read((db) =>
          db.all<EventRow>(
            `SELECT cursor, artifact_id, type, payload_json, at FROM event WHERE cursor > ?
               AND type IN ('submission.created', 'version.published', 'action.succeeded',
                            'action.failed', 'action.cancelled', 'action.unknown')
             ORDER BY cursor LIMIT ?`,
            cursor,
            PAGE,
          ),
        );
        for (const row of rows) {
          const event = toEvent(row);
          if (!event) continue;
          if (event.kind === "submission.accepted") {
            meter.add("submissions", {
              account: event.account,
              home: event.home,
              artifactId: event.artifactId,
              routeId: event.routeId,
            });
          }
          if (operator.has.events) operator.enqueue({ port: "events", event });
        }
        // Up to the last event read, or the head when nothing matched past the cursor.
        const last = rows.at(-1)?.cursor;
        if (last === undefined) {
          setCursor(Math.max(cursor, head()));
          return;
        }
        setCursor(last);
        cursor = last;
        if (rows.length < PAGE) return;
      }
    } catch (error) {
      log.warn("operator.feed_failed", { home: options.homeId, error });
    }
  };

  const unsubscribe = ledger.onCommit(() => {
    if (scheduled || stopped) return;
    scheduled = true;
    setImmediate(scan);
  });
  scan();

  return {
    scan,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
