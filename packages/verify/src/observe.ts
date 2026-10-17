/// <reference lib="dom" />
/**
 * How the runner observes a rendered page: the quiescence wait, the recorder's entries, and the
 * judgement of what the page reported (D72, D137 items 2 and 3).
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import type { Frame } from "playwright-core";
import type { NetworkWatch } from "./network.ts";
import { RECORDER_GLOBAL, type RecordedEntry } from "./recorder.ts";

/**
 * Waits until the frame's document has had no mutation for 200 ms and no request is in flight
 * (the page's event stream aside), at most `maxMs`. A quiescence wait, never a fixed sleep: it
 * returns as soon as the page is still (EVAL-01b).
 */
export async function settle(
  frame: Frame,
  network: NetworkWatch,
  deadline: number,
  maxMs = 3000,
): Promise<boolean> {
  const end = Math.min(Date.now() + maxMs, deadline);
  try {
    await frame.evaluate(() => {
      const scope = globalThis as unknown as { __mostraQuiet?: () => number };
      if (scope.__mostraQuiet) return;
      let last = performance.now();
      new MutationObserver(() => {
        last = performance.now();
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      scope.__mostraQuiet = () => performance.now() - last;
    });
    while (Date.now() < end) {
      const quiet = await frame.evaluate(() =>
        (globalThis as unknown as { __mostraQuiet: () => number }).__mostraQuiet(),
      );
      if (quiet >= 200 && network.inflight() === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    // The frame navigated or closed: nothing more to wait for.
  }
  return false;
}

/** Folds identical findings into one with a count. */
export function dedupe(findings: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  for (const finding of findings) {
    const key = `${finding.code}\u0000${finding.message}`;
    const known = seen.get(key);
    if (known) seen.set(key, { ...known, count: (known.count ?? 1) + (finding.count ?? 1) });
    else seen.set(key, finding);
  }
  return [...seen.values()];
}

/** The recorder's entries in a frame from `from` on. */
export async function recorded(frame: Frame, from = 0): Promise<RecordedEntry[]> {
  try {
    return (await frame.evaluate(
      ([name, start]) =>
        (
          ((globalThis as unknown as Record<string, unknown>)[name] as unknown[] | undefined) ?? []
        ).slice(start),
      [RECORDER_GLOBAL, from] as const,
    )) as RecordedEntry[];
  } catch {
    return [];
  }
}

/** Where a finding happened, for its message. */
export type Moment =
  | { readonly kind: "load" }
  | { readonly kind: "interaction"; readonly control: string };

const momentText = (moment: Moment): string =>
  moment.kind === "load" ? "while the page loaded" : `after the smoke test used ${moment.control}`;

/**
 * Judges what the page reported in one moment (D137 items 2 and 3): its own faults are errors,
 * console warnings hints; a fault whose `cause` chain is verify's refusal, and any console error
 * in a moment when verify refused an action, is a hint naming the action; a missing secret is
 * the environment's, a warning.
 */
export function judge(
  entries: readonly RecordedEntry[],
  moment: Moment,
  skipped: readonly string[],
  viewport: string,
): Diagnostic[] {
  const findings: Diagnostic[] = [];
  const location = { viewport };
  for (const entry of entries) {
    if (entry.dropped) continue;
    const text = entry.text.split("\n").slice(0, 6).join("\n");
    const ownSkip = entry.codes.includes("MOSTRA_VERIFY_ACTION_SKIPPED");
    const action = skipped.length > 0 ? skipped.join(", ") : "an action";
    if (ownSkip || (entry.kind === "error" && skipped.length > 0)) {
      findings.push(
        createDiagnostic("MOSTRA_VERIFY_SKIP_CONSEQUENCE", {
          message: `After verify skipped ${action} ${momentText(moment)}, the page reported: ${text}`,
          location,
        }),
      );
      continue;
    }
    if (entry.codes.includes("MOSTRA_SECRET_MISSING")) {
      findings.push(
        createDiagnostic("MOSTRA_VERIFY_SECRET_MISSING", {
          message: `Server code needed a secret ${momentText(moment)}: ${text}`,
          location,
        }),
      );
      continue;
    }
    if (entry.kind === "warn") {
      findings.push(
        createDiagnostic("MOSTRA_CONSOLE_WARNING", {
          message: `The page logged a warning ${momentText(moment)}: ${text}`,
          location,
        }),
      );
    } else if (entry.kind === "error") {
      findings.push(
        createDiagnostic("MOSTRA_CONSOLE_ERROR", {
          message: `The page logged an error ${momentText(moment)}: ${text}`,
          location,
        }),
      );
    } else {
      findings.push(
        createDiagnostic("MOSTRA_RUNTIME_PAGE_ERROR", {
          message: `${entry.kind === "rejection" ? "A promise rejected with nothing to handle it" : "An error was thrown and nothing caught it"} ${momentText(moment)}: ${text}`,
          location,
        }),
      );
    }
  }
  return findings;
}
