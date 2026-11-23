/**
 * The gate tests' repository copy (`repo-copy.ts`): it holds the working tree the gates judge and
 * leaves out the git-ignored scratch a session keeps in `temp/`, which can be tens of gigabytes
 * (MT-07's baseline: a copy of `temp/` filled the system disk under the pre-push check).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.ts";
import { copyRepository } from "./repo-copy.ts";

const scratch = join(ROOT, "temp", `repo-copy-test-${process.pid}`);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the gate tests' repository copy", () => {
  it("copies the working tree and leaves out the ignored scratch in temp/", () => {
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "marker.txt"), "scratch\n");
    const copy = copyRepository();
    try {
      expect(existsSync(join(copy.root, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(copy.root, "tools", "test", "repo-copy.ts"))).toBe(true);
      expect(existsSync(join(copy.root, "temp", `repo-copy-test-${process.pid}`))).toBe(false);
      expect(existsSync(join(copy.root, "temp"))).toBe(false);
    } finally {
      copy.dispose();
    }
  }, 300_000);
});
