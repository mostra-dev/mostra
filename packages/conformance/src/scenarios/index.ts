/**
 * Every scenario of the kit, in the order a run takes them. A scenario's ID is stable surface:
 * baselines name it. New scenarios join additively (WP-13 adds addressing, WP-20 reviews and
 * capture, WP-29 remote and WP-31 team scenarios).
 */
import type { Scenario } from "../scenario.ts";
import { DELIVERY_SCENARIOS } from "./delivery.ts";
import { INTERACTION_SCENARIOS } from "./interaction.ts";
import { PORT_SCENARIOS } from "./ports.ts";
import { SESSION_SCENARIOS } from "./session.ts";
import { VIEWING_SCENARIOS } from "./viewing.ts";

/** Every scenario. */
export const SCENARIOS: readonly Scenario[] = [
  ...SESSION_SCENARIOS,
  ...DELIVERY_SCENARIOS,
  ...INTERACTION_SCENARIOS,
  ...PORT_SCENARIOS,
  ...VIEWING_SCENARIOS,
];
