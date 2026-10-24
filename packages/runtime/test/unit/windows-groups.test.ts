/**
 * The Windows legs run every integration suite (WP-W2, D146): their groups partition
 * `test/integration`, so a new suite can't be left off Windows by accident, and a suite that runs
 * twice would cost a machine for nothing.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INTEGRATION_GROUPS } from "../../vitest.config.ts";

const suites = readdirSync(fileURLToPath(new URL("../integration", import.meta.url)))
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `test/integration/${name}`)
  .sort();

describe("the Windows integration groups (WP-W2)", () => {
  it("run every suite exactly once", () => {
    const windows = Object.entries(INTEGRATION_GROUPS).filter(([name]) =>
      name.startsWith("windows"),
    );
    expect(windows.length).toBeGreaterThan(1);
    const counts = new Map<string, number>();
    for (const [name, group] of windows) {
      expect(group.exclude, name).toEqual([]);
      for (const file of group.include) {
        expect(file, `${name} names ${file}, which isn't a suite`).toMatch(
          /^test\/integration\/[\w-]+\.test\.ts$/,
        );
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }
    expect([...counts.keys()].sort()).toEqual(suites);
    for (const [file, count] of counts) expect(count, file).toBe(1);
  });
});
