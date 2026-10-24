/**
 * Worker and daemon lifecycles through a real `mostra-runtime daemon` (WP-08, D62): a worker per
 * active version starts on first need, is evicted after idle, restarts with backoff after a crash
 * and is parked after repeated crashes (RT-03); a crash, an out-of-memory and a hang in one
 * artifact leave the gateway and a sibling artifact serving, with an actionable message (RT-04);
 * the heap and watchdog limits apply, the daemon exits when idle and only then, the login
 * service's unit is written, and leased ports are reused after a restart (RT-08).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helperPath } from "../../src/platform/index.ts";
import { type ActionPage, openPage, type RunState } from "../action-page.ts";
import { send } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import {
  alive,
  commandLineOf,
  connectTo,
  eventually,
  initializeParams,
  runBin,
  suspendProcess,
  tempDir,
  WINDOWS,
} from "../support.ts";

interface Worker {
  artifactId: string;
  versionId: string;
  state: string;
  pid?: number;
  crashes: number;
  lastCause?: string;
  retryAt?: string;
  active: number;
}

async function workersOf(gateway: GatewayHome, versionId: string): Promise<Worker[]> {
  const status = ok<{ workers?: Worker[] }>(await gateway.client.call("instance/status", {}));
  return (status.workers ?? []).filter((worker) => worker.versionId === versionId);
}

describe("worker lifecycles (RT-03, RT-04)", () => {
  const gateway = new GatewayHome();
  let actions: Receipt & { dir: string };
  let sibling: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start({
      env: { MOSTRA_TEST_WORKER_IDLE_MS: "1500", MOSTRA_TEST_WORKER_BACKOFF_MS: "100" },
    });
    actions = await gateway.publish("actions");
    // The same code under another path is another artifact with its own worker.
    sibling = await gateway.publish("actions");
  }, 240_000);

  afterAll(async () => {
    await gateway.stop();
  });

  it("starts a worker on first need, applies the heap limit, and evicts it after idle (RT-03, RT-08)", async () => {
    expect(await workersOf(gateway, actions.versionId)).toEqual([]);
    const page = await openPage(actions.url);
    const pid = (await page.call("actions.ts#pid", [])).value as number;
    const [worker] = await workersOf(gateway, actions.versionId);
    expect(worker).toMatchObject({ state: "ready", pid });
    // The manifest's heap limit (96 MiB) reaches the worker's runtime (D62).
    expect(commandLineOf(pid)).toContain("--max-old-space-size=96");
    // Idle (no call, no producer) for the test's 1.5 s: the worker stops, and the next call
    // starts a new one.
    await eventually(async () => !alive(pid), 10_000, "the idle worker to exit");
    expect((await workersOf(gateway, actions.versionId))[0]?.state).toBe("stopped");
    const next = (await page.call("actions.ts#pid", [])).value as number;
    expect(next).not.toBe(pid);
  });

  it("keeps a worker while a run is in flight, whatever the idle time (D62)", async () => {
    const page = await openPage(actions.url);
    const run = (await page.run("actions.ts#slow", [3500])).json<RunState>();
    const done = await page.settled(run.runId, 15_000);
    expect(done.status).toBe("succeeded");
  });

  const crashes = async (page: ActionPage, fn: string): Promise<RunState> => {
    const run = (await page.run(fn, [])).json<RunState>();
    return page.settled(run.runId, 60_000);
  };

  it.each([
    ["a crash", "actions.ts#crash", "crash", /exited with code 1: .*crashed on purpose/],
    ["an out-of-memory", "actions.ts#oom", "oom", /ran out of memory \(heap limit 96 MiB\)/],
    ["a hang", "actions.ts#hang", "hang", /event loop was blocked .* \(watchdog limit 2 s\)/],
  ])(
    "survives %s in one artifact, with a sibling and the gateway still serving (RT-04)",
    async (_name, fn, kind, cause) => {
      // A publish clears the crashes earlier cases left (FAILURE_MODEL §2).
      ok(await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000));
      const page = await openPage(actions.url);
      const neighbour = await openPage(sibling.url);
      // The sibling is busy throughout, so idle eviction can't explain a new process.
      const busy = (await neighbour.run("actions.ts#slow", [15_000])).json<RunState>();
      const before = (await neighbour.call("actions.ts#pid", [])).value as number;
      const started = Date.now();
      const done = await crashes(page, fn);
      // The run ends interrupted, with a cause the viewer can act on (D24: never retried).
      expect(done).toMatchObject({
        status: "failed",
        reason: "interrupted",
        error: { code: "MOSTRA_ACTION_INTERRUPTED" },
      });
      expect(done.error?.message).toMatch(cause);
      if (kind === "hang") expect(Date.now() - started).toBeLessThan(20_000);
      // The sibling's worker is the same process and still answers; the gateway still serves.
      expect((await neighbour.call("actions.ts#pid", [])).value).toBe(before);
      expect((await neighbour.cancel(busy.runId)).status).toBe(200);
      expect((await neighbour.settled(busy.runId)).status).toBe("cancelled");
      const shell = (await gateway.status()).gateway.shell;
      expect((await send({ url: `${shell}/a/${actions.artifactId}` })).status).toBe(200);
      // `worker.crashed` names the cause and the backoff.
      const events = ok<{ events: { type: string; payload: Record<string, unknown> }[] }>(
        await gateway.client.call("events/read", {
          filter: { artifacts: [actions.artifactId], types: ["worker.crashed"] },
        }),
      ).events;
      expect(events.at(-1)?.payload).toMatchObject({ versionId: actions.versionId, kind });
      // The artifact's next call starts a fresh worker after the backoff.
      expect((await page.call("actions.ts#echo", ["again"])).end).toEqual({ status: "succeeded" });
    },
    90_000,
  );

  it("stops a worker that stops answering at all, after three silent watchdog periods (RT-04)", async () => {
    ok(await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000));
    const page = await openPage(actions.url);
    const pid = (await page.call("actions.ts#pid", [])).value as number;
    const { cursor } = ok<{ cursor: string }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId] },
        limit: 1000,
      }),
    );
    // A run in flight, so idle eviction can't be what ends the worker.
    const busy = (await page.run("actions.ts#slow", [60_000])).json<RunState>();
    // A stopped process answers nothing, not even through its channel thread (SIGSTOP; on
    // Windows every thread suspended).
    suspendProcess(pid, true);
    const started = Date.now();
    let crash: Record<string, unknown> | undefined;
    await eventually(async () => {
      crash = ok<{ events: { payload: Record<string, unknown> }[] }>(
        await gateway.client.call("events/read", {
          filter: { artifacts: [actions.artifactId], types: ["worker.crashed"] },
          after: cursor,
        }),
      ).events[0]?.payload;
      return crash !== undefined;
    }, 30_000);
    // Three periods of the 2 s limit: one missed ping alone (a large result ahead of it) is no hang.
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_000);
    expect(crash).toMatchObject({
      kind: "hang",
      cause: expect.stringMatching(/answered nothing for/),
    });
    expect(await page.settled(busy.runId)).toMatchObject({
      status: "failed",
      reason: "interrupted",
    });
    const next = (await page.call("actions.ts#pid", [])).value as number;
    expect(next).not.toBe(pid);
  }, 90_000);

  it("ends a run cancelled at once while its worker backs off, never waiting for it (AC-04)", async () => {
    ok(await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000));
    const page = await openPage(actions.url);
    // Five crashes: the next start waits 1.6 s (100 ms doubling, D133).
    for (let i = 0; i < 5; i++) await crashes(page, "actions.ts#crash");
    const run = (await page.run("actions.ts#echo", ["late"])).json<RunState>();
    expect(run.status).toBe("queued");
    const asked = Date.now();
    expect((await page.cancel(run.runId)).json<RunState>().status).toBe("cancelled");
    expect(Date.now() - asked).toBeLessThan(1000);
    // It stays cancelled once the worker is back: the action never ran.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await page.settled(run.runId)).status).toBe("cancelled");
    // A publish clears the crashes for the tests after this one.
    ok(await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000));
  }, 90_000);

  it("backs off after each crash and parks a worker that keeps crashing, until a publish (RT-03)", async () => {
    ok(await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000));
    const page = await openPage(actions.url);
    // A live source the page shows: its producer runs in the same worker.
    type Source = { revision?: string; error?: { code: string } };
    const counter = async (): Promise<Source> =>
      (await page.live([{ key: "counter" }])).json<{ sources: Source[] }>().sources[0] as Source;
    await eventually(async () => (await counter()).revision !== undefined, 20_000);
    // Every event so far, read to the end: the crashes below come after this cursor.
    const { cursor } = ok<{ cursor: string }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId] },
        limit: 1000,
      }),
    );
    for (let i = 0; i < 6; i++) {
      const done = await crashes(page, "actions.ts#crash");
      expect(done.error?.code).toBe("MOSTRA_ACTION_INTERRUPTED");
      if (i < 5) expect((await workersOf(gateway, actions.versionId))[0]?.state).toBe("backoff");
    }
    // Each backoff doubles (100 ms first in this test; 1 s to 60 s by default); the sixth crash
    // in ten minutes parks the worker.
    const crashed = ok<{ events: { payload: { backoffMs: number; parked: boolean } }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId], types: ["worker.crashed"] },
        after: cursor,
      }),
    ).events.map((event) => event.payload);
    expect(crashed.map((entry) => [entry.backoffMs, entry.parked])).toEqual([
      [100, false],
      [200, false],
      [400, false],
      [800, false],
      [1600, false],
      [0, true],
    ]);
    // A page sees that the server code crashed and is parked, never its output (Opus review 4).
    const seen = (await page.poll(cursor))
      .json<{
        events: { type: string; payload: Record<string, unknown> }[];
      }>()
      .events.filter((event) => event.type === "worker.crashed");
    expect(seen).toHaveLength(6);
    expect(seen.at(-1)?.payload).toMatchObject({ versionId: actions.versionId, parked: true });
    expect(JSON.stringify(seen)).not.toContain("crashed on purpose");
    expect(seen.every((event) => !("cause" in event.payload))).toBe(true);
    const [worker] = await workersOf(gateway, actions.versionId);
    expect(worker).toMatchObject({ state: "parked", crashes: 6 });
    expect(worker?.lastCause).toMatch(/crashed on purpose/);
    // Parked: calls and runs are refused with the cause, at once.
    const call = await page.call("actions.ts#echo", []);
    expect(call.status).toBe(503);
    expect(JSON.parse(call.body)).toMatchObject({ code: "MOSTRA_RUNTIME_WORKER_PARKED" });
    const run = (await page.run("actions.ts#echo", [])).json<RunState>();
    expect(await page.settled(run.runId)).toMatchObject({
      status: "failed",
      reason: "parked",
      error: { code: "MOSTRA_RUNTIME_WORKER_PARKED" },
    });
    // The sibling is untouched.
    expect((await (await openPage(sibling.url)).call("actions.ts#echo", [])).end).toEqual({
      status: "succeeded",
    });
    // The shell is told on its next frame ticket, so it says the server code keeps crashing.
    const ticket = async (): Promise<{ serverParked?: boolean }> =>
      (
        await page.browser.fetchJson(
          page.opened.link.shell,
          `/a/${actions.artifactId}/_mostra/ticket`,
          { body: {}, csrf: page.opened.shellCsrf },
        )
      ).json<{ serverParked?: boolean }>();
    expect((await ticket()).serverParked).toBe(true);
    // The live source says why it stopped.
    await eventually(
      async () => (await counter()).error?.code === "MOSTRA_RUNTIME_WORKER_PARKED",
      20_000,
    );
    const stoppedAt = Number((await counter()).revision);
    // The next publish clears the park (FAILURE_MODEL §2), also when it reuses the version: calls
    // work again, and so do the live producers (GPT review finding 7).
    const again = ok<{ versionId: string; reused: boolean }>(
      await gateway.client.call("artifact/publish", { source: { path: actions.dir } }, 120_000),
    );
    expect(again).toMatchObject({ versionId: actions.versionId, reused: true });
    expect((await page.call("actions.ts#echo", ["back"])).end).toEqual({ status: "succeeded" });
    expect((await ticket()).serverParked).toBeUndefined();
    await eventually(async () => {
      const now = await counter();
      return Number(now.revision) > stoppedAt && now.error === undefined;
    }, 20_000);
  }, 120_000);
});

describe("the daemon's lifecycle (RT-08)", () => {
  it("exits after its idle time when nothing needs it, and stays while a run is in flight", async () => {
    const gateway = new GatewayHome();
    await gateway.start({ env: { MOSTRA_TEST_IDLE_EXIT_MS: "2000" } });
    const actions = await gateway.publish("actions");
    const page = await openPage(actions.url);
    const run = (await page.run("actions.ts#slow", [60_000])).json<RunState>();
    await eventually(async () => {
      const state = (await page.attach({ runIds: [run.runId] })).json<{ runs: RunState[] }>();
      return state.runs[0]?.status === "running";
    });
    // No client is attached now; the run still needs the daemon.
    gateway.client.close();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(gateway.daemon.child.exitCode).toBeNull();
    // `instance/status` says no exit is due while it's busy.
    const client = await connectTo(gateway.daemon.status.socket as string);
    ok(await client.call("mostra/initialize", initializeParams()));
    const busy = ok<{ idleExitAt?: string }>(await client.call("instance/status", {}));
    expect(busy.idleExitAt).toBeUndefined();
    client.close();
    expect((await page.cancel(run.runId)).status).toBe(200);
    // Nothing left: it exits on its own, cleanly.
    const exit = await Promise.race([
      gateway.daemon.exited,
      new Promise((resolve) => setTimeout(() => resolve("still running"), 15_000)),
    ]);
    expect(exit).toEqual({ code: 0, signal: null });
  }, 120_000);

  it("never exits for lack of work when started always-on, as the login service runs it", async () => {
    const gateway = new GatewayHome();
    await gateway.start({ env: { MOSTRA_TEST_IDLE_EXIT_MS: "1000" }, args: ["--always-on"] });
    gateway.client.close();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(gateway.daemon.child.exitCode).toBeNull();
    await gateway.stop();
  }, 60_000);

  it("never exits for lack of work while its home has a login service, whoever started it (D133)", async () => {
    const gateway = new GatewayHome();
    const user = tempDir("svc-idle", true);
    const env = {
      HOME: user,
      XDG_CONFIG_HOME: join(user, ".config"),
      MOSTRA_TEST_IDLE_EXIT_MS: "1000",
    };
    // The service's file, written without starting it: this daemon was started by hand.
    const installed = runBin(["service", "install", "--home", gateway.home.home, "--no-start"], {
      ...process.env,
      ...env,
    });
    expect((await installed.exited).code).toBe(0);
    await gateway.start({ env });
    gateway.client.close();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(gateway.daemon.child.exitCode).toBeNull();
    // Without the service, the same daemon exits once idle.
    const removed = runBin(["service", "uninstall", "--home", gateway.home.home, "--no-start"], {
      ...process.env,
      ...env,
    });
    expect((await removed.exited).code).toBe(0);
    await eventually(() => gateway.daemon.child.exitCode !== null, 15_000);
  }, 60_000);

  it("reuses the artifact's leased port after a restart", async () => {
    const gateway = new GatewayHome();
    await gateway.start();
    const actions = await gateway.publish("actions");
    const first = await openPage(actions.url);
    await gateway.stop();
    await gateway.start();
    const second = await openPage(actions.url);
    expect(second.opened.frameOrigin).toBe(first.opened.frameOrigin);
    expect((await second.call("actions.ts#echo", [])).end).toEqual({ status: "succeeded" });
    await gateway.stop();
  }, 120_000);

  it("writes and removes the home's login service unit (`mostra daemon install`)", async () => {
    const home = tempDir("svc-home", true);
    const user = tempDir("svc-user", true);
    const env = { ...process.env, HOME: user, XDG_CONFIG_HOME: join(user, ".config") };
    const run = async (action: string) => {
      const child = runBin(["service", action, "--home", home, "--no-start"], env);
      let out = "";
      child.child.stdout?.setEncoding("utf8");
      child.child.stdout?.on("data", (chunk: string) => {
        out += chunk;
      });
      expect((await child.exited).code).toBe(0);
      return JSON.parse(out) as {
        status: string;
        service: {
          manager: string;
          file: string;
          installed: boolean;
          command: string[];
          current?: boolean;
        };
      };
    };
    const installed = await run("install");
    expect(installed.service.installed).toBe(true);
    // Task Scheduler's definitions are UTF-16 with a byte order mark.
    const text = WINDOWS
      ? readFileSync(installed.service.file, "utf16le").replace(/^\ufeff/, "")
      : readFileSync(installed.service.file, "utf8");
    expect(installed.service.command).toContain("--always-on");
    expect(text).toContain("--always-on");
    expect(text).toContain(realpathSync(home));
    if (WINDOWS) {
      expect(installed.service.manager).toBe("task-scheduler");
      expect(installed.service.file).toMatch(/\\service\\task\.xml$/);
      expect(text).toContain("<LogonTrigger>");
      expect(text).toContain("<LogonType>InteractiveToken</LogonType>");
      expect(text).toContain("mostra-win-service.exe</Command>");
    } else if (process.platform === "darwin") {
      expect(installed.service.manager).toBe("launchd");
      expect(installed.service.file).toMatch(
        /Library\/LaunchAgents\/dev\.mostra\.daemon\.[0-9A-Z]{16}\.plist$/,
      );
      expect(text).toContain("<key>RunAtLoad</key>");
      execFileSync("plutil", ["-lint", installed.service.file]);
    } else {
      expect(installed.service.manager).toBe("systemd");
      expect(installed.service.file).toMatch(
        /\.config\/systemd\/user\/mostra-[0-9a-z]{16}\.service$/,
      );
      expect(text).toContain("Restart=on-failure");
      expect(text).toContain("WantedBy=default.target");
    }
    // Nothing secret is in it: only the allowlisted environment.
    expect(text).not.toMatch(/TOKEN|SECRET|KEY/);
    expect((await run("status")).service).toMatchObject({ installed: true, current: true });
    const removed = await run("uninstall");
    expect(removed.service.installed).toBe(false);
    expect(existsSync(installed.service.file)).toBe(false);
  }, 60_000);
});

/** The `Subsystem` field of a Windows executable's PE header: 2 is a program without a console. */
function peSubsystem(path: string): number {
  const bytes = readFileSync(path);
  const header = bytes.readUInt32LE(0x3c);
  // The optional header follows the 4-byte signature and the 20-byte file header; its
  // `Subsystem` is at offset 68 in both PE32 and PE32+.
  return bytes.readUInt16LE(header + 4 + 20 + 68);
}

/** Every line of the home's own logs (its `logs` directory), parsed. */
function logLines(home: string): { event?: string; reason?: string; code?: number }[] {
  const dir = join(home, "logs");
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as { event?: string; reason?: string; code?: number }];
        } catch {
          return [];
        }
      }),
  );
}

describe.runIf(WINDOWS)("the login service on Windows (RT-11, D151)", () => {
  it("runs the daemon from a logon task without a window, restarts it after a crash, and leaves nothing behind when removed", async () => {
    const home = realpathSync(tempDir("svc-win", true));
    const run = async (action: string) => {
      const child = runBin(["service", action, "--home", home], process.env);
      let out = "";
      child.child.stdout?.setEncoding("utf8");
      child.child.stdout?.on("data", (chunk: string) => {
        out += chunk;
      });
      const exited = await child.exited;
      expect(exited.code, out).toBe(0);
      return JSON.parse(out) as {
        service: { name: string; file: string; installed: boolean; command: string[] };
      };
    };
    const record = (): { pid: number; socket: string } | undefined => {
      try {
        return JSON.parse(readFileSync(join(home, "instance.json"), "utf8")) as {
          pid: number;
          socket: string;
        };
      } catch {
        return undefined;
      }
    };
    const installed = await run("install");
    const { name } = installed.service;
    try {
      // Task Scheduler holds a task for this user's own logon, at the least privilege.
      const user = (
        JSON.parse(
          execFileSync(helperPath(), ["whoami"], { encoding: "utf8", windowsHide: true }),
        ) as { result: { user: string } }
      ).result.user;
      const task = execFileSync("schtasks", ["/Query", "/TN", name, "/XML"], {
        encoding: "utf8",
        windowsHide: true,
      });
      // Task Scheduler keeps the principal as the SID it was given, writes the trigger's user as
      // `COMPUTER\name`, and leaves out a run level at its default, the least privilege (seen on
      // the runners).
      const principal = /<Principal id="Author">([\s\S]*?)<\/Principal>/.exec(task)?.[1] ?? "";
      expect(principal).toContain(`<UserId>${user}</UserId>`);
      expect(principal).toContain("<LogonType>InteractiveToken</LogonType>");
      expect(task).not.toContain("HighestAvailable");
      const trigger = /<LogonTrigger>([\s\S]*?)<\/LogonTrigger>/.exec(task)?.[1] ?? "";
      const account = `${process.env["COMPUTERNAME"] ?? ""}\\${process.env["USERNAME"] ?? ""}`;
      expect(
        trigger.includes(`<UserId>${user}</UserId>`) ||
          trigger.toLowerCase().includes(`<userid>${account.toLowerCase()}</userid>`),
        trigger,
      ).toBe(true);
      // Its program has no console, so a logon opens no window for it.
      const launcher = installed.service.command[0] as string;
      expect(launcher).toMatch(/mostra-win-service\.exe$/);
      expect(peSubsystem(launcher)).toBe(2);
      // `install` started it: the home's daemon runs, always-on, as the launcher's child.
      await eventually(
        () => {
          const now = record();
          return now !== undefined && alive(now.pid);
        },
        60_000,
        "the task's daemon",
      );
      const first = record() as { pid: number; socket: string };
      expect(commandLineOf(first.pid)).toContain("--always-on");
      const client = await connectTo(first.socket);
      ok(await client.call("mostra/initialize", initializeParams()));
      const status = ok<{ idleExitAt?: string }>(await client.call("instance/status", {}));
      expect(status.idleExitAt).toBeUndefined();
      client.close();
      // A crash (the daemon killed outright): the launcher starts it again 10 s later.
      process.kill(first.pid);
      await eventually(
        () => {
          const now = record();
          return now !== undefined && now.pid !== first.pid && alive(now.pid);
        },
        60_000,
        "the daemon started again",
      );
      const second = record() as { pid: number; socket: string };
      // `uninstall` stops it cleanly (Ctrl+Break, D87): it removes `instance.json` as it exits,
      // which a killed daemon never does, and the task and its definition are gone.
      const removed = await run("uninstall");
      expect(removed.service.installed).toBe(false);
      await eventually(() => !alive(second.pid), 30_000, "the daemon to stop");
      expect(existsSync(join(home, "instance.json"))).toBe(false);
      expect(existsSync(installed.service.file)).toBe(false);
      expect(() =>
        execFileSync("schtasks", ["/Query", "/TN", name], { stdio: "ignore", windowsHide: true }),
      ).toThrow();
      const lines = logLines(home);
      expect(lines.some((line) => line.event === "service.daemon_exited" && line.code !== 0)).toBe(
        true,
      );
      expect(lines.some((line) => line.event === "service.stopped")).toBe(true);
      expect(
        lines.some((line) => line.event === "instance.stopped" && line.reason === "SIGBREAK"),
      ).toBe(true);
      expect(lines.some((line) => line.event === "service.stop_forced")).toBe(false);
    } finally {
      try {
        execFileSync("schtasks", ["/Delete", "/TN", name, "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        // Already gone.
      }
    }
  }, 180_000);
});
