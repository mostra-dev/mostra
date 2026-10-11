// A real supervisor (the public `startInstance`) with the two kinds of children RT-09 names: a
// demo dev server with grandchildren in its process group, and a PTY host whose PTY program runs
// in its own session and is adopted. Prints their PIDs as one JSON line, then idles until killed.
import { fileURLToPath } from "node:url";
import { startInstance } from "@mostra/runtime";

const [home] = process.argv.slice(2);
const started = await startInstance({ mode: "daemon", home });
if (started.kind !== "owner") throw new Error("the fixture supervisor must own its home");
const { instance } = started;
const demo = await instance.processes.spawn({
  kind: "demo",
  ownerRef: "art_demo",
  command: "/bin/sh",
  args: ["-c", "sleep 600 & sleep 600 & wait"],
});
const ptyHost = await instance.processes.spawn({
  kind: "pty-host",
  ownerRef: "pty",
  command: process.execPath,
  args: [fileURLToPath(new URL("./pty-host.mjs", import.meta.url))],
  ipc: {},
});
const program = await ptyHost.request("start", {}, { timeoutMs: 10_000 });
process.stdout.write(`${JSON.stringify({ supervisor: process.pid, socket: instance.socketPath, demo: demo.pid, ptyHost: ptyHost.pid, program })}\n`);
setInterval(() => {}, 1 << 30);
