/// <reference lib="dom" />
/**
 * The recorder every frame of a verify render starts with (Playwright's init script): it keeps the
 * page's own console errors and warnings, uncaught errors and unhandled rejections, each with the
 * diagnostic codes along its `cause` chain, so the runner can tell the artifact's faults from those
 * verify's synthetic refusal caused (D137 item 2). An unhandled rejection whose reason is that
 * refusal is dropped, as the browser would never meet it for a viewer.
 *
 * It runs in the page, so it is one self-contained function: nothing from this module's scope.
 */

/** One thing the page reported. */
export interface RecordedEntry {
  readonly seq: number;
  /** `error` and `warn` (the console), `uncaught` (an error event) or `rejection`. */
  readonly kind: "error" | "warn" | "uncaught" | "rejection";
  readonly text: string;
  /** The `code`s of the value and its `cause` chain: `MostraError`s carry one. */
  readonly codes: readonly string[];
  /** Set on a rejection the recorder kept from the browser: verify's own refusal. */
  readonly dropped?: true;
}

/** The global the recorder keeps its entries on. */
export const RECORDER_GLOBAL = "__mostraVerifyLog";

/** The recorder, as Playwright installs it in every frame before the page's scripts run. */
export function recorder(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope["__mostraVerifyLog"]) return;
  const entries: unknown[] = [];
  let seq = 0;
  const codesOf = (value: unknown): string[] => {
    const codes: string[] = [];
    let current = value as { code?: unknown; cause?: unknown } | null | undefined;
    for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
      if (typeof current.code === "string") codes.push(current.code);
      current = current.cause as typeof current;
    }
    return codes;
  };
  const describe = (value: unknown): string => {
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const record = (entry: Record<string, unknown>): void => {
    if (entries.length < 500) entries.push({ seq: ++seq, ...entry });
  };
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record({
        kind: level,
        text: args.map(describe).join(" ").slice(0, 2000),
        codes: args.flatMap(codesOf),
      });
      original(...args);
    };
  }
  addEventListener("error", (event) => {
    const error = (event as ErrorEvent).error as unknown;
    record({
      kind: "uncaught",
      text: (error === undefined ? (event as ErrorEvent).message : describe(error)).slice(0, 2000),
      codes: codesOf(error),
    });
  });
  addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    const codes = codesOf(reason);
    const dropped = codes.includes("MOSTRA_VERIFY_ACTION_SKIPPED");
    if (dropped) event.preventDefault();
    record({
      kind: "rejection",
      text: describe(reason).slice(0, 2000),
      codes,
      ...(dropped ? { dropped: true } : {}),
    });
  });
  Object.defineProperty(scope, "__mostraVerifyLog", { value: entries });
}
