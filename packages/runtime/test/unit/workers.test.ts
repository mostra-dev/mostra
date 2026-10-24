/**
 * The worker pool against a fake launcher (RT-03): one worker per version, also while an idle
 * worker is still stopping. Real workers are `test/integration/lifecycle.test.ts`'s; this pins
 * the races a real process makes hard to time.
 */
import type { JsonRpcMessage } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import {
  createWorkerPool,
  type WorkerLauncher,
  type WorkerVersion,
} from "../../src/workers/index.ts";
import type { WorkerChannel, WorkerExit } from "../../src/workers/launcher.ts";
import { exitCodeText } from "../../src/workers/pool.ts";

/**
 * A launcher whose workers answer at once and take `stopMs` to exit when asked to stop; with
 * `dieOnStart`, each worker exits a moment after `worker/start` arrives, without answering it.
 */
function fakeLauncher(stopMs: number, options: { dieOnStart?: boolean } = {}) {
  const launched: { exited: boolean }[] = [];
  const launcher: WorkerLauncher = {
    async launch() {
      // A launch takes a moment, as a real one does.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const record = { exited: false };
      launched.push(record);
      let deliver: (message: unknown) => void = () => {};
      let end: (exit: WorkerExit) => void = () => {};
      const ended = new Promise<WorkerExit>((resolve) => {
        end = (exit) => {
          record.exited = true;
          resolve(exit);
        };
      });
      const answer = (id: unknown, result: unknown): void =>
        queueMicrotask(() => deliver({ jsonrpc: "2.0", id, result }));
      const channel: WorkerChannel = {
        send(message: JsonRpcMessage) {
          if (record.exited) return;
          const request = message as { id?: unknown; method?: string };
          if (request.method === "worker/start" && options.dieOnStart) {
            setTimeout(
              () => end({ code: 1, signal: null, stderrTail: ["Error: the bundle threw at load"] }),
              5,
            );
          } else if (request.method === "worker/start") {
            answer(request.id, { revision: "2026-10-16", functions: ["a.ts#f"], live: [] });
          } else if (request.method === "worker/ping") {
            answer(request.id, { blockedMs: 0, waitingForSecret: false, heapUsed: 0 });
          } else if (request.method === "worker/stop") {
            answer(request.id, {});
            setTimeout(() => end({ code: 0, signal: null, stderrTail: [] }), stopMs);
          }
        },
        onMessage(listener: (message: unknown) => void) {
          deliver = listener;
        },
        ended,
        kill() {
          end({ code: null, signal: "SIGKILL", stderrTail: [] });
        },
      };
      return channel;
    },
  };
  return { launcher, launched };
}

const version: WorkerVersion = {
  artifactId: "art_01J00000000000000000000000",
  ref: {
    versionId: "ver_00000000000000000000000000",
    outputDigest: "0".repeat(64),
    locator: "home:versions/ver_00000000000000000000000000",
  },
  entry: "server/entry.mjs",
  limits: { heapMb: 1024, watchdogMs: 10_000, idleMinutes: 10 },
  functions: new Set(["a.ts#f"]),
};

const quietBridge = {
  request: async () => ({}),
  log() {},
  liveValue() {},
};

describe("the worker pool (RT-03)", () => {
  it("waits for a stopping worker before its replacement starts (GPT review finding 4)", async () => {
    const { launcher, launched } = fakeLauncher(300);
    const pool = createWorkerPool({
      launcher,
      log: silentLog,
      env: {},
      bridge: {
        request: async () => ({}),
        log() {},
        liveValue() {},
      },
      onCrash() {},
      idleMsOverride: 50,
    });
    await pool.acquire(version);
    expect(launched).toHaveLength(1);
    // The idle stop begins and takes 300 ms; calls arrive meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const handles = await Promise.all([
      pool.acquire(version),
      pool.acquire(version),
      pool.acquire(version),
    ]);
    expect(launched).toHaveLength(2);
    expect(launched[0]?.exited).toBe(true);
    expect(new Set(handles).size).toBe(1);
    expect(pool.running(version.ref.versionId)).toBe(handles[0]);
    await pool.stopAll();
    expect(launched.every((worker) => worker.exited)).toBe(true);
  });

  it("counts a worker that dies during its start as one crash (Opus review 5)", async () => {
    const { launcher, launched } = fakeLauncher(0, { dieOnStart: true });
    const crashes: { backoffMs: number; parked: boolean; cause: string }[] = [];
    const pool = createWorkerPool({
      launcher,
      log: silentLog,
      env: {},
      bridge: quietBridge,
      onCrash: (crash) => crashes.push(crash),
      backoffMinMs: 1,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(pool.acquire(version)).rejects.toThrow(/couldn't start/);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(launched).toHaveLength(3);
    // One crash per failed start: backoff 1, 2, 4 ms, and no park after three.
    expect(crashes.map((crash) => crash.backoffMs)).toEqual([1, 2, 4]);
    expect(crashes.every((crash) => !crash.parked)).toBe(true);
    expect(crashes[0]?.cause).toMatch(/the bundle threw at load/);
    expect(pool.status()[0]).toMatchObject({ crashes: 3, state: "backoff" });
    await pool.stopAll();
  });

  it("stops a worker at once when released with nothing to run", async () => {
    const { launcher, launched } = fakeLauncher(0);
    const pool = createWorkerPool({
      launcher,
      log: silentLog,
      env: {},
      bridge: quietBridge,
      onCrash() {},
    });
    await pool.acquire(version);
    pool.release(version.ref.versionId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(launched[0]?.exited).toBe(true);
    expect(pool.running(version.ref.versionId)).toBeUndefined();
    await pool.stopAll();
  });
});

describe("a worker's exit code in its crash cause (WP-W2)", () => {
  it("names a Windows status in hexadecimal, as people look it up, and other codes as numbers", () => {
    expect(exitCodeText(1)).toBe("1");
    expect(exitCodeText(134)).toBe("134");
    expect(exitCodeText(null)).toBe("?");
    // An access violation, as Node.js reports it on Windows (unsigned), and signed.
    expect(exitCodeText(3221225477)).toBe("0xC0000005");
    expect(exitCodeText(-1073741819)).toBe("0xC0000005");
  });
});
