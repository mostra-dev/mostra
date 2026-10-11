/**
 * The unsupported-platform gate (RT-07, D35): every entry point of the real binary fails closed
 * with MOSTRA_PLATFORM_UNSUPPORTED before it touches the home. The platform is simulated by
 * preloading `test/fixtures/platform.mjs`, which overrides `process.platform` and `process.arch`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initializeParams, startDaemon, startHost, testHome } from "../support.ts";

const preload = ["--import", fileURLToPath(new URL("../fixtures/platform.mjs", import.meta.url))];

describe.each([
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
  { platform: "freebsd", arch: "x64" },
  { platform: "linux", arch: "ia32" },
])("on $platform-$arch", ({ platform, arch }) => {
  const simulated = (home: ReturnType<typeof testHome>) => ({
    env: { ...home.env, MOSTRA_TEST_PLATFORM: platform, MOSTRA_TEST_ARCH: arch },
    nodeArgs: preload,
  });

  it("mostra-runtime daemon fails closed before touching the home or the runtime directory", async () => {
    const home = testHome();
    const daemon = await startDaemon(home, simulated(home));
    expect(daemon.status).toMatchObject({
      status: "failed",
      diagnostic: { code: "MOSTRA_PLATFORM_UNSUPPORTED" },
    });
    expect(daemon.status.diagnostic?.message).toContain(`${platform}-${arch}`);
    expect((await daemon.exited).code).toBe(3);
    expect(existsSync(home.home)).toBe(false);
    expect(existsSync(home.runtimeDir)).toBe(false);
  });

  it("mostra-runtime host answers the host's first request with the diagnostic and exits 3", async () => {
    const home = testHome();
    const host = startHost(home, simulated(home));
    const response = await host.client.call("mostra/initialize", initializeParams());
    expect(response.error).toMatchObject({
      code: -32000,
      data: { code: "MOSTRA_PLATFORM_UNSUPPORTED" },
    });
    expect((await host.exited).code).toBe(3);
    expect(host.stderr()).toContain("MOSTRA_PLATFORM_UNSUPPORTED");
    expect(existsSync(home.home)).toBe(false);
    expect(existsSync(home.runtimeDir)).toBe(false);
  });
});

describe("on this platform", () => {
  it("the same preload reporting the real platform starts normally", async () => {
    const home = testHome();
    const daemon = await startDaemon(home, {
      env: { ...home.env, MOSTRA_TEST_PLATFORM: process.platform, MOSTRA_TEST_ARCH: process.arch },
      nodeArgs: preload,
    });
    expect(daemon.status.status).toBe("started");
    daemon.child.kill("SIGTERM");
    expect((await daemon.exited).code).toBe(0);
  });
});
