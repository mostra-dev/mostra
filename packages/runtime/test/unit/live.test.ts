/**
 * The live module's reaction to a worker that parks (RT-03, #42), with the pool and the page bus
 * replaced by fakes, so the order of a producer's start and the crash is the test's to choose.
 */
import type { WireError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { createLive, type LiveOptions } from "../../src/live/index.ts";
import type { WorkerCrash, WorkerHandle } from "../../src/workers/index.ts";

const ARTIFACT = "art_01JFAKE0000000000000000000";
const VERSION = "ver_FAKE0000000000000000000000";

/** A live module whose producer `counter` starts in a worker that the test crashes. */
function setup(): {
  live: ReturnType<typeof createLive>;
  published: { key: string; error?: WireError }[];
  liveStarted: Promise<void>;
  closeChannel: () => void;
} {
  const published: { key: string; error?: WireError }[] = [];
  let closeChannel = (): void => {};
  let markStarted = (): void => {};
  const liveStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const handle = {
    versionId: VERSION,
    artifactId: ARTIFACT,
    started: { live: [{ key: "counter" }] },
    // The start is under way and never answers: the worker crashes first, closing its channel.
    liveStart: () =>
      new Promise<void>((_, reject) => {
        markStarted();
        closeChannel = () => reject(new Error("the worker's channel closed"));
      }),
    liveStop: async () => {},
  } as unknown as WorkerHandle;
  const options = {
    ledger: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    bus: {
      liveInterest: () => [{ artifactId: ARTIFACT, key: "counter" }],
      publishLive: (_artifactId: string, message: { live: { key: string; error?: WireError } }) =>
        published.push(message.live),
    },
    pool: { acquire: async () => handle, release() {} },
    interaction: { subscribedArtifacts: () => new Set<string>() },
    latest: () => ({ versionId: VERSION, sources: [{ key: "counter", always: false }] }),
    artifactsWithLive: () => [ARTIFACT],
    version: () => ({ ref: { versionId: VERSION }, artifactId: ARTIFACT }),
    reconcileMs: 60_000,
  } as unknown as LiveOptions;
  const live = createLive(options);
  return { live, published, liveStarted, closeChannel: () => closeChannel() };
}

const park: WorkerCrash = {
  artifactId: ARTIFACT,
  versionId: VERSION,
  cause: "it exited with code 1",
  kind: "crash",
  backoffMs: 0,
  parked: true,
  callIds: [],
  // The pool hadn't registered the producer when the worker crashed: none was running.
  liveKeys: [],
};

describe("live sources of a parked worker (RT-03, #42)", () => {
  it("say the worker is parked, also when their producer was still starting", async () => {
    const { live, published, liveStarted, closeChannel } = setup();
    live.reconcile();
    await liveStarted;
    live.crashed(park);
    closeChannel();
    await new Promise((resolve) => setImmediate(resolve));
    expect(published.at(-1)).toMatchObject({
      key: "counter",
      error: { code: "MOSTRA_RUNTIME_WORKER_PARKED" },
    });
    // The cut-off start reports nothing over the park.
    expect(
      published.filter((entry) => entry.error?.code !== "MOSTRA_RUNTIME_WORKER_PARKED"),
    ).toEqual([]);
  });
});
