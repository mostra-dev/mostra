/**
 * A shim whose grandchild outlives it holding its output open, as a host's instance or daemon
 * might: the shim exits when its stdin ends, and the grandchild (which wrote its PID to
 * `MOSTRA_KIT_TEST_PID_FILE`) keeps the shell's stdout, so the shell's end is never seen as the
 * output closing. `close` must still end it (Opus review of WP-W3, finding 3).
 */
import { spawn } from "node:child_process";
import { serveHarness } from "@mostra/conformance";

const file = process.env["MOSTRA_KIT_TEST_PID_FILE"] as string;
spawn(
  process.execPath,
  [
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(file)}, String(process.pid)); setInterval(() => {}, 1000);`,
  ],
  {
    stdio: ["ignore", "inherit", "ignore"],
    windowsHide: true,
    // On Windows, Node.js puts every child it starts in libuv's kill-on-close job, which would end
    // this one with the shim; a host written in another language (the Rust reference host's
    // instance) starts children outside any such job. `detached` keeps it out, as they do. On
    // POSIX it stays in the shim's process group, as a host's children do.
    detached: process.platform === "win32",
  },
).unref();

await serveHarness({
  initialize: () => ({ host: { name: "lingering-shim", version: "0" }, ports: [], features: [] }),
  start: () => {
    throw new Error("lingering-shim starts no instance");
  },
  call: () => null,
  stop: () => undefined,
  store: () => ({ deliveries: [], drafts: [], activations: [], identity: [], policies: [], secrets: [] }),
});
