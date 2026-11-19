/**
 * Metering's held bytes (MT-03; INTERFACES §18.6): `bytes.held` is a level, not a sum. Each home's
 * running total lives in the server's directory, kept by `home_file`'s triggers in the transaction
 * of every change, and is sent when it changed (0 once for a home that holds nothing any more),
 * and for every home holding anything at the first window after a start and once a day, so a
 * change made just before a stop still reaches the operator after the restart. A window's counters
 * go out in batches of at most `MAX_COUNTERS`. `bytes.stored` stays a sum.
 */
import type { MeterBatch, MeterCounter } from "@mostra/protocol/operator";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    // One transaction for all of them: two thousand commits with synchronous=FULL take longer than
    // the test's time on a slow disk (Windows arm64's runners), and the triggers run per row either way.
    const at = new Date(0).toISOString();
    dir.write((db) => {
      for (let index = 0; index < homes; index += 1) {
        db.run(
          "INSERT INTO account (id, name, status, created_at) VALUES (?, NULL, 'active', ?)",
          `acct_${index}`,
          at,
        );
        db.run(
          "INSERT INTO home (id, owner_account_id, data_path, created_at) VALUES (?, ?, ?, ?)",
          `hom_${index}`,
          `acct_${index}`,
          `hom_${index}`,
          at,
        );
        db.run(
          "INSERT INTO home_file (home_id, sha256, size) VALUES (?, ?, ?)",
          `hom_${index}`,
          `f${index}`,
          index + 1,
        );
      }
    });
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

describe("the metering window (MT-06, #203)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A meter on the real clock (faked), whose operator implements `metering`, with one open home. */
  function meterAt(start: number, windowMs: number) {
    vi.useFakeTimers({ now: start, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const batches: MeterBatch[] = [];
    const operator = {
      has: { metering: true },
      enqueue: (item: { port: string; batch?: MeterBatch }) => {
        if (item.port === "metering" && item.batch) batches.push(item.batch);
      },
    } as unknown as Operator;
    const meter = createMeter({
      operator,
      keysDir: tempDir("meter-keys"),
      log: silentLog,
      windowMs,
      activeHomes: () => [{ home: "hom_a", account: "acct_a" }],
    });
    return { meter, batches };
  }

  const HOUR = 3_600_000;
  /** 10:00:12.400 on a day, as a server starts at any moment. */
  const START = Date.UTC(2026, 10, 18, 10, 0, 12, 400);
  const sumOf = (batches: MeterBatch[], name: string): number =>
    batches
      .flatMap((batch) => batch.counters)
      .filter((counter) => counter.name === name)
      .reduce((total, counter) => total + counter.value, 0);

  it("starts every window on a multiple of its length, so none straddles an hour", async () => {
    const windowMs = 600_000;
    const { meter, batches } = meterAt(START, windowMs);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    meter.stop();
    expect(batches.length).toBeGreaterThan(10);
    // The first window is the part of its aligned window the server ran; every later one is whole.
    expect(batches[0]?.from).toBe(new Date(START).toISOString());
    expect(batches[0]?.to).toBe(new Date(Date.UTC(2026, 10, 18, 10, 10)).toISOString());
    for (const batch of batches.slice(1, -1)) {
      const from = Date.parse(batch.from);
      const to = Date.parse(batch.to);
      expect(from % windowMs, batch.from).toBe(0);
      expect(to - from).toBe(windowMs);
    }
    for (const batch of batches) {
      const from = Date.parse(batch.from);
      const to = Date.parse(batch.to);
      expect(Math.floor(from / HOUR), batch.from).toBe(Math.floor((to - 1) / HOUR));
    }
  });

  it("closes a window whose boundary passed at its boundary when it stops, and counts no sleep", () => {
    const windowMs = 60_000;
    const { meter, batches } = meterAt(START, windowMs);
    // The process sleeps two hours, its timer never firing, then stops at once (MT-06's review, 5).
    vi.setSystemTime(START + 2 * HOUR);
    meter.stop();
    const firstBoundary = Date.UTC(2026, 10, 18, 10, 1);
    expect(batches[0]?.from).toBe(new Date(START).toISOString());
    expect(batches[0]?.to).toBe(new Date(firstBoundary).toISOString());
    for (const batch of batches) {
      const from = Date.parse(batch.from);
      const to = Date.parse(batch.to);
      expect(Math.floor(from / HOUR), batch.from).toBe(Math.floor((to - 1) / HOUR));
      expect(to - from, batch.from).toBeLessThanOrEqual(windowMs);
    }
    // The sleep says nothing: 47.6 s before the first boundary, and the 12.4 s into the window the
    // process woke in.
    expect(sumOf(batches, "home.activeSeconds")).toBe(60);
  });

  it("writes once per window and sums the same as one-minute windows", async () => {
    const run = async (windowMs: number) => {
      const { meter, batches } = meterAt(START, windowMs);
      // A view every 7 s and a request every 3 s, for an hour and a bit.
      for (let at = 0; at < HOUR + 123_000; at += 1_000) {
        if (at % 7_000 === 0) meter.add("views", { account: "acct_a", home: "hom_a" });
        if (at % 3_000 === 0) meter.add("requests", { account: "acct_a", home: "hom_a" }, 2);
        await vi.advanceTimersByTimeAsync(1_000);
      }
      meter.stop();
      vi.useRealTimers();
      return batches;
    };
    const minute = await run(60_000);
    const tenMinutes = await run(600_000);
    // One batch a window, from 10:00:12.4 to 11:02:15.4: the partial first window to 10:01, 61
    // whole minutes and the partial last one; or to 10:10, five whole ten-minute windows and the
    // partial last one from 11:00.
    expect(minute.length).toBe(63);
    expect(tenMinutes.length).toBe(7);
    for (const name of ["views", "requests", "home.activeSeconds"]) {
      expect(sumOf(tenMinutes, name), name).toBe(sumOf(minute, name));
    }
    expect(sumOf(minute, "home.activeSeconds")).toBe((HOUR + 123_000) / 1000);
  });

  it("says nothing for windows the process missed whole, and starts again on a boundary", async () => {
    const windowMs = 300_000;
    const { meter, batches } = meterAt(START, windowMs);
    meter.add("views", { account: "acct_a", home: "hom_a" });
    // The machine sleeps for three hours: no timer runs, and the clock jumps.
    vi.setSystemTime(START + 3 * HOUR + 42_000);
    await vi.advanceTimersByTimeAsync(1);
    meter.add("views", { account: "acct_a", home: "hom_a" });
    await vi.advanceTimersByTimeAsync(windowMs);
    meter.stop();
    // The window that was due is closed at its own boundary with what it counted; the next starts
    // on the boundary the process woke in.
    expect(batches[0]?.to).toBe(new Date(Date.UTC(2026, 10, 18, 10, 5)).toISOString());
    expect(sumOf(batches.slice(0, 1), "views")).toBe(1);
    expect(Date.parse(batches[1]?.from ?? "") % windowMs).toBe(0);
    expect(Date.parse(batches[1]?.from ?? "")).toBe(Date.UTC(2026, 10, 18, 13, 0));
    for (const batch of batches) {
      expect(Date.parse(batch.to) - Date.parse(batch.from)).toBeLessThanOrEqual(windowMs);
    }
    expect(sumOf(batches, "views")).toBe(2);
  });
});
