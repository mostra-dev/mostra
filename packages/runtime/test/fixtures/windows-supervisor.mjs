// A real supervisor (the public `startInstance`) with a child that has grandchildren, for the
// Windows reaping checks (RT-10). Prints the PIDs as one JSON line, then idles until killed.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startInstance } from "@mostra/runtime";
import { parseJson, readWhole } from "../whole-file.ts";

const [home, scratch] = process.argv.slice(2);
const started = await startInstance({ mode: "daemon", home });
if (started.kind !== "owner") throw new Error("the fixture supervisor must own its home");
const { instance } = started;
const file = join(scratch, "family.json");
const demo = await instance.processes.spawn({
  kind: "demo",
  ownerRef: "art_demo",
  command: process.execPath,
  args: [fileURLToPath(new URL("./family.mjs", import.meta.url)), file],
});
// Waits for the whole record, not just the file (#160): a throw here prints what it last held.
const family = await readWhole(file, parseJson, 30_000, "the demo family's PIDs");
process.stdout.write(
  `${JSON.stringify({ supervisor: process.pid, socket: instance.socketPath, demo: demo.pid, family })}\n`,
);
setInterval(() => {}, 1 << 30);
