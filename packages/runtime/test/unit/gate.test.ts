/**
 * The gate between gc and the work whose files it would remove (D140 item 14): shared work runs
 * side by side, gc runs alone, a waiting gc goes before shared work that arrives after it, and
 * shared work inside shared work (or inside gc) joins its caller's hold instead of deadlocking.
 */
import { describe, expect, it } from "vitest";
import { Gate } from "../../src/gate.ts";

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 5));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("the gc gate", () => {
  it("runs shared work side by side, and gc only once it has all ended", async () => {
    const gate = new Gate();
    const log: string[] = [];
    const first = deferred();
    const second = deferred();
    const a = gate.shared(async () => {
      log.push("a start");
      await first.promise;
      log.push("a end");
    });
    const b = gate.shared(async () => {
      log.push("b start");
      await second.promise;
      log.push("b end");
    });
    await tick();
    const gc = gate.exclusive(async () => {
      log.push("gc");
    });
    await tick();
    expect(log).toEqual(["a start", "b start"]);
    first.resolve();
    await tick();
    expect(log).not.toContain("gc");
    second.resolve();
    await Promise.all([a, b, gc]);
    expect(log).toEqual(["a start", "b start", "a end", "b end", "gc"]);
  });

  it("lets a waiting gc go before shared work that arrives after it", async () => {
    const gate = new Gate();
    const log: string[] = [];
    const held = deferred();
    const a = gate.shared(async () => {
      await held.promise;
      log.push("a");
    });
    await tick();
    const gc = gate.exclusive(async () => {
      log.push("gc");
    });
    await tick();
    const late = gate.shared(async () => {
      log.push("late");
    });
    await tick();
    expect(log).toEqual([]);
    held.resolve();
    await Promise.all([a, gc, late]);
    expect(log).toEqual(["a", "gc", "late"]);
  });

  it("keeps shared work out while gc runs", async () => {
    const gate = new Gate();
    const log: string[] = [];
    const held = deferred();
    const gc = gate.exclusive(async () => {
      log.push("gc start");
      await held.promise;
      log.push("gc end");
    });
    await tick();
    const publish = gate.shared(async () => {
      log.push("publish");
    });
    await tick();
    expect(log).toEqual(["gc start"]);
    held.resolve();
    await Promise.all([gc, publish]);
    expect(log).toEqual(["gc start", "gc end", "publish"]);
  });

  it("lets shared work inside shared work or gc join the hold, so a waiting gc never deadlocks it", async () => {
    const gate = new Gate();
    const log: string[] = [];
    const held = deferred();
    const outer = gate.shared(async () => {
      await held.promise;
      // A verify run whose worker installs a layout: shared inside shared, while gc waits.
      await gate.shared(async () => {
        log.push("inner");
      });
      log.push("outer");
    });
    await tick();
    const gc = gate.exclusive(async () => {
      // gc's own dependency collection takes the shared path too.
      await gate.shared(async () => {
        log.push("gc inner");
      });
      log.push("gc");
    });
    await tick();
    held.resolve();
    await Promise.all([outer, gc]);
    expect(log).toEqual(["inner", "outer", "gc inner", "gc"]);
  });

  it("releases the gate when work throws", async () => {
    const gate = new Gate();
    await expect(gate.exclusive(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(gate.shared(async () => Promise.reject(new Error("bang")))).rejects.toThrow(
      "bang",
    );
    await expect(gate.exclusive(async () => "ran")).resolves.toBe("ran");
  });
});
