import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `events/unsubscribe`. */
export interface EventsUnsubscribeParams {
  /** The subscription, as `events/subscribe` returned it. */
  readonly subscriptionId: string;
}

/** The result of `events/unsubscribe`. */
export type EventsUnsubscribeResult = Record<string, never>;

const params: z.ZodType<EventsUnsubscribeParams> = z
  .object({ subscriptionId: z.string().min(1) })
  .register(wireRegistry, { id: "EventsUnsubscribeParams" });

const result: z.ZodType<EventsUnsubscribeResult> = z
  .object({})
  .register(wireRegistry, { id: "EventsUnsubscribeResult" });

/**
 * `events/unsubscribe`: ends a subscription on this connection. A named subscriber's acknowledged
 * cursor stays.
 */
export const eventsUnsubscribeMethod: MethodDefinition<
  EventsUnsubscribeParams,
  EventsUnsubscribeResult
> = defineMethod({
  method: "events/unsubscribe",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
