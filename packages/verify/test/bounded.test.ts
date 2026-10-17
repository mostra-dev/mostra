/**
 * How the runner gives up on a render that never answers (Opus review finding 5): one page whose
 * code blocks its main thread is abandoned on its own, past its deadline, so the shared runner and
 * every other run's renders keep going.
 */
import { describe, expect, it } from "vitest";
import { bounded } from "../src/index.ts";

const late = "late" as const;
const never = (): Promise<string> => new Promise(() => {});

describe("bounded (a render past its deadline)", () => {
  it("gives up on work that never answers, past its deadline, and abandons it once", async () => {
    let abandoned = 0;
    const started = Date.now();
    const result = await bounded(never(), {
      deadline: started + 50,
      graceMs: 20,
      late,
      abandon: async () => {
        abandoned += 1;
      },
    });
    expect(result).toBe(late);
    expect(abandoned).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(65);
  });

  it("answers late, not with an error, when the abandon makes the work fail", async () => {
    let fail: (error: Error) => void = () => {};
    const work = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const result = await bounded(work, {
      deadline: Date.now(),
      graceMs: 10,
      late,
      // Closing the context makes the render's pending browser calls throw at once.
      abandon: async () => fail(new Error("Target page, context or browser has been closed")),
    });
    expect(result).toBe(late);
  });

  it("keeps its hands off work that answers in time", async () => {
    let abandoned = 0;
    const result = await bounded(Promise.resolve("done"), {
      deadline: Date.now() + 1000,
      graceMs: 10,
      late,
      abandon: async () => {
        abandoned += 1;
      },
    });
    expect(result).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(abandoned).toBe(0);
  });

  it("throws a failure of the work's own before its deadline", async () => {
    await expect(
      bounded(Promise.reject(new Error("the page crashed")), {
        deadline: Date.now() + 1000,
        late,
        abandon: () => undefined,
      }),
    ).rejects.toThrow("the page crashed");
  });

  it("answers once the abandon has had 2 s, even when it never finishes", async () => {
    const started = Date.now();
    const result = await bounded(never(), {
      deadline: started,
      graceMs: 0,
      late,
      abandon: never,
    });
    expect(result).toBe(late);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
