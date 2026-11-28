/**
 * A producer's burst of values (AC-08): stored together in a few transactions a turn after they
 * came, each under its own revision, in order, and published only once stored.
 */
import { serializeAll } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import type { Ledger } from "../../src/ledger/index.ts";
import { createLive, type LiveOptions } from "../../src/live/index.ts";
import type { WorkerHandle } from "../../src/workers/index.ts";
import { addArtifact, freshLedger } from "../interaction-support.ts";

describe("a producer's burst of values (AC-08)", () => {
  it("is stored in a few transactions, in order, each value before it is published", async () => {
    const { ledger } = freshLedger();
    const { artifactId, versions } = addArtifact(ledger, { id: "art_01JLIVEBATCH000000000000000" });
    const versionId = versions[0] as string;
    let writes = 0;
    const counted: Ledger = {
      ...ledger,
      write: ((fn: Parameters<Ledger["write"]>[0]) => {
        writes++;
        return ledger.write(fn);
      }) as Ledger["write"],
    } as Ledger;
    const published: { revision: number; stored: boolean }[] = [];
    let started = (): void => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const handle = {
      versionId,
      artifactId,
      started: { live: [{ key: "trace", ring: 5000 }] },
      liveStart: async () => started(),
      liveStop: async () => {},
    } as unknown as WorkerHandle;
    const live = createLive({
      ledger: counted,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      bus: {
        liveInterest: () => [{ artifactId, key: "trace" }],
        publishLive: (_artifact: string, message: { live: { revision?: string } }) => {
          const revision = Number(message.live.revision);
          const row = ledger.read((db) =>
            db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM live_ring WHERE artifact_id = ? AND key = ? AND revision = ?",
              artifactId,
              "trace",
              revision,
            ),
          );
          published.push({ revision, stored: (row?.n ?? 0) === 1 });
        },
      },
      pool: { acquire: async () => handle, release() {} },
      interaction: { subscribedArtifacts: () => new Set<string>() },
      latest: () => ({ versionId, sources: [{ key: "trace", always: false }] }),
      artifactsWithLive: () => [artifactId],
      version: () => ({ ref: { versionId }, artifactId }),
      reconcileMs: 60_000,
    } as unknown as LiveOptions);
    live.reconcile();
    await running;
    await new Promise((resolve) => setImmediate(resolve));
    const before = writes;
    const values = await Promise.all(
      Array.from({ length: 1200 }, (_, index) => serializeAll(index + 1, { mode: "argument" })),
    );
    // A burst of 1,200 values, all in one turn: one chunk of the worker's channel.
    for (const value of values) {
      live.produced({ artifactId, versionId } as WorkerHandle, { key: "trace", value });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published.map((entry) => entry.revision)).toEqual(
      Array.from({ length: 1200 }, (_, index) => index + 1),
    );
    expect(published.every((entry) => entry.stored)).toBe(true);
    // 1,200 values in transactions of at most 500: three, not 1,200.
    expect(writes - before).toBeLessThanOrEqual(3);
    live.stop();
  });
});
