import { defineLive } from "@mostra/server";

let beats = 0;

/** Runs whether or not anyone views the artifact (D63). */
export const heartbeat = defineLive({ always: true, refresh: "1s", load: async () => ({ beats: ++beats }) });

/** Runs only while viewed or subscribed. */
export const onDemand = defineLive({ refresh: "1s", load: async () => ({ at: Date.now() }) });
