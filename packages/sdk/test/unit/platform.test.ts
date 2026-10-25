import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheRoot } from "../../src/bundle/cache.ts";
import { bundlePlatform, glibcRuntime } from "../../src/platform.ts";
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

describe("which bundle a machine takes (RT-07, RT-12, D146)", () => {
  it("takes Windows on x64 and arm64 like macOS and glibc Linux", () => {
    expect(bundlePlatform({ platform: "win32", arch: "x64" })).toBe("win32-x64");
    expect(bundlePlatform({ platform: "win32", arch: "arm64" })).toBe("win32-arm64");
    expect(bundlePlatform({ platform: "darwin", arch: "arm64" })).toBe("darwin-arm64");
    expect(bundlePlatform({ platform: "linux", arch: "x64", glibc: "2.39" })).toBe("linux-x64");
  });

  it("fails closed on every other platform, before any download", () => {
    for (const facts of [
      { platform: "win32", arch: "ia32" },
      { platform: "freebsd", arch: "x64" },
      { platform: "linux", arch: "ia32", glibc: "2.39" },
      { platform: "linux", arch: "x64" },
      { platform: "aix", arch: "ppc64" },
    ]) {
      expect(() => bundlePlatform(facts), JSON.stringify(facts)).toThrow(
        expect.objectContaining({
          diagnostic: expect.objectContaining({ code: "MOSTRA_PLATFORM_UNSUPPORTED" }),
        }),
      );
    }
  });
});

describe("the bundle cache's directory", () => {
  it("is %LOCALAPPDATA%\\mostra-cache on Windows, beside the home", () => {
    expect(cacheRoot({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32")).toBe(
      "C:\\Users\\a\\AppData\\Local\\mostra-cache",
    );
    expect(cacheRoot({ USERPROFILE: "C:\\Users\\a" }, "win32")).toBe(
      "C:\\Users\\a\\AppData\\Local\\mostra-cache",
    );
    expect(cacheRoot({ HOME: "/Users/a" }, "darwin")).toBe("/Users/a/Library/Caches/mostra");
    expect(cacheRoot({ HOME: "/home/a" }, "linux")).toBe("/home/a/.cache/mostra");
  });
});
