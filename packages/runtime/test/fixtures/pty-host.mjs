// A PTY host stand-in: like node-pty, it starts its program in a new session (so the program
// leads its own process group), then asks the supervisor to adopt it. `adopt` and `ask` let tests
// send the supervisor other requests through it.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connectToSupervisor } from "@mostra/runtime";

const supervisor = connectToSupervisor({
  onRequest: async (method, params) => {
    if (method === "start") {
      const program = spawn("/bin/sh", ["-c", "sleep 600 & wait"], { detached: true, stdio: "ignore" });
      await once(program, "spawn");
      program.unref();
      const { adopted } = await supervisor.request("child/adopt", { pid: program.pid });
      return { pid: program.pid, adopted };
    }
    if (method === "adopt") return supervisor.request("child/adopt", params);
    if (method === "ask") return supervisor.request("custom/hello", params);
    throw new Error(`unknown method ${method}`);
  },
});
setInterval(() => {}, 1 << 30);
