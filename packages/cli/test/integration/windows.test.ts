/**
 * The CLI on Windows (RT-11, D151): it reaches its daemon's pipe only through the helper, which
 * refuses a pipe another user created under the name a stale `instance.json` still names (D150
 * item 4, WP-W1's Opus review): a plain `net.connect` would hand that user the CLI's requests.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectControl } from "@mostra/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cli,
  envelope,
  probePath,
  type TestHome,
  testHome,
  WINDOWS,
  windowsHelper,
} from "../support.ts";

describe.runIf(WINDOWS)("the CLI on Windows (RT-11)", () => {
  let home: TestHome;
  let squatter: ChildProcess | undefined;
  let pipe = "";
  let baselineMs = 0;

  beforeAll(async () => {
    home = testHome();
    // How long `daemon status` takes where no daemon ever ran, the yardstick for the last test.
    baselineMs = (await cli(["daemon", "status", "--json"], { env: home.env })).ms;
    const started = envelope(await cli(["daemon", "start", "--json"], { env: home.env }));
    expect(started.ok).toBe(true);
    const record = JSON.parse(readFileSync(join(home.home, "instance.json"), "utf8")) as {
      pid: number;
      socket: string;
    };
    pipe = record.socket;
    expect(pipe).toMatch(/^\\\\\.\\pipe\\mostra-/);
    // The daemon dies without cleaning up, as a crash or a power cut leaves it: `instance.json`
    // still names its pipe, whose name is free now, and another local user takes it.
    process.kill(record.pid);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    squatter = spawn(
      probePath(),
      [
        "squat",
        process.env["MOSTRA_TEST_OTHER_USER"] ?? "",
        process.env["MOSTRA_TEST_OTHER_PASSWORD"] ?? "",
        pipe.slice("\\\\.\\pipe\\".length),
      ],
      { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
    );
    const [line] = (await once(squatter.stdout as NodeJS.ReadableStream, "data")) as [Buffer];
    expect(JSON.parse(line.toString("utf8"))).toMatchObject({ ok: true });
  });

  afterAll(async () => {
    if (squatter) {
      squatter.stdin?.end();
      await once(squatter, "exit");
    }
    await home.cleanup();
  });

  it("refuses a pipe another user took, before a byte is sent (connectControl)", async () => {
    const refused = await connectControl(pipe, {
      env: { MOSTRA_WIN_HELPER: windowsHelper() },
      timeoutMs: 5000,
    }).then(
      () => undefined,
      (error: unknown) => error as { diagnostic?: { code: string; message: string } },
    );
    expect(refused?.diagnostic?.code).toBe("MOSTRA_HOST_CONNECTION_CLOSED");
    expect(refused?.diagnostic?.message).toContain("another user");
  });

  it("finds no daemon there, at once, instead of talking to that user's pipe", async () => {
    // A client that talked to the pipe would send its `mostra/initialize` and wait its 5 s for an
    // answer; the CLI is refused before it sends anything, so it takes about as long as where no
    // daemon ever ran.
    const ran = await cli(["daemon", "status", "--json"], { env: home.env });
    const value = envelope(ran);
    expect(value.result).toMatchObject({ running: false });
    expect(ran.ms - baselineMs).toBeLessThan(2500);
  });
});
