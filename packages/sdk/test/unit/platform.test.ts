import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glibcRuntime } from "../../src/platform.ts";
import { pinsFile } from "../../src/runtime.ts";

describe("the platform gate reads glibc without blocking its host (Opus review finding 4)", () => {
  it("asks for the report with excludeNetwork set, and restores the setting after", () => {
    const seen: boolean[] = [];
    const report = {
      excludeNetwork: false,
      getReport() {
        seen.push(this.excludeNetwork);
        return { header: { glibcVersionRuntime: "2.39" } };
      },
    };
    expect(glibcRuntime(report)).toBe("2.39");
    expect(seen).toEqual([true]);
    expect(report.excludeNetwork).toBe(false);
  });

  it("restores the setting when the report fails, and reads musl as no glibc", () => {
    const failing = {
      excludeNetwork: true,
      getReport(): object {
        throw new Error("no report");
      },
    };
    expect(() => glibcRuntime(failing)).toThrow("no report");
    expect(failing.excludeNetwork).toBe(true);
    expect(glibcRuntime({ excludeNetwork: false, getReport: () => ({ header: {} }) })).toBe(
      undefined,
    );
    expect(glibcRuntime(undefined)).toBe(undefined);
  });
});

describe("the test pins override (Opus review finding 8)", () => {
  const env = { MOSTRA_TEST_BUNDLE_PINS: "/tmp/pins.json" };

  it("is honoured only by a package running from a development checkout", () => {
    expect(pinsFile(env, "/work/mostra/packages/sdk")).toBe("/tmp/pins.json");
  });

  it("is ignored by an installed copy, from npm or inside a bundle", () => {
    for (const root of [
      "/home/u/app/node_modules/@mostra/sdk",
      "/home/u/app/node_modules/.pnpm/@mostra+sdk@0.1.0/node_modules/@mostra/sdk",
      "/home/u/.cache/mostra/bundles/abc/lib/node_modules/@mostra/sdk",
    ]) {
      expect(pinsFile(env, root)).toBe(join(root, "dist", "bundles.json"));
    }
    expect(pinsFile({}, "/work/mostra/packages/sdk")).toBe(
      join("/work/mostra/packages/sdk", "dist", "bundles.json"),
    );
  });
});
