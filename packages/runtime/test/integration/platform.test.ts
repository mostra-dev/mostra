/**
 * The unsupported-platform gate (RT-07, D35): every entry point of the real binary fails closed
 * with MOSTRA_PLATFORM_UNSUPPORTED before it touches the home. The platform is simulated by
 * preloading `test/fixtures/platform.mjs`, which overrides `process.platform` and `process.arch`.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  initializeParams,
  shutdownDaemon,
  startDaemon,
  startHost,
  testHome,
  WINDOWS,
} from "../support.ts";

/** The test home's environment without the development switch that admits Windows (D146). */
const withoutSwitch = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { MOSTRA_DEV_WINDOWS: _switch, ...rest } = env;
  return rest;
};

// A file URL: Node.js on Windows takes no drive path for --import.
const preload = ["--import", new URL("../fixtures/platform.mjs", import.meta.url).href];

describe.each([
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
  { platform: "freebsd", arch: "x64" },
  { platform: "linux", arch: "ia32" },
])("on $platform-$arch", ({ platform, arch }) => {
  const simulated = (home: ReturnType<typeof testHome>) => ({
    env: { ...withoutSwitch(home.env), MOSTRA_TEST_PLATFORM: platform, MOSTRA_TEST_ARCH: arch },
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

// Windows itself, without the switch, fails closed like any unsupported platform (D146).
describe.runIf(WINDOWS)("on Windows without MOSTRA_DEV_WINDOWS", () => {
  it("every entry point fails closed before touching the home", async () => {
    const home = testHome();
    const daemon = await startDaemon(home, { env: withoutSwitch(home.env) });
    expect(daemon.status).toMatchObject({
      status: "failed",
      diagnostic: { code: "MOSTRA_PLATFORM_UNSUPPORTED" },
    });
    expect((await daemon.exited).code).toBe(3);
    expect(existsSync(home.home)).toBe(false);
    const host = startHost(home, { env: withoutSwitch(home.env) });
    const response = await host.client.call("mostra/initialize", initializeParams());
    expect(response.error?.data.code).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
    expect((await host.exited).code).toBe(3);
    expect(existsSync(home.home)).toBe(false);
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
    await shutdownDaemon(daemon.status.socket ?? "");
    expect((await daemon.exited).code).toBe(0);
  });
});
