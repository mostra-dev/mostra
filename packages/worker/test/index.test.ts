/**
 * The worker as a real process, over a real socket, against a fake supervisor: loading a version,
 * calls with streamed results, cancellation, synchronous secrets, the watchdog's ping, console
 * lines in the run log, and live producers (RT-03, AC-01, AC-04, D19 seam 3, D124).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDiagnostic,
  deserializeAll,
  encodeLine,
  type Frame,
  LineSplitter,
  RpcError,
  RpcPeer,
  serializeAll,
} from "@mostra/protocol";
import { workerEntry } from "@mostra/worker";
import { afterEach, describe, expect, it } from "vitest";

const SERVER_CODE = `
import { abortSignal, dryRun, emit, log, progress, secret, signal, state, viewer } from "@mostra/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
async function echo(...args) { return { args, viewer: viewer(), dryRun: dryRun() }; }
async function slow(ms) {
  progress({ fraction: 0.5, message: "halfway" });
  log("started");
  console.log("from console", { n: 1 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener("abort", () => { clearTimeout(timer); reject(abortSignal.reason); });
  });
  return "done";
}
async function useSecret() { return secret("MAIL_TOKEN").length; }
async function missing() { return secret("NOPE"); }
async function spin(ms) { const end = Date.now() + ms; while (Date.now() < end) {} return "spun"; }
async function* ticks(n) { for (let i = 0; i < n; i++) { yield i; await new Promise((r) => setTimeout(r, 5)); } }
async function fails() { throw new Error("mail API returned 500"); }
async function bad() { return new (class Nope {})(); }
async function capability() {
  return {
    file: readFileSync(new URL(import.meta.url), "utf8").length > 0,
    process: execFileSync("/bin/echo", ["hi"], { encoding: "utf8" }).trim(),
  };
}
async function raise() { signal("reply-sent", { id: 1 }); emit("host.mail.sent", { id: 1 }); return "ok"; }
async function writeState() { const r = await state.set("todo", ["x"]); return r.revision; }
export const functions = {
  "actions.ts#echo": echo, "actions.ts#slow": slow, "actions.ts#useSecret": useSecret,
  "actions.ts#missing": missing, "actions.ts#spin": spin, "actions.ts#ticks": ticks,
  "actions.ts#fails": fails, "actions.ts#bad": bad, "actions.ts#capability": capability,
  "actions.ts#raise": raise, "actions.ts#writeState": writeState,
};
import { defineLive } from "@mostra/server";
let count = 0;
export const live = {
  counter: defineLive({ load: async () => ++count, refresh: "1s" }),
  feed: defineLive({ stream: async function* (signal) { let i = 0; while (!signal.aborted) { yield { i: i++ }; await new Promise((r) => setTimeout(r, 20)); } } }),
  broken: defineLive({ load: async () => { throw new Error("source down"); } }),
};
`;

interface Harness {
  readonly peer: RpcPeer;
  readonly child: ChildProcess;
  readonly notifications: { method: string; params: Record<string, unknown> }[];
  readonly requests: { method: string; params: Record<string, unknown> }[];
  readonly versionDir: string;
  readonly socket: Socket;
  stderr: string;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function startWorker(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "mostra-worker-"));
  const versionDir = join(root, "version");
  mkdirSync(join(versionDir, "server"), { recursive: true });
  writeFileSync(join(versionDir, "server", "entry.mjs"), SERVER_CODE);
  const outputDigest = createHash("sha256").update("fixture").digest("hex");
  writeFileSync(join(versionDir, "manifest.json"), JSON.stringify({ outputDigest }));
  const socketPath = join(mkdtempSync("/tmp/mw-"), "s");
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const accepted = new Promise<Socket>((resolve) => server.once("connection", resolve));
  const child = spawn(
    process.execPath,
    [
      "--conditions=@mostra/source",
      workerEntry(),
      "--channel",
      `unix:${socketPath}`,
      "--version-dir",
      versionDir,
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const notifications: Harness["notifications"] = [];
  const requests: Harness["requests"] = [];
  const socket = await accepted;
  const splitter = new LineSplitter();
  const harness: Harness = {
    child,
    notifications,
    requests,
    versionDir,
    socket,
    stderr: "",
    peer: new RpcPeer({
      send: (message) => socket.write(encodeLine(message)),
      onNotification: (method, params) =>
        notifications.push({ method, params: params as Record<string, unknown> }),
      onRequest: (method, params) => {
        requests.push({ method, params: params as Record<string, unknown> });
        if (method === "server/secret") {
          const name = (params as { name: string }).name;
          if (name === "MAIL_TOKEN") return { value: "s3cr3t-token-value" };
          throw new RpcError(
            createDiagnostic("MOSTRA_SECRET_MISSING", { message: `No secret ${name}.` }),
          );
        }
        if (method === "server/state.patch")
          return { revision: "7", applied: ["todo"], conflicts: [] };
        return { cursor: "1" };
      },
    }),
  };
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    harness.stderr += chunk;
  });
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    for (const line of splitter.push(chunk)) harness.peer.receiveLine(line);
  });
  cleanups.push(() => {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {}
    socket.destroy();
    server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const started = await harness.peer.request(
    "worker/start",
    {
      artifactId: "art_01JB0000000000000000000000",
      version: { versionId: "ver_X", outputDigest, locator: "home:versions/ver_X" },
      entry: "server/entry.mjs",
      limits: { heapMb: 256, watchdogMs: 10000, idleMinutes: 10 },
    },
    { timeoutMs: 15_000 },
  );
  expect(started).toMatchObject({
    revision: "2026-10-16",
    functions: expect.arrayContaining(["actions.ts#echo", "actions.ts#slow"]),
  });
  return harness;
}

let nextCall = 1;

async function call(
  harness: Harness,
  fnId: string,
  args: unknown[],
  context: Record<string, unknown> = {},
): Promise<{ outcome: Record<string, unknown>; value: unknown; callId: string }> {
  const callId = `c${nextCall++}`;
  const outcome = (await harness.peer.request(
    "worker/call",
    {
      callId,
      fnId,
      args: await serializeAll(args, { mode: "argument" }),
      context: { kind: "run", runId: `run_${callId}`, dryRun: false, ...context },
    },
    { timeoutMs: 15_000 },
  )) as Record<string, unknown>;
  const batches = harness.notifications
    .filter((entry) => entry.method === "worker/batch" && entry.params["callId"] === callId)
    .map((entry) => entry.params["batch"] as Frame[]);
  const value = batches.length > 0 ? await deserializeAll(batches) : undefined;
  return { outcome, value, callId };
}

describe("the worker process", () => {
  it("runs a call with its arguments and context, and a streamed result", async () => {
    const harness = await startWorker();
    const echoed = await call(harness, "actions.ts#echo", [new Date(0), new Map([["a", 1n]])], {
      viewer: { id: "vwr_1", name: "Ada" },
      dryRun: true,
    });
    expect(echoed.outcome).toEqual({ status: "succeeded" });
    expect(echoed.value).toEqual({
      args: [new Date(0), new Map([["a", 1n]])],
      viewer: { id: "vwr_1", name: "Ada" },
      dryRun: true,
    });
    const ticks = await call(harness, "actions.ts#ticks", [3]);
    expect(ticks.outcome).toEqual({ status: "succeeded" });
    const items: unknown[] = [];
    for await (const item of ticks.value as AsyncIterable<unknown>) items.push(item);
    expect(items).toEqual([0, 1, 2]);
  });

  it("runs server code with full capability: files and processes (AC-01)", async () => {
    const harness = await startWorker();
    const result = await call(harness, "actions.ts#capability", []);
    expect(result.value).toEqual({ file: true, process: "hi" });
  });

  it("reports throws, unserializable results and unknown functions", async () => {
    const harness = await startWorker();
    expect((await call(harness, "actions.ts#fails", [])).outcome).toMatchObject({
      status: "failed",
      error: { code: "MOSTRA_ACTION_THREW", message: "mail API returned 500" },
    });
    expect((await call(harness, "actions.ts#bad", [])).outcome).toMatchObject({
      status: "failed",
      error: { code: "MOSTRA_ACTION_UNSERIALIZABLE" },
    });
    expect((await call(harness, "actions.ts#none", [])).outcome).toMatchObject({
      status: "failed",
      error: { code: "MOSTRA_ACTION_UNKNOWN_FUNCTION" },
    });
  });

  it("aborts a call's abortSignal on cancel (AC-04), with progress and log lines on the way", async () => {
    const harness = await startWorker();
    const running = call(harness, "actions.ts#slow", [10_000]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const callId = `c${nextCall - 1}`;
    harness.peer.notify("worker/cancel", { callId });
    const { outcome } = await running;
    expect(outcome).toEqual({ status: "cancelled" });
    const mine = harness.notifications.filter((entry) => entry.params["callId"] === callId);
    expect(mine.map((entry) => entry.method)).toEqual(
      expect.arrayContaining(["server/progress", "server/log"]),
    );
    expect(mine.find((entry) => entry.method === "server/progress")?.params).toMatchObject({
      fraction: 0.5,
      message: "halfway",
    });
    const lines = mine
      .filter((entry) => entry.method === "server/log")
      .map((e) => e.params["line"]);
    expect(lines).toEqual(["started", 'from console {"n":1}']);
  });

  it("reads secrets synchronously over the channel, and reports a missing one", async () => {
    const harness = await startWorker();
    expect((await call(harness, "actions.ts#useSecret", [])).value).toBe(
      "s3cr3t-token-value".length,
    );
    expect((await call(harness, "actions.ts#missing", [])).outcome).toMatchObject({
      status: "failed",
      error: { code: "MOSTRA_SECRET_MISSING" },
    });
    // The value came only as an answer to the worker's own request: never in its environment.
    expect(harness.requests.filter((r) => r.method === "server/secret")).toHaveLength(2);
  });

  it("answers the watchdog's ping with how long the event loop has been blocked", async () => {
    const harness = await startWorker();
    const idle = (await harness.peer.request("worker/ping", {})) as { blockedMs: number };
    expect(idle.blockedMs).toBeLessThan(1000);
    const spinning = call(harness, "actions.ts#spin", [1500]);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const busy = (await harness.peer.request("worker/ping", {}, { timeoutMs: 1000 })) as {
      blockedMs: number;
      heapUsed: number;
    };
    expect(busy.blockedMs).toBeGreaterThan(500);
    expect(busy.heapUsed).toBeGreaterThan(0);
    expect((await spinning).value).toBe("spun");
  });

  it("raises signals and host events, and writes state, before the call ends", async () => {
    const harness = await startWorker();
    const raised = await call(harness, "actions.ts#raise", []);
    expect(raised.value).toBe("ok");
    expect(harness.requests.map((r) => r.method)).toEqual(["server/signal", "server/emit"]);
    expect(harness.requests[0]?.params).toEqual({
      callId: raised.callId,
      name: "reply-sent",
      payload: { id: 1 },
    });
    expect((await call(harness, "actions.ts#writeState", [])).value).toBe("7");
  });

  it("runs live producers: load and refresh, a stream, and a failing load", async () => {
    const harness = await startWorker();
    await harness.peer.request("worker/live.start", { key: "counter" });
    await harness.peer.request("worker/live.start", { key: "feed" });
    await harness.peer.request("worker/live.start", { key: "broken" });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await harness.peer.request("worker/live.stop", { key: "feed" });
    const values = (key: string) =>
      harness.notifications.filter(
        (entry) => entry.method === "server/live.value" && entry.params["key"] === key,
      );
    const counter = await Promise.all(
      values("counter").map((entry) => deserializeAll(entry.params["value"] as Frame[][])),
    );
    expect(counter.slice(0, 2)).toEqual([1, 2]);
    expect(values("feed").length).toBeGreaterThan(5);
    const stopped = values("feed").length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(values("feed").length).toBe(stopped);
    expect(values("broken")[0]?.params["error"]).toEqual({
      message: "source down",
      code: "MOSTRA_LIVE_SOURCE_FAILED",
    });
  });

  it("exits when its channel closes", async () => {
    const harness = await startWorker();
    const exited = new Promise((resolve) => harness.child.once("exit", resolve));
    harness.socket.destroy();
    await expect(exited).resolves.toBeDefined();
  });
});
