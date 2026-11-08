/**
 * Metering for an operator (INTERFACES §18.6, D165 item 9): counters kept in memory for a window,
 * then handed to the operator's `metering.record` as one batch with a stable `batchId`, through
 * the durable outbound queue, so a batch is delivered at least once across restarts. With no
 * metering port nothing is counted.
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
import type { Log } from "../log.ts";
import type { Operator } from "./operator.ts";

/** How long one batch's window lasts. */
const WINDOW_MS = 60_000;

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
  /** The window, shortened by tests. */
  readonly windowMs?: number;
  /** Seconds each open home was active, added at every window. */
  readonly activeHomes?: () => readonly { readonly home: string; readonly account: string }[];
}

/** Creates the meter. */
export function createMeter(options: MeterOptions): Meter {
  const on = options.operator.has.metering;
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? WINDOW_MS;
  const counters = new Map<string, { counter: MeterCounter; value: number }>();
  let from = now();
  const monthKeys = new Map<string, Buffer>();

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

  const flush = (): void => {
    if (!on) return;
    const to = now();
    const seconds = Math.max(0, Math.round((to - from) / 1000));
    if (seconds > 0) {
      for (const active of options.activeHomes?.() ?? []) {
        add("home.activeSeconds", { account: active.account, home: active.home }, seconds);
      }
    }
    if (counters.size === 0) {
      from = to;
      return;
    }
    const batch = {
      batchId: randomUUID(),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      counters: [...counters.values()].map(({ counter, value }) => ({ ...counter, value })),
    };
    counters.clear();
    from = to;
    options.operator.enqueue({ port: "metering", batch });
  };

  const add = (name: MeterName, scope: MeterScope, value = 1): void => {
    if (!on || scope.account === "" || value <= 0) return;
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

  const timer = on ? setInterval(flush, windowMs) : undefined;
  timer?.unref();
  if (on) options.log.info("meter.started", { windowMs });

  return {
    on,
    add,
    viewerKey: (subject) =>
      createHmac("sha256", monthKey()).update(`mostra viewer ${subject}`).digest("base64url"),
    flush,
    stop() {
      if (timer) clearInterval(timer);
      flush();
    },
  };
}
