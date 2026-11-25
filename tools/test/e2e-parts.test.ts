import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The end-to-end suites' spec files, as the Playwright config reads them. */
const SPECS = readdirSync(fileURLToPath(new URL("../../tests/e2e/specs", import.meta.url))).filter(
  (file) => file.endsWith(".spec.ts"),
);

/**
 * The dealing module lives with the end-to-end suites (`tests/e2e/support/parts.ts`), outside this
 * project's types: it is called as Node.js runs it, in a child, as the Playwright config calls it.
 */
const PARTS = fileURLToPath(new URL("../../tests/e2e/support/parts.ts", import.meta.url));
function call<T>(expression: string): T {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(PARTS)}); const { dealSpecs, specsForPart, SPEC_SECONDS } = m; let out; try { out = { value: ${expression} }; } catch (error) { out = { error: String(error) }; } process.stdout.write(JSON.stringify(out));`,
    ],
    { encoding: "utf8" },
  );
  const answer = JSON.parse(child.stdout || "{}") as { value?: T; error?: string };
  if (answer.error !== undefined) throw new Error(answer.error);
  return answer.value as T;
}
const SPEC_SECONDS = call<Record<string, number>>("SPEC_SECONDS");
const dealSpecs = (files: readonly string[], total: number): string[][] =>
  call(`dealSpecs(${JSON.stringify(files)}, ${total})`);
const specsForPart = (files: readonly string[], current: number, total: number): string[] =>
  call(`specsForPart(${JSON.stringify(files)}, ${current}, ${total})`);

describe("the end-to-end parts CI splits an engine into (WP-20)", () => {
  it("knows how long every spec file takes, and nothing else", () => {
    expect(Object.keys(SPEC_SECONDS).sort()).toEqual([...SPECS].sort());
  });

  it("puts every spec file in exactly one part, and the parts in agreement", () => {
    for (const total of [1, 2, 3, 4, 5]) {
      const parts = dealSpecs(SPECS, total);
      expect(parts.flat().sort()).toEqual([...SPECS].sort());
      for (let current = 1; current <= total; current += 1) {
        expect(specsForPart([...SPECS].reverse(), current, total)).toEqual(parts[current - 1]);
      }
    }
  });

  it("gives no part much more than its share, beyond the longest file itself", () => {
    const seconds = (files: readonly string[]): number =>
      files.reduce((sum, file) => sum + (SPEC_SECONDS[file] ?? 0), 0);
    const all = seconds(SPECS);
    const longest = Math.max(...SPECS.map((file) => SPEC_SECONDS[file] ?? 0));
    for (const total of [2, 3, 4]) {
      for (const part of dealSpecs(SPECS, total)) {
        expect(seconds(part)).toBeLessThanOrEqual(Math.max(longest, (all / total) * 1.25));
      }
    }
  });

  it("refuses a part that isn't one of the run's", () => {
    expect(() => specsForPart(SPECS, 0, 4)).toThrow();
    expect(() => specsForPart(SPECS, 5, 4)).toThrow();
  });
});
