import * as z from "zod";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { Cursor } from "../../ids.ts";
import { EventFilter, EventRecord } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The notification that carries a subscription's events. */
export const EVENTS_NOTIFY = "events/notify";

/** The params of `events/subscribe` (INTERFACES §6). */
export interface EventsSubscribeParams {
  /** Which events; absent: every event. */
  readonly filter?: EventFilter;
  /**
   * Deliver events after this cursor. Absent: after the named subscriber's acknowledged cursor
   * (from the start for a new name), or from now on without a name.
   */
  readonly after?: string;
  /**
   * A durable subscriber name: `events/ack` keeps its cursor across connections and restarts,
   * and a later subscription with the same name resumes there.
   */
  readonly name?: string;
}

/** The result of `events/subscribe`. */
export interface EventsSubscribeResult {
  /** The subscription's ID on this connection, for `events/ack` and `events/unsubscribe`. */
  readonly subscriptionId: string;
  /** Where delivery starts: events after this cursor follow as `events/notify`. */
  readonly cursor: string;
}

/** The params of the `events/notify` notification. */
export interface EventsNotifyParams {
  /** The subscription the events belong to. */
  readonly subscriptionId: string;
  /** The next matching events, in cursor order. */
  readonly events: readonly EventRecord[];
  /** Everything up to this cursor was examined; acknowledge it once the events are handled. */
  readonly cursor: string;
  /**
   * Set when compaction removed events after this subscription's cursor (DATA_MODEL §4):
   * `MOSTRA_HOST_CURSOR_COMPACTED`, never a silent gap. `events` then holds the `artifact.compacted`
   * summary, and the subscription continues after it.
   */
  readonly compacted?: Diagnostic;
}

const params: z.ZodType<EventsSubscribeParams> = z
  .object({
    filter: EventFilter.exactOptional(),
    after: Cursor.schema.exactOptional(),
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/)
      .exactOptional(),
  })
  .register(wireRegistry, { id: "EventsSubscribeParams" });

const result: z.ZodType<EventsSubscribeResult> = z
  .object({ subscriptionId: z.string().min(1), cursor: Cursor.schema })
  .register(wireRegistry, { id: "EventsSubscribeResult" });

/** The Zod schema of the `events/notify` notification's params. */
export const EventsNotifyParams: z.ZodType<EventsNotifyParams> = z
  .object({
    subscriptionId: z.string().min(1),
    events: z.array(EventRecord).readonly(),
    cursor: Cursor.schema,
    compacted: Diagnostic.exactOptional(),
  })
  .register(wireRegistry, {
    id: "EventsNotifyParams",
    description: "A subscription's next events, in cursor order, and the cursor examined up to.",
  });

/**
 * `events/subscribe`: delivers matching events to this connection as `events/notify`
 * notifications, in cursor order and without gaps (IN-08, H-09). The client must accept
 * `events/notify` in `mostra/initialize`.
 */
export const eventsSubscribeMethod: MethodDefinition<EventsSubscribeParams, EventsSubscribeResult> =
  defineMethod({
    method: "events/subscribe",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
