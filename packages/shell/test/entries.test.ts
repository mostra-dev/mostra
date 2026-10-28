/**
 * Who may replace the artifact's frame (D157 item 1, D115): the interleavings the second GPT review
 * of MT-02b found, each as the shell's paths meet them.
 */
import { describe, expect, it } from "vitest";
import { frameEntries } from "../src/entries.ts";

/** A request the test answers when it chooses, and whose signal it can read. */
function pending<T>(): {
  readonly request: (signal: AbortSignal) => Promise<T>;
  answer(value: T): void;
  fail(error: Error): void;
  aborted(): boolean;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  let seen: AbortSignal | undefined;
  return {
    request: (signal) => {
      seen = signal;
      return new Promise<T>((done, failed) => {
        resolve = done;
        reject = failed;
      });
    },
    answer: (value) => resolve(value),
    fail: (error) => reject(error),
    aborted: () => seen?.aborted === true,
  };
}

describe("entering the artifact's frame (D157 item 1, the second GPT review of MT-02b)", () => {
  it("uses a ticket when nothing happened to the frame meanwhile", async () => {
    const entries = frameEntries();
    const ticket = pending<string>();
    const entered = entries.enter(ticket.request);
    ticket.answer("ticket");
    expect(await entered).toBe("ticket");
  });

  it("drops a ticket asked for before the frame greeted, even when its answer comes before React commits (finding 2)", async () => {
    const entries = frameEntries();
    const recovery = pending<string>();
    const entered = entries.enter(recovery.request);
    // The greeting arrives, and the ticket's answer right after it, in the same turn.
    entries.greeted();
    recovery.answer("late");
    expect(await entered).toBeUndefined();
    expect(recovery.aborted()).toBe(true);
  });

  it("drops the earlier of two entries: a late re-entry ticket never replaces the recovered frame (finding 1)", async () => {
    const entries = frameEntries();
    const recovery = pending<string>();
    const reentry = pending<string>();
    // A wrong-version greeting asks for a re-entry while the recovery's ticket is on its way.
    const first = entries.enter(recovery.request);
    entries.greeted();
    const second = entries.enter(reentry.request);
    recovery.answer("recovered");
    expect(await first).toBeUndefined();
    // The re-entry's own ticket is used, unless the frame greets again before it comes.
    entries.greeted();
    reentry.answer("late-wrong-version-ticket");
    expect(await second).toBeUndefined();
  });

  it("reports a failed request, unless the entry was dropped meanwhile", async () => {
    const entries = frameEntries();
    const failing = pending<string>();
    const entered = entries.enter(failing.request);
    failing.fail(new Error("network"));
    await expect(entered).rejects.toThrow("network");

    const dropped = pending<string>();
    const later = entries.enter(dropped.request);
    entries.greeted();
    dropped.fail(new Error("aborted"));
    expect(await later).toBeUndefined();
  });

  it("drops what's asked for when cancelled", async () => {
    const entries = frameEntries();
    const ticket = pending<string>();
    const entered = entries.enter(ticket.request);
    entries.cancel();
    expect(ticket.aborted()).toBe(true);
    ticket.answer("after the page closed");
    expect(await entered).toBeUndefined();
  });
});
