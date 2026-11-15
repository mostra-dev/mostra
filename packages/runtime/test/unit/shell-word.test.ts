/**
 * One shell word for a fix command (WP-16): a path an agent pastes as it is given.
 */
import { describe, expect, it } from "vitest";
import { shellWord, WINDOWS } from "../../src/platform/index.ts";

describe("shellWord", () => {
  it("keeps a plain path plain, a Windows short name included", () => {
    expect(shellWord("/tmp/a-b_c/index.tsx")).toBe("/tmp/a-b_c/index.tsx");
    expect(shellWord(WINDOWS ? "C:\\Users\\RUNNER~1\\x" : "/Users/RUNNER~1/x")).toBe(
      WINDOWS ? "C:\\Users\\RUNNER~1\\x" : "/Users/RUNNER~1/x",
    );
  });

  it("quotes what a shell would split or expand", () => {
    if (WINDOWS) {
      expect(shellWord("C:\\My Artifacts\\x")).toBe('"C:\\My Artifacts\\x"');
    } else {
      expect(shellWord("/tmp/my artifacts")).toBe("'/tmp/my artifacts'");
      expect(shellWord("~/x")).toBe("'~/x'");
      expect(shellWord("/tmp/it's")).toBe("'/tmp/it'\\''s'");
      expect(shellWord("/tmp/$HOME")).toBe("'/tmp/$HOME'");
    }
  });
});
