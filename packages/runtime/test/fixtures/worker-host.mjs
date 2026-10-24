#!/usr/bin/env node
/**
 * A worker host started on its own (D124): the second `WorkerLauncher` that proves the seam. It
 * listens on a Unix socket; each connection's first line is `{ "launch": spec }`, a version
 * reference with no directory path, which this host resolves against the home it was given (as a
 * remote host resolves a portable bundle), then it runs `@mostra/worker` for it and relays the
 * worker's JSON-RPC lines both ways. When the worker ends, it sends `{ "mostraWorkerExit": … }` and
 * closes; when the connection closes, it ends the worker.
 *
 *   node worker-host.mjs --socket <path> --home <home> --worker <@mostra/worker main.js>
 *     --warm <the warm set's node_modules>
 *
 * A version's packages resolve, as the local launcher's do (D135), from the layout of its
 * `lock.yaml`: the owner's layout in the home when the lockfile has on-demand packages (a remote
 * host would install it from the lockfile), else the warm set.
 *
 * Every launch is appended to `<socket>.launches` as a JSON line, so a test can tell which
 * launcher ran its workers.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    socket: { type: "string" },
    home: { type: "string" },
    worker: { type: "string" },
    warm: { type: "string" },
    launches: { type: "string" },
  },
});
const { socket: socketPath, home, worker, warm } = values;
/** Where launches are recorded: beside the socket, or where `--launches` says (a pipe has no directory). */
const launchesFile = values.launches ?? `${socketPath}.launches`;
const WINDOWS = process.platform === "win32";
/** Ends a worker and what it started: its process group on POSIX; on Windows, which has none, itself. */
const end = (child) => {
  try {
    if (WINDOWS) child.kill();
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};
if (!socketPath || !home || !worker || !warm) {
  process.stderr.write(
    "usage: worker-host.mjs --socket <path> --home <home> --worker <main.js> --warm <node_modules>\n",
  );
  process.exit(2);
}

/** Where a version's packages resolve from: its lockfile's layout, or the warm set. */
function modulesOf(versionDir) {
  const lock = readFileSync(join(versionDir, "lock.yaml"), "utf8");
  if (!/^packages:/m.test(lock)) return warm;
  const digest = createHash("sha256").update(lock).digest("hex");
  return join(home, "deps", "locks", digest, "node_modules");
}

if (!WINDOWS) rmSync(socketPath, { force: true });
const children = new Set();

const server = createServer((connection) => {
  let buffered = "";
  let child;
  const tail = [];
  const onFirst = (chunk) => {
    buffered += chunk.toString("utf8");
    const newline = buffered.indexOf("\n");
    if (newline === -1) return;
    connection.off("data", onFirst);
    const first = JSON.parse(buffered.slice(0, newline));
    const rest = buffered.slice(newline + 1);
    const spec = first.launch;
    const match = /^home:versions\/(ver_[0-9A-Z]{26})$/.exec(spec?.version?.locator ?? "");
    if (!match || match[1] !== spec.version.versionId) {
      connection.end(
        `${JSON.stringify({ mostraWorkerExit: { code: 2, signal: null, stderrTail: ["unknown locator"] } })}\n`,
      );
      return;
    }
    appendFileSync(launchesFile, `${JSON.stringify({ ...spec, pid: process.pid })}\n`);
    child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${spec.limits.heapMb}`,
        worker,
        "--channel",
        "fd:3",
        "--version-dir",
        join(home, "versions", match[1]),
        "--modules",
        modulesOf(join(home, "versions", match[1])),
      ],
      // The channel is overlapped on Windows, so both ends read and write at once.
      {
        env: spec.env,
        stdio: ["ignore", "ignore", "pipe", WINDOWS ? "overlapped" : "pipe"],
        detached: true,
        windowsHide: true,
      },
    );
    children.add(child);
    const channel = child.stdio[3];
    channel.on("error", () => {});
    if (rest) channel.write(rest);
    connection.pipe(channel);
    channel.on("data", (data) => {
      if (!connection.destroyed) connection.write(data);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      tail.push(...text.split("\n"));
      tail.splice(0, Math.max(0, tail.length - 50));
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (!connection.destroyed) {
        connection.end(
          `${JSON.stringify({ mostraWorkerExit: { code, signal, stderrTail: tail } })}\n`,
        );
      }
    });
  };
  connection.on("data", onFirst);
  connection.on("error", () => {});
  connection.on("close", () => {
    if (child && child.exitCode === null && child.signalCode === null) end(child);
  });
});

server.listen(socketPath, () => process.stdout.write(`${JSON.stringify({ listening: socketPath })}\n`));

const stop = () => {
  for (const child of children) end(child);
  server.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
