/**
 * The test support's own cleanup (`removeEvery` in test/support.ts): every test directory is kept
 * and removed even when one can't be (the Opus review of MT-02).
 */
import { describe, expect, it } from "vitest";
import { removeEvery } from "../support.ts";

describe("the test support's cleanup", () => {
  it("keeps and removes every directory before it reports the one it couldn't remove", () => {
    const kept: string[] = [];
    const removed: string[] = [];
    const remove = (dir: string): void => {
      if (dir === "b") throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      removed.push(dir);
    };
    expect(() => removeEvery(["a", "b", "c"], (dir) => kept.push(dir), remove)).toThrow(
      "Couldn't remove b",
    );
    expect(kept).toEqual(["a", "b", "c"]);
    expect(removed).toEqual(["a", "c"]);
  });

  it("names every directory it couldn't remove, and fails on none when all went", () => {
    const fail = (): void => {
      throw new Error("EPERM");
    };
    expect(() => removeEvery(["a", "b"], () => undefined, fail)).toThrow(
      "Couldn't remove a: something still holds it open; Couldn't remove b",
    );
    expect(() =>
      removeEvery(
        ["a"],
        () => undefined,
        () => undefined,
      ),
    ).not.toThrow();
  });
});
