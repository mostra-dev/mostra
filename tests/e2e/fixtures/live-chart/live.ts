// AC-08 (WP-19): a trace of 10,000 points at once, then 60 points a second, one value per point.
import { defineLive } from "@mostra/server";

const RATE = 60;
const point = (n: number) => ({ t: n, v: Math.sin(n / 40) * 40 + 50 + (n % 7) });

export const trace = defineLive({
  ring: 10000,
  stream: async function* (signal: AbortSignal) {
    let n = 0;
    for (; n < 10000; n++) yield point(n);
    const start = performance.now();
    let sent = 0;
    while (!signal.aborted) {
      const due = Math.floor(((performance.now() - start) / 1000) * RATE);
      for (; sent < due; sent++, n++) yield point(n);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  },
});
