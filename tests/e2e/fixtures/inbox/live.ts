import { defineLive } from "@mostra/server";

/** The morning's mail. */
export const inbox = defineLive({
  load: async () => ({
    messages: [{ id: "m1", from: "Ada", subject: "Lunch on Thursday?", suggested: "Thursday works." }],
  }),
});

/** A tick every 100 ms, the last 50 kept for append mode. */
export const ticks = defineLive({
  ring: 50,
  stream: async function* (signal) {
    let tick = 0;
    while (!signal.aborted) {
      yield tick++;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },
});
