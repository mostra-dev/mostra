/**
 * Metering's held bytes (MT-03; INTERFACES §18.6): `bytes.held` is a level at each window's end, not
 * a sum, reported for every home that held anything during the window, so it falls when content is
 * removed and says 0 once for a home that holds nothing any more; `bytes.stored` stays a sum.
 */
import type { MeterBatch, MeterCounter } from "@mostra/protocol/operator";
import { describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import { createMeter } from "../../src/server/metering.ts";
import type { Operator } from "../../src/server/operator.ts";
import { tempDir } from "../support.ts";

/** A meter over an operator that implements `metering`, collecting what it is handed. */
function meterOver(held: () => { home: string; account: string; bytes: number }[]) {
  const batches: MeterBatch[] = [];
  const operator = {
    has: { metering: true },
    enqueue: (item: { port: string; batch?: MeterBatch }) => {
      if (item.port === "metering" && item.batch) batches.push(item.batch);
    },
  } as unknown as Operator;
  let clock = 1_000_000;
  const meter = createMeter({
    operator,
    keysDir: tempDir("meter-keys"),
    log: silentLog,
    now: () => clock,
    windowMs: 3_600_000,
    heldBytes: held,
  });
  return {
    meter,
    /** Ends a window a second later: the counters it handed over. */
    window(): MeterCounter[] {
      clock += 1_000;
      const before = batches.length;
      meter.flush();
      return batches.slice(before).flatMap((batch) => [...batch.counters]);
    },
  };
}

const heldOf = (counters: MeterCounter[], home: string): number[] =>
  counters
    .filter((counter) => counter.name === "bytes.held" && counter.home === home)
    .map((counter) => counter.value);

describe("bytes.held (MT-03)", () => {
  it("reports each home's held bytes at every window's end, as a level", () => {
    let holding = [
      { home: "hom_a", account: "acct_a", bytes: 4_000 },
      { home: "hom_b", account: "acct_b", bytes: 10 },
    ];
    const { meter, window } = meterOver(() => holding);
    meter.add("bytes.stored", { account: "acct_a", home: "hom_a" }, 4_000);
    const first = window();
    expect(heldOf(first, "hom_a")).toEqual([4_000]);
    expect(heldOf(first, "hom_b")).toEqual([10]);
    expect(first.find((counter) => counter.name === "bytes.stored")?.value).toBe(4_000);
    // A window with nothing else to say still carries the level, unchanged.
    const second = window();
    expect(heldOf(second, "hom_a")).toEqual([4_000]);
    expect(second.some((counter) => counter.name === "bytes.stored")).toBe(false);
    // A removal frees some of one home's bytes: the level falls.
    holding = [
      { home: "hom_a", account: "acct_a", bytes: 1_500 },
      { home: "hom_b", account: "acct_b", bytes: 10 },
    ];
    expect(heldOf(window(), "hom_a")).toEqual([1_500]);
    meter.stop();
  });

  it("says 0 once for a home whose last bytes were removed, then nothing", () => {
    let holding = [{ home: "hom_a", account: "acct_a", bytes: 2_048 }];
    const { meter, window } = meterOver(() => holding);
    expect(heldOf(window(), "hom_a")).toEqual([2_048]);
    holding = [];
    const emptied = window();
    expect(heldOf(emptied, "hom_a")).toEqual([0]);
    expect(emptied.find((counter) => counter.home === "hom_a")?.account).toBe("acct_a");
    // Nothing held, nothing to say: no batch at all.
    expect(window()).toEqual([]);
    meter.stop();
  });
});
