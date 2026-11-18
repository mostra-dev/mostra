/**
 * Metering for an operator (INTERFACES §18.6, D165 item 9): counters kept in memory for a window,
 * then handed to the operator's `metering.record` as one batch with a stable `batchId`, through
 * the durable outbound queue, so a batch is delivered at least once across restarts. With no
 * metering port nothing is counted. Besides the sums, windows carry one level, `bytes.held`: what
 * a home holds now, sent when it changes (and 0 once when it holds nothing any more), and for every
 * home that holds anything at the first window after a start and once a day after (MT-03). A
 * window's counters go out in batches of at most {@link MAX_COUNTERS}.
 *
 * Windows are the operator's choice (`metering.windowSeconds`, 60 by default, a length that divides
 * an hour, MT-06) and start on multiples of their length since the epoch, so no window straddles an
 * hour and an operator's hourly rollups stay exact. The window a start begins in, and the one a stop
 * ends in, are the part of their aligned window the server ran; a window the process missed whole
 * (its machine asleep, its timers held) reports nothing, and the next one starts on its boundary.
 *
 * Views carry `viewerKey`, a monthly pseudonymous key: an HMAC of the viewer's subject under a key
 * the server makes for each month (`<data>/keys/metering-<YYYY-MM>`), so an operator can count
 * monthly viewers without learning who they are or matching them across months. The subject is
 * the account for a signed-in viewer, the viewer for a link minted with one, and the route's
 * anonymous key for anyone else (D167): no route ever learns another's key.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeterCounter, MeterName } from "@mostra/protocol/operator";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { Operator } from "./operator.ts";

/** How long one batch's window lasts unless the operator chooses (`metering.windowSeconds`). */
export const DEFAULT_WINDOW_SECONDS: number = 60;
/** How often every home that holds anything reports its level again, changed or not. */
const SNAPSHOT_MS = 24 * 60 * 60 * 1000;
/** The most counters one batch carries; a window with more sends several batches. */
export const MAX_COUNTERS = 1000;

/** One home's held level (`bytes.held`, MT-03). */
export interface HeldLevel {
  readonly home: string;
  readonly account: string;
  readonly bytes: number;
}

/** What one counter is counted under, besides its name. */
export interface MeterScope {
  readonly account: string;
  readonly home?: string | undefined;
  readonly artifactId?: string | undefined;
  readonly routeId?: string | undefined;
  readonly dimensions?: Readonly<Record<string, string>> | undefined;
}

/** The server's meter. */
export interface Meter {
  /** Whether anything is counted (an operator implements `metering`). */
  readonly on: boolean;
  /** Adds `value` to a counter. */
  add(name: MeterName, scope: MeterScope, value?: number): void;
  /** The month's pseudonymous key of a viewer's subject, for `views`. */
  viewerKey(subject: string): string;
  /** Hands the window's counters to the outbound queue now. */
  flush(): void;
  stop(): void;
}

/** Options for {@link createMeter}. */
export interface MeterOptions {
  readonly operator: Operator;
  /** `<data>/keys`, where the monthly keys live (mode 0700). */
  readonly keysDir: string;
  readonly log: Log;
  readonly now?: () => number;
  /**
   * The window's length: `metering.windowSeconds` (a length that divides an hour), or a test's
   * shorter one; windows start on its multiples since the epoch.
   */
  readonly windowMs?: number;
  /** Seconds each open home was active, added at every window. */
  readonly activeHomes?: () => readonly { readonly home: string; readonly account: string }[];
  /**
   * The homes' held levels for `bytes.held` (MT-03), kept durably by the caller so a change made
   * just before a stop, or while nothing was reported, is still sent after a restart.
   */
  readonly held?: {
    /**
     * The levels to report: each home whose level changed since it was last reported, or with
     * `full`, also every home that holds anything (or last reported more than nothing).
     */
    pending(full: boolean): readonly HeldLevel[];
    /** The levels were queued: each is reported unless its home's level changed meanwhile. */
    reported(levels: readonly HeldLevel[]): void;
  };
  /** How often every held level is sent again; a day unless a test shortens it. */
  readonly snapshotMs?: number;
}

/** Creates the meter. */
export function createMeter(options: MeterOptions): Meter {
  const on = options.operator.has.metering;
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_SECONDS * 1000;
  /** The boundary on or before `at`: a multiple of the window's length since the epoch. */
  const boundary = (at: number): number => Math.floor(at / windowMs) * windowMs;
  const counters = new Map<string, { counter: MeterCounter; value: number }>();
  let from = now();
  /** The part of a second a window's active seconds left over, for the next window. */
  let carriedMs = 0;
  const monthKeys = new Map<string, Buffer>();
  const snapshotMs = options.snapshotMs ?? SNAPSHOT_MS;
  /** When every level was last sent; never, so the first window after a start sends them all. */
  let snapshotAt = Number.NEGATIVE_INFINITY;

  const monthKey = (): Buffer => {
    const month = new Date(now()).toISOString().slice(0, 7);
    let key = monthKeys.get(month);
    if (key) return key;
    const file = join(options.keysDir, `metering-${month}`);
    try {
      key = readFileSync(file);
    } catch {
      key = randomBytes(32);
      try {
        writeFileSync(file, key, { mode: 0o600, flag: "wx" });
      } catch {
        // Another process wrote it first: its key is the month's.
        key = readFileSync(file);
      }
    }
    monthKeys.clear();
    monthKeys.set(month, key);
    return key;
  };

  /** Hands the counters to the outbound queue, for the window that ends at `to`. */
  const close = (to: number): void => {
    if (!on) return;
    // Whole seconds, the rest carried to the next window, so the seconds of a span sum the same
    // whatever the window's length (#203).
    const elapsed = Math.max(0, to - from) + carriedMs;
    const seconds = Math.floor(elapsed / 1000);
    carriedMs = elapsed - seconds * 1000;
    if (seconds > 0) {
      for (const active of options.activeHomes?.() ?? []) {
        count("home.activeSeconds", { account: active.account, home: active.home }, seconds);
      }
    }
    // `bytes.held` is a level, not a sum: a home whose level changed reports it, and every home
    // that holds anything reports it again at the first window after a start and once a day.
    const full = to - snapshotAt >= snapshotMs;
    const levels = options.held?.pending(full) ?? [];
    if (full) snapshotAt = to;
    const held: MeterCounter[] = levels
      .filter((level) => level.account !== "" && level.bytes >= 0)
      .map((level) => ({
        name: "bytes.held",
        account: level.account,
        home: level.home,
        value: level.bytes,
      }));
    const all = [
      ...[...counters.values()].map(({ counter, value }) => ({ ...counter, value })),
      ...held,
    ];
    counters.clear();
    if (all.length > 0) {
      const window = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      for (let start = 0; start < all.length; start += MAX_COUNTERS) {
        options.operator.enqueue({
          port: "metering",
          batch: {
            batchId: randomUUID(),
            ...window,
            counters: all.slice(start, start + MAX_COUNTERS),
          },
        });
      }
    }
    if (levels.length > 0) options.held?.reported(levels);
    from = to;
  };

  const add = (name: MeterName, scope: MeterScope, value = 1): void => {
    if (!on || scope.account === "" || value <= 0) return;
    if (!stopped) catchUp();
    count(name, scope, value);
  };
  /** Adds to the window in progress. */
  const count = (name: MeterName, scope: MeterScope, value: number): void => {
    if (scope.account === "" || value <= 0) return;
    const key = JSON.stringify([
      name,
      scope.account,
      scope.home ?? null,
      scope.artifactId ?? null,
      scope.routeId ?? null,
      scope.dimensions ?? null,
    ]);
    const found = counters.get(key);
    if (found) {
      found.value += value;
      return;
    }
    counters.set(key, {
      counter: {
        name,
        account: scope.account,
        ...(scope.home !== undefined ? { home: scope.home } : {}),
        ...(scope.artifactId !== undefined ? { artifactId: scope.artifactId } : {}),
        ...(scope.routeId !== undefined ? { routeId: scope.routeId } : {}),
        value: 0,
        ...(scope.dimensions !== undefined ? { dimensions: { ...scope.dimensions } } : {}),
      },
      value,
    });
  };

  /** The window in progress ends on this boundary. */
  let due = boundary(now()) + windowMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /**
   * Closes the window that is due once its boundary passed, at the boundary itself, so its length
   * is exact; a timer that fired early waits for the rest. When the process missed whole windows
   * (asleep), nothing is said for them: the next window starts on the boundary it wakes in. A
   * counter added once the boundary passed closes the window first (a timer held up by a busy or
   * waking process), so it is counted in its own window.
   */
  const catchUp = (): void => {
    const at = now();
    if (at < due) return;
    close(due);
    const current = boundary(at);
    if (current > due) from = current;
    due = current + windowMs;
  };
  const tick = (): void => {
    if (stopped) return;
    catchUp();
    schedule();
  };
  const schedule = (): void => {
    timer = setTimeout(tick, Math.max(1, due - now()));
    timer.unref();
  };
  if (on) {
    schedule();
    options.log.info("meter.started", { windowMs });
  }

  return {
    on,
    add,
    viewerKey: (subject) =>
      createHmac("sha256", monthKey()).update(`mostra viewer ${subject}`).digest("base64url"),
    flush: () => close(now()),
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      close(now());
    },
  };
}

/**
 * The held levels of a server's homes, from its directory (MT-03): each home's running total in
 * `home.held_bytes`, which `home_file`'s triggers keep in the transaction of every change, and
 * `held_dirty`, set by them until the level is queued, so a change made just before a stop is
 * still reported after the restart. A level is marked reported only while it is still the home's.
 */
export function heldLevels(directory: Ledger): NonNullable<MeterOptions["held"]> {
  return {
    pending: (full) =>
      directory.write((db) => {
        const rows = db.all<{
          home: string;
          account: string;
          bytes: number;
          reported: number | null;
        }>(
          `SELECT id AS home, owner_account_id AS account, held_bytes AS bytes,
                  held_reported AS reported
             FROM home
            WHERE held_dirty = 1${full ? " OR held_bytes > 0 OR COALESCE(held_reported, 0) > 0" : ""}`,
        );
        const levels: HeldLevel[] = [];
        for (const row of rows) {
          // Outside a snapshot, a change that came back to the level last sent, or a home that
          // never held anything, has nothing new to say.
          if (!full && row.bytes === (row.reported ?? 0)) {
            db.run(
              "UPDATE home SET held_dirty = 0 WHERE id = ? AND held_bytes = ?",
              row.home,
              row.bytes,
            );
            continue;
          }
          if (row.reported === null && row.bytes === 0) continue;
          levels.push({ home: row.home, account: row.account, bytes: row.bytes });
        }
        return levels;
      }),
    reported: (levels) =>
      directory.write((db) => {
        for (const level of levels) {
          db.run(
            "UPDATE home SET held_reported = ?, held_dirty = 0 WHERE id = ? AND held_bytes = ?",
            level.bytes,
            level.home,
            level.bytes,
          );
        }
      }),
  };
}
