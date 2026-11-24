/** A post's IDs stay while it is sent again, so a lost answer never makes a second thread (finding 6). */
import { describe, expect, it } from "vitest";
import { Attempts } from "../src/attempts.ts";

describe("a post's IDs (WP-20's review, finding 6)", () => {
  it("are the same for a retry of the same post, and new once it went through or changed", () => {
    const attempts = new Attempts();
    let made = 0;
    const make = (): number => {
      made += 1;
      return made;
    };
    const first = attempts.ids("new", "Hello", make);
    // The answer was lost: the same post again carries the same IDs.
    expect(attempts.ids("new", "Hello", make)).toBe(first);
    // Another reply slot has its own.
    expect(attempts.ids("reply:thr_1", "Hello", make)).not.toBe(first);
    // Changed words are another post.
    const changed = attempts.ids("new", "Hello there", make);
    expect(changed).not.toBe(first);
    attempts.done("new");
    expect(attempts.ids("new", "Hello there", make)).not.toBe(changed);
  });
});
