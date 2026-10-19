/**
 * The flusher process (D140 item 6): `node flush-main.js <config dir>`, started detached by the
 * CLI. It sends what the queue holds and exits; nothing it does reaches the command that started
 * it.
 */
import { flush } from "./flush.ts";
import { TelemetryStore } from "./store.ts";

const dir = process.argv[2];
if (dir !== undefined) {
  await flush(new TelemetryStore(dir), process.env, Date.now).catch(() => {});
}
process.exit(0);
