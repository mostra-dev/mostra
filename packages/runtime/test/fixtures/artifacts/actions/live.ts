import { defineLive } from "@mostra/server";

let loads = 0;

/** Loads on start and every second. */
export const counter = defineLive({ refresh: "1s", load: async () => ({ loads: ++loads }) });

/** Streams a tick every 50 ms, keeping the last 20 for append mode. */
export const ticks = defineLive({
  ring: 20,
  stream: async function* (signal) {
    let i = 0;
    while (!signal.aborted) {
      yield { i: i++, at: Date.now() };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },
});

/** Reads a file in the artifact's source, again whenever it changes. */
export const watched = defineLive({
  watch: "data/*.json",
  load: async () => {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile("data/value.json", "utf8"));
  },
});
