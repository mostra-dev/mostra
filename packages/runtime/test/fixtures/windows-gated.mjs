// Issue #7 on Windows: a supervisor killed between starting a child and recording it. The
// instance's spawn fault point kills this process right there
// (MOSTRA_TEST_FAULTS=spawn:before-record:crash); the child's command must never run.
import { startInstance } from "@mostra/runtime";

const [home, marker] = process.argv.slice(2);
const started = await startInstance({ mode: "daemon", home });
if (started.kind !== "owner") throw new Error("the fixture supervisor must own its home");
process.stdout.write("ready\n");
await started.instance.processes.spawn({
  kind: "demo",
  ownerRef: "art_gate",
  command: process.execPath,
  args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); setInterval(() => {}, 1 << 30)`],
});
process.stdout.write("spawned\n");
