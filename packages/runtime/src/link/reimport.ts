/**
 * Reading followed submissions again (#139, D175 item 9, FAILURE_MODEL §11.2): the owner's log
 * keeps a hosted home's submissions in the hosted home's order, so a local host receives answers
 * in the order people sent them.
 *
 * Two paths bring a hosted submission into this home's log, each in the hosted order: the hosted
 * outbox's deliveries, one at a time, and this read again of what the follow saw before its
 * delivery came. Each inserts only what the log doesn't hold yet. Two in-order streams that each
 * handle every submission they carry in order keep their union in order too, provided neither
 * skips ahead: so the submissions waiting here are read in their hosted cursor's order, one at a
 * time per server, and the first read that fails stops the line until it is tried again, never
 * letting a later one past it.
 */

/** One followed submission this home lacks, with the hosted cursor of its `submission.created`. */
export interface Missing {
  readonly submissionId: string;
  /** The hosted event cursor, a decimal string; absent on rows kept before it was recorded. */
  readonly cursor?: string;
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
  const run = async (): Promise<void> => {
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
        // A submission that can't be read yet holds every later one back: past it, the log would
        // take a later answer first. The next page, or the next session, tries again.
        if (outcome === "retry") return;
      }
    } while (again);
  };
  return {
    kick() {
      if (running) {
        again = true;
        return;
      }
      running = run().finally(() => {
        running = undefined;
      });
    },
    idle: () => running ?? Promise.resolve(),
  };
}
