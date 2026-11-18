/**
 * The owner's line of submissions read again (#139, `link/reimport.ts`): whatever order the reads
 * finish in, imports happen in the hosted order, one at a time, and a read that fails holds every
 * later submission back until it is tried again.
 */
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  createReimportLine,
  inHostedOrder,
  type Missing,
  type ReadOutcome,
  refusedForGood,
} from "../../src/link/reimport.ts";

/** A read that ends when the test says. */
function deferred(): { promise: Promise<ReadOutcome>; resolve(outcome: ReadOutcome): void } {
  let resolve!: (outcome: ReadOutcome) => void;
  const promise = new Promise<ReadOutcome>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("reading followed submissions again, in the hosted order (#139)", () => {
  it("orders by the hosted cursor as a number, rows kept without one first", () => {
    expect(
      inHostedOrder([
        { submissionId: "sub_b", cursor: "283" },
        { submissionId: "sub_c", cursor: "1000" },
        { submissionId: "sub_a", cursor: "281" },
        { submissionId: "sub_old" },
      ]).map((missing) => missing.submissionId),
    ).toEqual(["sub_old", "sub_a", "sub_b", "sub_c"]);
  });

  it("imports in the hosted order though the later read would finish first", async () => {
    // Two submissions the follow saw in one page, ULIDs in the reverse of their hosted order, and
    // the later one's read answered first: the line never starts it before the earlier one ends.
    const waiting: Missing[] = [
      { submissionId: "sub_01A", cursor: "283" },
      { submissionId: "sub_01Z", cursor: "281" },
    ];
    const reads = new Map([
      ["sub_01Z", deferred()],
      ["sub_01A", deferred()],
    ]);
    const started: string[] = [];
    const imported: string[] = [];
    const line = createReimportLine({
      waiting: () => waiting,
      read: async (missing) => {
        started.push(missing.submissionId);
        const outcome = await (reads.get(missing.submissionId) as ReturnType<typeof deferred>)
          .promise;
        imported.push(missing.submissionId);
        waiting.splice(waiting.indexOf(missing), 1);
        return outcome;
      },
    });
    line.kick();
    await tick();
    expect(started).toEqual(["sub_01Z"]);
    reads.get("sub_01A")?.resolve("done");
    await tick();
    expect(imported).toEqual([]);
    reads.get("sub_01Z")?.resolve("done");
    await line.idle();
    expect(imported).toEqual(["sub_01Z", "sub_01A"]);
  });

  it("holds every later submission back while an earlier one can't be read", async () => {
    const waiting: Missing[] = [
      { submissionId: "sub_1", cursor: "10" },
      { submissionId: "sub_2", cursor: "11" },
    ];
    let failing = true;
    const read: string[] = [];
    const failures: string[] = [];
    const line = createReimportLine({
      waiting: () => waiting,
      read: async (missing) => {
        read.push(missing.submissionId);
        if (missing.submissionId === "sub_1" && failing) throw new Error("offline");
        waiting.splice(waiting.indexOf(missing), 1);
        return "done";
      },
      failed: (missing) => failures.push(missing.submissionId),
      later: () => undefined,
    });
    line.kick();
    await line.idle();
    expect(read).toEqual(["sub_1"]);
    expect(failures).toEqual(["sub_1"]);
    expect(waiting.map((missing) => missing.submissionId)).toEqual(["sub_1", "sub_2"]);
    // A retry answer holds the line the same way.
    const retried = createReimportLine({
      waiting: () => waiting,
      read: async () => "retry",
      later: () => undefined,
    });
    retried.kick();
    await retried.idle();
    expect(waiting).toHaveLength(2);
    // The next page tries again, in order.
    failing = false;
    line.kick();
    await line.idle();
    expect(read).toEqual(["sub_1", "sub_1", "sub_2"]);
    expect(waiting).toEqual([]);
  });

  it("reads what the follow noted meanwhile in its turn, one line at a time", async () => {
    const waiting: Missing[] = [{ submissionId: "sub_1", cursor: "1" }];
    const first = deferred();
    let inFlight = 0;
    let most = 0;
    const read: string[] = [];
    const line = createReimportLine({
      waiting: () => waiting,
      read: async (missing) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        read.push(missing.submissionId);
        const outcome = missing.submissionId === "sub_1" ? await first.promise : "done";
        waiting.splice(waiting.indexOf(missing), 1);
        inFlight -= 1;
        return outcome;
      },
    });
    line.kick();
    await tick();
    // The follow notes another page while the line reads: a kick doesn't start a second line.
    waiting.push({ submissionId: "sub_2", cursor: "2" });
    line.kick();
    line.kick();
    first.resolve("done");
    await line.idle();
    expect(read).toEqual(["sub_1", "sub_2"]);
    expect(most).toBe(1);
  });

  it("tries again on its own once it stopped, each pause longer, from the first again once through (R02-3)", async () => {
    const waiting: Missing[] = [{ submissionId: "sub_1", cursor: "10" }];
    let failing = true;
    const pauses: number[] = [];
    let next: (() => void) | undefined;
    const line = createReimportLine({
      waiting: () => waiting,
      read: async () => {
        if (failing) return "retry";
        waiting.splice(0, 1);
        return "done";
      },
      later: (fn, ms) => {
        pauses.push(ms);
        next = fn;
      },
    });
    line.kick();
    await line.idle();
    // A kick while it waits for its turn adds no second timer.
    line.kick();
    await line.idle();
    expect(pauses).toEqual([1_000]);
    next?.();
    await line.idle();
    expect(pauses).toEqual([1_000, 2_000]);
    failing = false;
    next?.();
    await line.idle();
    expect(waiting).toEqual([]);
    // Through: the next stop waits the first pause again.
    waiting.push({ submissionId: "sub_2", cursor: "11" });
    failing = true;
    line.kick();
    await line.idle();
    expect(pauses).toEqual([1_000, 2_000, 1_000]);
  });

  it("takes the hosted home's refusal of a submission it doesn't hold as an end, and a failure as a retry (R01-3)", () => {
    const refusal = (code: Parameters<typeof createDiagnostic>[0]) =>
      new RpcError(createDiagnostic(code, { message: "no" }));
    expect(refusedForGood(refusal("MOSTRA_HOST_INVALID_PARAMS"))).toBe(
      "MOSTRA_HOST_INVALID_PARAMS",
    );
    expect(refusedForGood(refusal("MOSTRA_HOST_METHOD_UNKNOWN"))).toBe(
      "MOSTRA_HOST_METHOD_UNKNOWN",
    );
    expect(refusedForGood(refusal("MOSTRA_HOST_TIMEOUT"))).toBeUndefined();
    expect(refusedForGood(refusal("MOSTRA_HOST_INTERNAL_ERROR"))).toBeUndefined();
    expect(refusedForGood(new Error("the connection closed"))).toBeUndefined();
  });
});
