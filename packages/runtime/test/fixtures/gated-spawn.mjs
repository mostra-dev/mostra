// Issue #7: a supervisor killed between starting a child and recording it. The instance's spawn
// fault point SIGKILLs this process right there (MOSTRA_TEST_FAULTS=spawn:before-record:crash);
// the child's command must never run.
import { startInstance } from "@mostra/runtime";

const [home, marker] = process.argv.slice(2);
const started = await startInstance({ mode: "daemon", home });
if (started.kind !== "owner") throw new Error("the fixture supervisor must own its home");
process.stdout.write("ready\n");
await started.instance.processes.spawn({
  kind: "demo",
  ownerRef: "art_gate",
  command: "/bin/sh",
  args: ["-c", `echo ran > '${marker}'; exec sleep 600`],
});
process.stdout.write("spawned\n");
