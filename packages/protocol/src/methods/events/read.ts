import * as z from "zod";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { Cursor } from "../../ids.ts";
import { EventFilter, EventRecord } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The most events one `events/read` returns. */
export const EVENTS_READ_MAX = 1000;

/** The params of `events/read` (INTERFACES §6). */
export interface EventsReadParams {
  /** Which events; absent: every event. */
  readonly filter?: EventFilter;
  /** Events after this cursor; absent: from the start. */
  readonly after?: string;
  /** At most this many events (default 100, at most 1000), and about 8 MiB. */
  readonly limit?: number;
  /**
   * When `after` lies inside a compacted range, read on through it instead of being refused with
   * `MOSTRA_HOST_CURSOR_COMPACTED`: the `artifact.compacted` summary arrives in cursor order among
   * the other events, and `compacted` says that events after `after` were lost (DATA_MODEL §4).
   */
  readonly acceptCompacted?: boolean;
}

/** The result of `events/read`. */
export interface EventsReadResult {
  /** Matching events in cursor order. */
  readonly events: readonly EventRecord[];
  /** Where the next read continues: everything up to it was examined. */
  readonly cursor: string;
  /**
   * `MOSTRA_HOST_CURSOR_COMPACTED`, when `acceptCompacted` let the read pass a summary of events
   * this reader had partly seen: some events after `after` are gone, and `events` holds the summary.
   */
  readonly compacted?: Diagnostic;
}

const params: z.ZodType<EventsReadParams> = z
  .object({
    filter: EventFilter.exactOptional(),
    after: Cursor.schema.exactOptional(),
    limit: z.int().min(1).max(EVENTS_READ_MAX).exactOptional(),
    acceptCompacted: z.boolean().exactOptional(),
  })
  .register(wireRegistry, { id: "EventsReadParams" });

const result: z.ZodType<EventsReadResult> = z
  .object({
    events: z.array(EventRecord).readonly(),
    cursor: Cursor.schema,
    compacted: Diagnostic.exactOptional(),
  })
  .register(wireRegistry, { id: "EventsReadResult" });

/**
 * `events/read`: reads durable events after a cursor, in order, without gaps (IN-08). Pass the
 * returned cursor to continue.
 */
export const eventsReadMethod: MethodDefinition<EventsReadParams, EventsReadResult> = defineMethod({
  method: "events/read",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
