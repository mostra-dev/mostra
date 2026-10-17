/**
 * The ephemeral bus coalesces what a slow reader hasn't taken yet (D130, FAILURE_MODEL §6; Opus
 * review 12): a live source in latest mode keeps only its newest value, append mode keeps every
 * value for its ring, and a run's contiguous deltas merge without losing a line or a batch.
 */
import type { EphemeralMessage, RunDelta } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { createEphemeralBus } from "../../src/interaction/ephemeral.ts";

const ART = "art_01J00000000000000000000000";
const VIEW = "vw_01J00000000000000000000000";

const value = (n: number): EphemeralMessage => ({
  kind: "live",
  live: { key: "ticks", revision: String(n), value: [[{ c: 0, v: n }]] },
});

const delta = (from: number, lines: string[], status: RunDelta["status"] = "running") => ({
  kind: "run" as const,
  run: { runId: "run_1", status, logFrom: from, log: lines, batchFrom: 0, batches: [] },
});

describe("coalescing for slow readers (Opus review 12)", () => {
  it("keeps only the newest value of a source in latest mode", () => {
    const bus = createEphemeralBus();
    bus.watchLive(ART, VIEW, [{ key: "ticks" }]);
    bus.drain(ART, VIEW); // starts the view's queue, as a poll does
    for (let n = 1; n <= 500; n++) bus.publishLive(ART, value(n) as never);
    expect(bus.drain(ART, VIEW)).toEqual([value(500)]);
    bus.close();
  });

  it("keeps every value in append mode, for the ring", () => {
    const bus = createEphemeralBus();
    bus.watchLive(ART, VIEW, [{ key: "ticks", window: 100 }]);
    bus.drain(ART, VIEW);
    for (let n = 1; n <= 50; n++) bus.publishLive(ART, value(n) as never);
    expect(bus.drain(ART, VIEW)).toHaveLength(50);
    bus.close();
  });

  it("merges a run's contiguous deltas, and keeps a gap a gap", () => {
    const bus = createEphemeralBus();
    bus.attachRuns(ART, VIEW, ["run_1"]);
    bus.drain(ART, VIEW);
    bus.publishRun(ART, delta(0, ["a"]));
    bus.publishRun(ART, delta(1, ["b", "c"]));
    bus.publishRun(ART, delta(3, ["d"], "succeeded"));
    expect(bus.drain(ART, VIEW)).toEqual([delta(0, ["a", "b", "c", "d"], "succeeded")]);
    bus.publishRun(ART, delta(4, ["e"]));
    bus.publishRun(ART, delta(9, ["f"]));
    expect(bus.drain(ART, VIEW)).toHaveLength(2);
    bus.close();
  });

  it("coalesces an open stream's held messages the same way", () => {
    const bus = createEphemeralBus();
    bus.watchLive(ART, VIEW, [{ key: "ticks" }]);
    const held: EphemeralMessage[] = [];
    bus.listen(ART, VIEW, (message) => bus.coalesce(ART, VIEW, held, message));
    for (let n = 1; n <= 100; n++) bus.publishLive(ART, value(n) as never);
    expect(held).toEqual([value(100)]);
    bus.close();
  });
});
