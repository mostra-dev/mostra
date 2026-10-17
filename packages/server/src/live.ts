/**
 * Live sources (D56): `live.ts` exports `defineLive(…)` producers, which the artifact's worker runs
 * while someone views them, a host subscribes, or always with `always: true` (D63).
 */

/** How a live source produces its values. */
export interface LiveSourceOptions<T> {
  /** Loads the current value: on start, on every `refresh`, and when a `watch`ed file changes. */
  readonly load?: () => Promise<T>;
  /** How often `load` runs again: `"5s"` to `"24h"` (`s`, `m` or `h`). */
  readonly refresh?: string;
  /** Files whose changes run `load` again: globs relative to the artifact's source. */
  readonly watch?: string | readonly string[];
  /** Produces values as they come; `signal` aborts when the source stops. */
  readonly stream?: (signal: AbortSignal) => AsyncIterable<T>;
  /** Keep producing while nobody views the artifact (D63). */
  readonly always?: boolean;
  /** Keep the last N values for append mode (`useLive(key, { mode: "append" })`, AC-08). */
  readonly ring?: number;
}

/** A live source, as `defineLive` returns it. Pages read it with `useLive(key)`. */
export interface LiveSource<T> {
  /** The source's options, for the worker. */
  readonly "~mostra.live": LiveSourceOptions<T>;
  /** The value type, for `useLive`'s types (never set at run time). */
  readonly __value?: T;
}

/**
 * Declares a live source (D56). Export it from `live.ts`; its export name is its key.
 *
 * ```ts
 * export const inbox = defineLive({ refresh: "5m", load: async () => fetchInbox() });
 * export const prices = defineLive({ stream: (signal) => tickerFeed(signal), ring: 3600 });
 * ```
 */
export function defineLive<T>(source: LiveSourceOptions<T>): LiveSource<T> {
  if (!source.load && !source.stream) {
    throw new TypeError("defineLive needs a load function, a stream function, or both.");
  }
  if (source.refresh !== undefined) parseDuration(source.refresh);
  if (source.ring !== undefined && (!Number.isInteger(source.ring) || source.ring < 1)) {
    throw new TypeError("defineLive's ring is the number of values to keep: a positive integer.");
  }
  return { "~mostra.live": source };
}

/** The options of a live source, or `undefined` for anything `defineLive` didn't make. */
export function liveSourceOptions(value: unknown): LiveSourceOptions<unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const options = (value as { "~mostra.live"?: unknown })["~mostra.live"];
  return typeof options === "object" && options !== null
    ? (options as LiveSourceOptions<unknown>)
    : undefined;
}

/** `"5s"`, `"10m"`, `"24h"` → milliseconds; from 1 s to 24 h. */
export function parseDuration(text: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(text);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000 } as const;
  const ms = match ? Number(match[1]) * unit[match[2] as keyof typeof unit] : Number.NaN;
  if (!(ms >= 1_000 && ms <= 86_400_000)) {
    throw new TypeError(
      `defineLive's refresh is a duration from "1s" to "24h", such as "30s" or "5m"; got ${JSON.stringify(text)}.`,
    );
  }
  return ms;
}
