/** `npm create mostra`'s arguments become exactly one `mostra new` (RT-01). */
import { describe, expect, it } from "vitest";
import { DEFAULT_DIR, nextSteps, plan } from "../../src/index.ts";

describe("create-mostra's plan", () => {
  it("creates the default directory when none is named", () => {
    expect(plan([], "/w")).toEqual({
      argv: ["new", DEFAULT_DIR],
      dir: `/w/${DEFAULT_DIR}`,
      json: false,
      help: false,
    });
  });

  it("takes the first word as the directory and passes every flag on, values included", () => {
    const run = plan(["--", "review", "--title", "Q3 review", "--json"], "/w");
    expect(run.argv).toEqual(["new", "review", "--title", "Q3 review", "--json"]);
    expect(run.dir).toBe("/w/review");
    expect(run.json).toBe(true);
    // A flag's value is never taken for the directory.
    expect(plan(["--title", "x", "dir"], "/w").dir).toBe("/w/dir");
    expect(plan(["--title=x", "dir"], "/w").dir).toBe("/w/dir");
  });

  it("answers --help itself, and quotes a directory with a space in its next steps", () => {
    expect(plan(["-h"], "/w").help).toBe(true);
    expect(nextSteps("my review")).toContain('npx @mostra/cli verify "my review"');
  });
});
