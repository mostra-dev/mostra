/**
 * The platform layer owns every difference between operating systems (WP-W1, RT-10): no other
 * module reads `process.platform`, so a Windows path can't hide in a module that tests only run
 * on POSIX. The layer itself is the one place that may.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");

describe("the platform layer (RT-10)", () => {
  it("is the only module that reads process.platform", () => {
    const readers = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".ts") && !file.startsWith("platform/"))
      .filter((file) => /process\.platform\b/.test(readFileSync(join(SRC, file), "utf8")));
    expect(readers).toEqual([]);
  });
});
