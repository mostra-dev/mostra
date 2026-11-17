/**
 * Reading followed submissions again (#139, D175 item 9, FAILURE_MODEL §11.2): the owner's log
 * keeps a hosted home's submissions in the hosted home's order, so a local host receives answers
 * in the order people sent them.
 *
 * Two paths bring a hosted submission into this home's log: the hosted outbox's deliveries, one
 * at a time, and this read again of what the follow saw before its delivery came. The two carry
 * different submissions (one the outbox never delivers here is only read again), so neither may
 * go past the other: the submissions waiting here are imported in their hosted cursor's order,
 * one at a time per server, and a delivery that arrives while an earlier submission still waits
 * joins this line with its envelope, held durably and imported in its turn (review findings
 * R01-5, R02-3). The first import that can't happen yet stops the line, never letting a later one
 * past it, and the line tries again after a pause that grows, also when no new page comes. A
 * submission the hosted home refuses for good (it no longer holds it, or delivers it elsewhere)
 * waits no longer (R01-3).
 */

/** One followed submission this home lacks, with the hosted cursor of its `submission.created`. */
export interface Missing {
  readonly submissionId: string;
  /**
   * The hosted event cursor, a decimal string; absent on rows kept before it was recorded, and on
   * rows noted under an incarnation the hosted home has since left, which came before any of the
   * new one's.
   */
  readonly cursor?: string;
  /** The delivered envelope held here (JSON) until its turn, for a delivery that came early. */
  readonly envelope?: string;
}

/** What one read again ended with. */
export type ReadOutcome =
  /** Imported, or refused for good: it waits no longer. */
  | "done"
  /** Not yet: it waits, and so does every submission after it. */
  | "retry";

/** What the line reads from, and how it reads one. */
export interface ReimportSource {
  /** The submissions waiting, in any order: the line orders them. */
  waiting(): readonly Missing[];
  /** Reads one again and imports it; a thrown error is a `retry`. */
  read(missing: Missing): Promise<ReadOutcome>;
  /** Told of each read that failed. */
  failed?(missing: Missing, error: unknown): void;
  /** Runs `fn` after `ms` (tests take the clock); `setTimeout`, never holding the process. */
  later?(fn: () => void, ms: number): void;
}

/** The first pause before a line that stopped tries again, doubled each time up to the last. */
export const REIMPORT_RETRY_MS: { readonly first: number; readonly last: number } = {
  first: 1_000,
  last: 60_000,
};

/**
 * The answers to `hosted/submission` that no later try changes: the hosted home holds no such
 * submission for this instance (it was delivered elsewhere, or a restore lost it), or it serves no
 * such method.
 */
const REFUSED_FOR_GOOD: ReadonlySet<string> = new Set([
  "MOSTRA_HOST_INVALID_PARAMS",
  "MOSTRA_HOST_METHOD_UNKNOWN",
]);

/**
 * The code of a read's refusal that no later try changes, or `undefined` for a failure worth
 * trying again (the connection, a timeout, the hosted home's own trouble).
 */
export function refusedForGood(error: unknown): string | undefined {
  const code = (error as { diagnostic?: { code?: unknown } } | undefined)?.diagnostic?.code;
  return typeof code === "string" && REFUSED_FOR_GOOD.has(code) ? code : undefined;
}

/** The order the line reads in: hosted cursor first, numerically; rows without one before. */
export function inHostedOrder(waiting: readonly Missing[]): Missing[] {
  const key = (missing: Missing): bigint =>
    missing.cursor !== undefined && /^\d+$/.test(missing.cursor) ? BigInt(missing.cursor) : -1n;
  return [...waiting].sort((a, b) => {
    const order = key(a) - key(b);
    if (order !== 0n) return order < 0n ? -1 : 1;
    return a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : 0;
  });
}

/**
 * One server's line of reads. `kick` starts it unless it runs; a kick while it runs makes it look
 * again once it reaches the end of what it saw, so a submission the follow notes meanwhile is read
 * in its turn. `idle` resolves when the line has stopped.
 */
export interface ReimportLine {
  kick(): void;
  idle(): Promise<void>;
}

/** Makes a server's line over `source`. */
export function createReimportLine(source: ReimportSource): ReimportLine {
  let running: Promise<void> | undefined;
  let again = false;
  let pause: number = REIMPORT_RETRY_MS.first;
  let retrying = false;
  const later =
    source.later ??
    ((fn: () => void, ms: number) => {
      setTimeout(fn, ms).unref?.();
    });
  /** Whether the line got to the end of what waits (`true`) or stopped at one that must wait. */
  const run = async (): Promise<boolean> => {
    do {
      again = false;
      for (const missing of inHostedOrder(source.waiting())) {
        let outcome: ReadOutcome;
        try {
          outcome = await source.read(missing);
        } catch (error) {
          source.failed?.(missing, error);
          outcome = "retry";
        }
        // A submission that can't be imported yet holds every later one back: past it, the log
        // would take a later answer first.
        if (outcome === "retry") return false;
      }
    } while (again);
    return true;
  };
  const line: ReimportLine = {
    kick() {
      if (running) {
        again = true;
        return;
      }
      running = run()
        .then((finished) => {
          if (finished) {
            pause = REIMPORT_RETRY_MS.first;
            return;
          }
          // Tried again on its own, a kick that came meanwhile included, and later each time.
          if (retrying) return;
          retrying = true;
          const wait = pause;
          pause = Math.min(pause * 2, REIMPORT_RETRY_MS.last);
          later(() => {
            retrying = false;
            line.kick();
          }, wait);
        })
        .finally(() => {
          running = undefined;
        });
    },
    idle: () => running ?? Promise.resolve(),
  };
  return line;
}
