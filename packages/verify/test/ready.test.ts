/**
 * How long verify waits for a page (D138 item 3, D157 item 1): each frame entry the shell makes gets
 * the whole window again, and the wait ends as soon as the shell says the page is ready, failed or
 * gave up loading its frame (the second GPT review of MT-02b, finding 4).
 */
import { describe, expect, it } from "vitest";
import { awaitReady, type ShellMarks } from "../src/runner.ts";

/** A shell whose marks change at the given times, read the way the runner reads a page's. */
function shellOver(timeline: readonly (readonly [number, ShellMarks])[]) {
  const started = Date.now();
  const now = (): ShellMarks => {
    const at = Date.now() - started;
    let marks: ShellMarks = { shell: "framed" };
    for (const [from, value] of timeline) if (at >= from) marks = { ...marks, ...value };
    return marks;
  };
  return async (seen: string, timeoutMs: number): Promise<ShellMarks | undefined> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const marks = now();
      if (
        marks.shell === "ready" ||
        marks.shell === "error" ||
        marks.frameReloads === "gave-up" ||
        (marks.frameReloads ?? "") !== seen
      )
        return marks;
      if (Date.now() >= until) return undefined;
      await new Promise((done) => setTimeout(done, 10));
    }
  };
}

const plenty = (): number => 60_000;

describe("verify's wait for a page (the second GPT review of MT-02b, finding 4)", () => {
  it("gives a frame the shell entered again a window of its own", async () => {
    // The first frame never greets; the shell enters it again at 200 ms, and the new one is ready
    // at 450 ms, past one window of 300 ms from the start.
    const next = shellOver([
      [200, { frameReloads: "1" }],
      [450, { shell: "ready" }],
    ]);
    expect(await awaitReady(next, plenty, 300)).toBe("ready");
  });

  it("ends as soon as the shell gives up, or reports an error", async () => {
    const started = Date.now();
    const gaveUp = shellOver([
      [50, { frameReloads: "1" }],
      [100, { frameReloads: "gave-up" }],
    ]);
    expect(await awaitReady(gaveUp, plenty, 5_000)).toBe("gave-up");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await awaitReady(shellOver([[50, { shell: "error" }]]), plenty, 5_000)).toBe("error");
  });

  it("judges a page that never gets ready within its window", async () => {
    expect(await awaitReady(shellOver([]), plenty, 200)).toBe("never");
  });

  it("stops at the render's own deadline", async () => {
    const until = Date.now() + 150;
    const next = shellOver([
      [50, { frameReloads: "1" }],
      [5_000, { shell: "ready" }],
    ]);
    expect(await awaitReady(next, () => until - Date.now(), 1_000)).toBe("never");
  });
});
