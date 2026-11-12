/**
 * Metering's held bytes (MT-03; INTERFACES §18.6): `bytes.held` is a level, not a sum. Each home's
 * running total lives in the server's directory, kept by `home_file`'s triggers in the transaction
 * of every change, and is sent when it changed (0 once for a home that holds nothing any more),
 * and for every home holding anything at the first window after a start and once a day, so a
 * change made just before a stop still reaches the operator after the restart. A window's counters
 * go out in batches of at most `MAX_COUNTERS`. `bytes.stored` stays a sum.
 */
import type { MeterBatch, MeterCounter } from "@mostra/protocol/operator";
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { SERVER_MIGRATIONS } from "../../src/server/directory.ts";
import { createMeter, heldLevels, MAX_COUNTERS } from "../../src/server/metering.ts";
import type { Operator } from "../../src/server/operator.ts";
import { tempDir } from "../support.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const open: Ledger[] = [];

/** A server directory with the server's migrations, as `mostra-runtime server` opens it. */
function directory(): Ledger {
  const opening = openLedger({
    storeDir: tempDir("meter-directory"),
    fileName: "server.sqlite",
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    migrations: SERVER_MIGRATIONS,
    locking: "normal",
  });
  if (!opening.ok) throw new Error("locked");
  open.push(opening.ledger);
  return opening.ledger;
}

/** A home of its own account, as the directory records it. */
function addHome(dir: Ledger, home: string, account: string): void {
  dir.write((db) => {
    db.run(
      "INSERT INTO account (id, name, status, created_at) VALUES (?, NULL, 'active', ?)",
      account,
      new Date(0).toISOString(),
    );
    db.run(
      "INSERT INTO home (id, owner_account_id, data_path, created_at) VALUES (?, ?, ?, ?)",
      home,
      account,
      home,
      new Date(0).toISOString(),
    );
  });
}

const hold = (dir: Ledger, home: string, sha: string, size: number | null): void => {
  dir.write((db) =>
    db.run("INSERT INTO home_file (home_id, sha256, size) VALUES (?, ?, ?)", home, sha, size),
  );
};
const free = (dir: Ledger, home: string, sha: string): void => {
  dir.write((db) => db.run("DELETE FROM home_file WHERE home_id = ? AND sha256 = ?", home, sha));
};

/** A meter over the directory and an operator that implements `metering`, as after a start. */
function meterOver(dir: Ledger, start = 1_000_000) {
  const batches: MeterBatch[] = [];
  const operator = {
    has: { metering: true },
    enqueue: (item: { port: string; batch?: MeterBatch }) => {
      if (item.port === "metering" && item.batch) batches.push(item.batch);
    },
  } as unknown as Operator;
  let clock = start;
  const meter = createMeter({
    operator,
    keysDir: tempDir("meter-keys"),
    log: silentLog,
    now: () => clock,
    windowMs: 3_600_000,
    held: heldLevels(dir),
  });
  return {
    meter,
    batches,
    /** Ends a window `ms` later: the counters it handed over. */
    window(ms = 1_000): MeterCounter[] {
      clock += ms;
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

afterEach(() => {
  for (const ledger of open.splice(0)) ledger.close();
});

describe("bytes.held (MT-03)", () => {
  it("keeps each home's level in the directory's transaction, each file once, and reports it as it changes", () => {
    const dir = directory();
    addHome(dir, "hom_a", "acct_a");
    addHome(dir, "hom_b", "acct_b");
    hold(dir, "hom_a", "a1", 3_000);
    hold(dir, "hom_a", "a2", 1_000);
    hold(dir, "hom_b", "b1", 10);
    const { meter, window } = meterOver(dir);
    meter.add("bytes.stored", { account: "acct_a", home: "hom_a" }, 4_000);
    // The first window after a start sends every level.
    const first = window();
    expect(heldOf(first, "hom_a")).toEqual([4_000]);
    expect(heldOf(first, "hom_b")).toEqual([10]);
    expect(first.find((counter) => counter.name === "bytes.stored")?.value).toBe(4_000);
    // Nothing changed, nothing to say: no batch at all.
    expect(window()).toEqual([]);
    // A removal frees some of one home's bytes: that home's level falls, and only it is sent.
    free(dir, "hom_a", "a1");
    const fell = window();
    expect(heldOf(fell, "hom_a")).toEqual([1_000]);
    expect(heldOf(fell, "hom_b")).toEqual([]);
    // A size recorded later (a row from before sizes were kept) joins the level.
    hold(dir, "hom_b", "b2", null);
    expect(window()).toEqual([]);
    dir.write((db) => db.run("UPDATE home_file SET size = 90 WHERE sha256 = 'b2'"));
    expect(heldOf(window(), "hom_b")).toEqual([100]);
    meter.stop();
  });

  it("says 0 once for a home whose last bytes were removed, even across a restart", () => {
    const dir = directory();
    addHome(dir, "hom_a", "acct_a");
    hold(dir, "hom_a", "a1", 2_048);
    const before = meterOver(dir);
    expect(heldOf(before.window(), "hom_a")).toEqual([2_048]);
    // Emptied just before the server stops: the meter that saw it never runs another window.
    free(dir, "hom_a", "a1");
    before.meter.stop = () => undefined;
    // The restarted server's meter reports the 0, once, with the home's account, then nothing.
    const after = meterOver(dir);
    const emptied = after.window();
    expect(heldOf(emptied, "hom_a")).toEqual([0]);
    expect(emptied.find((counter) => counter.home === "hom_a")?.account).toBe("acct_a");
    expect(after.window()).toEqual([]);
    expect(after.window(DAY_MS)).toEqual([]);
    after.meter.stop();
  });

  it("sends every held level again once a day, and a window's counters in batches of at most MAX_COUNTERS", () => {
    const dir = directory();
    const homes = MAX_COUNTERS + 5;
    for (let index = 0; index < homes; index += 1) {
      addHome(dir, `hom_${index}`, `acct_${index}`);
      hold(dir, `hom_${index}`, `f${index}`, index + 1);
    }
    const { window, batches } = meterOver(dir);
    const first = window();
    expect(first.filter((counter) => counter.name === "bytes.held")).toHaveLength(homes);
    expect(batches.every((batch) => batch.counters.length <= MAX_COUNTERS)).toBe(true);
    expect(batches.length).toBe(2);
    expect(new Set(batches.map((batch) => batch.batchId)).size).toBe(2);
    // An hour on, nothing changed: nothing goes out.
    expect(window(3_600_000)).toEqual([]);
    // A day after the last snapshot every level goes out again, unchanged.
    expect(window(DAY_MS).filter((counter) => counter.name === "bytes.held")).toHaveLength(homes);
  });
});
