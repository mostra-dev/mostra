import {
  BUNDLE_NAME,
  BUNDLE_PLATFORMS,
  BundleInfo,
  BundlePins,
  BundleSetup,
  bundleAssetName,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);

const info = {
  schemaVersion: 1,
  name: BUNDLE_NAME,
  version: "0.1.0",
  platform: "darwin-arm64",
  node: { version: "24.21.0", path: "node/bin/node" },
  entries: {
    runtime: "lib/node_modules/@mostra/runtime/dist/bin.js",
    cli: "lib/node_modules/@mostra/cli/dist/bin.js",
    setup: "lib/node_modules/@mostra/sdk/dist/setup-main.js",
  },
  files: { path: "files.json", sha256: digest },
  browser: {
    name: "chromium-headless-shell",
    revision: "1248",
    browserVersion: "156.0.8078.4",
    installer: "lib/node_modules/playwright-core/cli.js",
    files: [{ path: "chromium_headless_shell-1248/x", size: 1, sha256: digest, executable: true }],
  },
};

describe("the runtime bundle's contract (RT-01)", () => {
  it("names one archive per release and platform", () => {
    expect(BUNDLE_PLATFORMS).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]);
    expect(bundleAssetName("0.1.0", "linux-arm64")).toBe("mostra-0.1.0-linux-arm64.tar.gz");
  });

  it("reads a bundle.json and refuses one that isn't a bundle's", () => {
    expect(BundleInfo.parse(info)).toEqual(info);
    expect(BundleInfo.safeParse({ ...info, name: "something-else" }).success).toBe(false);
    expect(BundleInfo.safeParse({ ...info, platform: "win32-x64" }).success).toBe(false);
    expect(
      BundleInfo.safeParse({ ...info, files: { path: "/etc/passwd", sha256: digest } }).success,
    ).toBe(false);
    expect(
      BundleInfo.safeParse({ ...info, files: { path: "files.json", sha256: "ABC" } }).success,
    ).toBe(false);
  });

  it("accepts fields later releases add, so an older reader keeps working (D32)", () => {
    expect(BundleInfo.safeParse({ ...info, later: { field: true } }).success).toBe(true);
  });

  it("pins assets by platform under an http(s) release URL", () => {
    const pins = {
      schemaVersion: 1,
      version: "0.1.0",
      release: "https://github.com/mostra-dev/mostra/releases/download/v0.1.0",
      assets: {
        "linux-x64": {
          file: "mostra-0.1.0-linux-x64.tar.gz",
          sha256: digest,
          size: 10,
          unpackedSize: 20,
        },
      },
    };
    expect(BundlePins.parse(pins)).toEqual(pins);
    expect(BundlePins.safeParse({ ...pins, release: "ftp://example.com" }).success).toBe(false);
    expect(
      BundlePins.safeParse({ ...pins, assets: { "freebsd-x64": pins.assets["linux-x64"] } })
        .success,
    ).toBe(false);
    // An asset names an archive, never a path (Opus review finding 8): an installer joins it to
    // a directory. That it is its release's archive for its platform is the installer's check.
    const named = (file: string) =>
      BundlePins.safeParse({
        ...pins,
        assets: { "linux-x64": { ...pins.assets["linux-x64"], file } },
      }).success;
    expect(named("../../escaped.tar.gz")).toBe(false);
    expect(named("dir/mostra-0.1.0-linux-x64.tar.gz")).toBe(false);
    expect(BundlePins.safeParse({ ...pins, version: "../0.1.0" }).success).toBe(false);
  });

  it("records setup with the files digest it verified", () => {
    const marker = {
      schemaVersion: 1,
      version: "0.1.0",
      platform: "linux-x64",
      files: digest,
      browser: { revision: "1248" },
      at: "2026-10-19T00:00:00.000Z",
    };
    expect(BundleSetup.parse(marker)).toEqual(marker);
  });
});
