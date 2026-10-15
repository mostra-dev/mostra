import * as z from "zod";
import { Cursor } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `events/ack` (INTERFACES §6). */
export interface EventsAckParams {
  /** The subscription, as `events/subscribe` returned it. */
  readonly subscriptionId: string;
  /** Every event up to this cursor is handled. An earlier cursor than the last ack changes nothing. */
  readonly cursor: string;
  /** Accepted for uniformity (H-03); acknowledging is idempotent by itself. */
  readonly requestId?: string;
}

/** The result of `events/ack`. */
export type EventsAckResult = Record<string, never>;

const params: z.ZodType<EventsAckParams> = z
  .object({
    subscriptionId: z.string().min(1),
    cursor: Cursor.schema,
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "EventsAckParams" });

const result: z.ZodType<EventsAckResult> = z
  .object({})
  .register(wireRegistry, { id: "EventsAckResult" });

/**
 * `events/ack`: records that a subscriber handled every event up to a cursor. For a named
 * subscription it is durable: the next subscription with that name resumes after it (IN-08).
 */
export const eventsAckMethod: MethodDefinition<EventsAckParams, EventsAckResult> = defineMethod({
  method: "events/ack",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
