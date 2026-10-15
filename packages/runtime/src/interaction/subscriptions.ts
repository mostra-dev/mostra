/**
 * Event subscriptions (IN-08, H-09; INTERFACES §6): `events/subscribe` delivers a connection the
 * events that pass its filter, as `events/notify` notifications in cursor order without gaps;
 * `events/ack` records how far a named subscriber got, durably, so its next subscription with the
 * same name resumes there after any disconnect or restart. Delivery follows every commit.
 */
import {
  createDiagnostic,
  EVENTS_NOTIFY,
  type EventFilter,
  type EventsNotifyParams,
  type EventsSubscribeParams,
  type EventsSubscribeResult,
  RpcError,
} from "@mostra/protocol";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { latestCursor, readEvents } from "./events.ts";

/** Events per notification. */
const PAGE = 100;

/** Pages one pump sends before yielding, so a long backlog never blocks the instance. */
const PAGES_PER_TURN = 10;

/** Bytes one pump sends before yielding. */
const BYTES_PER_TURN: number = 8 * 1024 * 1024;

/** A connection as subscriptions see it. */
export interface SubscriberSession {
  readonly id: number;
  /** The notifications the client accepted in `mostra/initialize` (D84). */
  readonly notifications: ReadonlySet<string>;
}

interface Subscription {
  readonly id: string;
  readonly session: number;
  readonly filter: EventFilter | undefined;
  readonly name: string | undefined;
  /** Every event up to here was examined and the matching ones sent. */
  cursor: number;
  /** Whether the pump waits for the connection to drain. */
  waiting: boolean;
}

/** Options for {@link Subscriptions}. */
export interface SubscriptionsOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  /** Sends a notification on a connection; `false` when the connection is gone. */
  readonly notify: (session: number, method: string, params: EventsNotifyParams) => boolean;
  /** A promise that settles when the connection can take more, or `undefined` when it can now. */
  readonly drained: (session: number) => Promise<void> | undefined;
}

/** The event subscriptions of one instance. */
export class Subscriptions {
  readonly #options: SubscriptionsOptions;
  readonly #all = new Map<string, Subscription>();
  #next = 1;
  #unsubscribe: (() => void) | undefined;
  #scheduled = false;

  constructor(options: SubscriptionsOptions) {
    this.#options = options;
  }

  /** Delivers after every commit. */
  start(): void {
    this.#unsubscribe = this.#options.ledger.onCommit(() => this.#pumpAll());
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#all.clear();
  }

  /** `events/subscribe` on a connection. */
  subscribe(session: SubscriberSession, params: EventsSubscribeParams): EventsSubscribeResult {
    if (!session.notifications.has(EVENTS_NOTIFY)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_NOTIFICATION_UNSUPPORTED", {
          message: `events/subscribe sends ${EVENTS_NOTIFY}, which this connection didn't accept in mostra/initialize.`,
        }),
      );
    }
    const { ledger } = this.#options;
    const cursor = ledger.write((db) => {
      const latest = latestCursor(db);
      let start: number;
      if (params.after !== undefined) start = Number(params.after);
      else {
        // A known name resumes after its acknowledged cursor; a new one, like an unnamed
        // subscription, starts now (the history stays readable through events/read).
        const known =
          params.name === undefined
            ? undefined
            : db.get<{ acked_cursor: number }>(
                "SELECT acked_cursor FROM subscriber WHERE name = ?",
                params.name,
              );
        start = known?.acked_cursor ?? latest;
      }
      if (params.name !== undefined) {
        db.run(
          `INSERT INTO subscriber (name, filter_json, acked_cursor, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET filter_json = excluded.filter_json, updated_at = excluded.updated_at`,
          params.name,
          JSON.stringify(params.filter ?? {}),
          start,
          new Date().toISOString(),
        );
      }
      // A cursor inside a compacted range isn't refused: the subscription delivers the summary
      // in order, flagged `compacted`, and goes on.
      return start;
    });
    const subscription: Subscription = {
      id: `sub-${session.id}-${this.#next++}`,
      session: session.id,
      filter: params.filter,
      name: params.name,
      cursor,
      waiting: false,
    };
    this.#all.set(subscription.id, subscription);
    // The answer goes out first; the backlog follows it.
    setImmediate(() => this.#pump(subscription));
    return { subscriptionId: subscription.id, cursor: String(cursor) };
  }

  /** `events/unsubscribe`. */
  unsubscribe(session: SubscriberSession, subscriptionId: string): void {
    this.#owned(session, subscriptionId);
    this.#all.delete(subscriptionId);
  }

  /** `events/ack`: durable for a named subscriber; an earlier cursor changes nothing. */
  ack(session: SubscriberSession, subscriptionId: string, cursor: number): void {
    const subscription = this.#owned(session, subscriptionId);
    if (subscription.name === undefined) return;
    this.#options.ledger.write((db) =>
      db.run(
        "UPDATE subscriber SET acked_cursor = MAX(acked_cursor, MIN(?, ?)), updated_at = ? WHERE name = ?",
        cursor,
        latestCursor(db),
        new Date().toISOString(),
        subscription.name as string,
      ),
    );
  }

  /** Ends a closed connection's subscriptions; named cursors stay. */
  closed(session: number): void {
    for (const [id, subscription] of this.#all)
      if (subscription.session === session) this.#all.delete(id);
  }

  #owned(session: SubscriberSession, subscriptionId: string): Subscription {
    const subscription = this.#all.get(subscriptionId);
    if (!subscription || subscription.session !== session.id) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_SUBSCRIPTION_UNKNOWN", {
          message: `No subscription ${subscriptionId} exists on this connection.`,
        }),
      );
    }
    return subscription;
  }

  #pumpAll(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    // After the committing call returns: a commit inside a request is answered first.
    setImmediate(() => {
      this.#scheduled = false;
      for (const subscription of this.#all.values()) this.#pump(subscription);
    });
  }

  #pump(subscription: Subscription): void {
    const { ledger, log, notify, drained } = this.#options;
    // While the host's connection is full, the pump waits for it to drain (flow control).
    if (subscription.waiting) return;
    let bytes = 0;
    for (let page = 0; page < PAGES_PER_TURN && bytes < BYTES_PER_TURN; page++) {
      if (!this.#all.has(subscription.id)) return;
      let read: ReturnType<typeof readEvents>;
      try {
        // Through a compacted range, not past it: the summary arrives in cursor order among the
        // other artifacts' events, flagged `compacted`, and nothing between is skipped (DATA_MODEL §4).
        read = ledger.read((db) =>
          readEvents(db, {
            filter: subscription.filter,
            after: subscription.cursor,
            limit: PAGE,
            acceptCompacted: true,
          }),
        );
      } catch (error) {
        log.error("events.subscription_failed", { subscriptionId: subscription.id, error });
        this.#all.delete(subscription.id);
        return;
      }
      const next = Number(read.cursor);
      if (read.events.length > 0) {
        if (read.compacted) {
          log.warn("events.subscription_compacted", {
            subscriptionId: subscription.id,
            after: subscription.cursor,
          });
        }
        const sent = notify(subscription.session, EVENTS_NOTIFY, {
          subscriptionId: subscription.id,
          events: read.events,
          cursor: read.cursor,
          ...(read.compacted ? { compacted: read.compacted } : {}),
        });
        if (!sent) {
          this.#all.delete(subscription.id);
          return;
        }
        bytes += read.events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
      }
      subscription.cursor = next;
      const waiting = drained(subscription.session);
      if (waiting) {
        subscription.waiting = true;
        void waiting.then(() => {
          subscription.waiting = false;
          this.#pump(subscription);
        });
        return;
      }
      // A page cut short by size (READ_MAX_BYTES) ends before the newest cursor: read on.
      if (read.events.length < PAGE && next >= ledger.read((db) => latestCursor(db))) return;
    }
    setImmediate(() => this.#pump(subscription));
  }
}
