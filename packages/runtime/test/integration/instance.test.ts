/**
 * One instance per home (RT-06; D81, D82, D85, D87; FAILURE_MODEL §2, §3) through the real
 * `mostra-runtime` binary: racing starters, stale sockets, a vanished socket, stopping, a home
 * removed while running, and the rules for host-spawned instances.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alive,
  connectTo,
  type DaemonStatus,
  eventually,
  initializeParams,
  startDaemon,
  startHost,
  testHome,
} from "../support.ts";

const instanceFile = (home: string): string => join(home, "instance.json");
const record = (home: string): { pid: number; socket: string; mode: string } =>
  JSON.parse(readFileSync(instanceFile(home), "utf8")) as {
    pid: number;
    socket: string;
    mode: string;
  };

async function stopDaemon(socket: string): Promise<void> {
  const client = await connectTo(socket);
  await client.call("mostra/initialize", initializeParams());
  const response = await client.call("mostra/shutdown");
  expect(response.error).toBeUndefined();
  await client.closed;
}

describe("racing starters (RT-06, FAILURE_MODEL §2)", () => {
  it("16 daemons started at once on a fresh home converge on one supervisor, three rounds", async () => {
    for (let round = 0; round < 3; round++) {
      const home = testHome();
      const starters = await Promise.all(Array.from({ length: 16 }, () => startDaemon(home)));
      const statuses = starters.map((starter) => starter.status);
      const started = statuses.filter((status) => status.status === "started");
      const attached = statuses.filter((status) => status.status === "attached");
      expect(started, JSON.stringify(statuses)).toHaveLength(1);
      expect(attached).toHaveLength(15);
      const owner = started[0] as DaemonStatus;
      for (const status of attached)
        expect(status).toMatchObject({ pid: owner.pid, socket: owner.socket });
      // Every loser exited 0 after attaching; only the owner still runs.
      const losers = starters.filter((starter) => starter.status.status === "attached");
      for (const loser of losers) expect((await loser.exited).code).toBe(0);
      expect(
        starters.filter((starter) => alive(starter.child.pid ?? 0)).map((s) => s.child.pid),
      ).toEqual([owner.pid]);
      expect(record(home.home)).toMatchObject({
        pid: owner.pid,
        socket: owner.socket,
        mode: "daemon",
      });
      await stopDaemon(owner.socket ?? "");
      const winner = starters.find((starter) => starter.status.status === "started");
      expect((await winner?.exited)?.code).toBe(0);
      expect(existsSync(owner.socket ?? "")).toBe(false);
      expect(existsSync(instanceFile(home.home))).toBe(false);
    }
  });
});

describe("stale sockets (FAILURE_MODEL §2)", () => {
  it("recovers after a SIGKILL: one of five new starters takes the home, the others attach to it", async () => {
    const home = testHome();
    const first = await startDaemon(home);
    expect(first.status.status).toBe("started");
    first.child.kill("SIGKILL");
    await first.exited;
    // The dead supervisor left its socket file and instance.json behind.
    expect(existsSync(first.status.socket ?? "")).toBe(true);
    expect(record(home.home).pid).toBe(first.status.pid);

    const starters = await Promise.all(Array.from({ length: 5 }, () => startDaemon(home)));
    const started = starters.filter((starter) => starter.status.status === "started");
    expect(started).toHaveLength(1);
    const owner = started[0]?.status as DaemonStatus;
    expect(owner.pid).not.toBe(first.status.pid);
    expect(owner.socket).toBe(first.status.socket);
    for (const starter of starters) {
      if (starter.status.status === "attached") expect(starter.status.pid).toBe(owner.pid);
    }
    const client = await connectTo(owner.socket ?? "");
    const init = await client.call("mostra/initialize", initializeParams());
    expect((init.result as { instance: { pid: number } }).instance.pid).toBe(owner.pid);
    client.close();
    expect(record(home.home).pid).toBe(owner.pid);
    await stopDaemon(owner.socket ?? "");
  });

  it("re-creates its socket when the file disappears, and starters keep attaching meanwhile", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const socket = daemon.status.socket ?? "";
    unlinkSync(socket);
    // Within the 10 s bound (the check runs every 5 s by default).
    await eventually(() => existsSync(socket), 12_000, "the socket to be re-created");
    const again = await startDaemon(home);
    expect(again.status).toMatchObject({ status: "attached", pid: daemon.status.pid });
    await stopDaemon(socket);
    expect((await daemon.exited).code).toBe(0);
  });

  it("finds the owner through instance.json when a starter computes a different runtime directory", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const elsewhere = { ...home.env, MOSTRA_RUNTIME_DIR: join(home.runtimeDir, "..", "other-run") };
    const starter = await startDaemon(home, { env: elsewhere });
    expect(starter.status).toMatchObject({
      status: "attached",
      pid: daemon.status.pid,
      socket: daemon.status.socket,
    });
    await stopDaemon(daemon.status.socket ?? "");
  });

  it("reports MOSTRA_HOME_LOCKED with the owner's PID when the owner's socket stays unreachable", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    // Freeze the owner: it holds the lock but can't answer or re-create its socket.
    unlinkSync(daemon.status.socket ?? "");
    daemon.child.kill("SIGSTOP");
    try {
      const starter = await startDaemon(home, { env: { ...home.env } });
      expect(starter.status.status).toBe("failed");
      expect(starter.status.diagnostic?.code).toBe("MOSTRA_HOME_LOCKED");
      expect(starter.status.diagnostic?.message).toContain(`PID ${daemon.status.pid}`);
      expect((await starter.exited).code).toBe(3);
    } finally {
      daemon.child.kill("SIGCONT");
    }
    daemon.child.kill("SIGTERM");
    expect((await daemon.exited).code).toBe(0);
  }, 60_000);
});

describe("host-spawned instances (D45, D81, D87)", () => {
  it("binds the home socket too, so attached clients reach the same instance, which they can't stop", async () => {
    const home = testHome();
    const host = startHost(home);
    const init = await host.client.call("mostra/initialize", initializeParams());
    const info = (init.result as { instance: { pid: number; mode: string } }).instance;
    expect(info.mode).toBe("host");
    const owner = record(home.home);
    const attached = await connectTo(owner.socket);
    const attachedInit = await attached.call("mostra/initialize", initializeParams());
    expect((attachedInit.result as { instance: { pid: number } }).instance.pid).toBe(info.pid);
    const refused = await attached.call("mostra/shutdown");
    expect(refused.error?.data.code).toBe("MOSTRA_HOST_SHUTDOWN_REFUSED");
    attached.close();
    // The spawning host can stop it.
    expect((await host.client.call("mostra/shutdown")).error).toBeUndefined();
    expect((await host.exited).code).toBe(0);
    expect(existsSync(owner.socket)).toBe(false);
  });

  it("refuses a home another instance owns with MOSTRA_HOME_LOCKED naming its PID, over stdio, exit 3", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const host = startHost(home);
    const response = await host.client.call("mostra/initialize", initializeParams());
    expect(response.error?.data.code).toBe("MOSTRA_HOME_LOCKED");
    expect(response.error?.data.message).toContain(`PID ${daemon.status.pid}`);
    expect((await host.exited).code).toBe(3);
    expect(host.stderr()).toContain("MOSTRA_HOME_LOCKED");
    await stopDaemon(daemon.status.socket ?? "");
  });

  it("stops when the host closes stdio, removing its socket and instance.json", async () => {
    const home = testHome();
    const host = startHost(home);
    await host.client.call("mostra/initialize", initializeParams());
    const socket = record(home.home).socket;
    host.client.close();
    expect((await host.exited).code).toBe(0);
    expect(existsSync(socket)).toBe(false);
    expect(existsSync(instanceFile(home.home))).toBe(false);
  });
});

describe("stopping and failing closed (D87, FAILURE_MODEL §3)", () => {
  it("stops cleanly on SIGTERM and SIGINT", async () => {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const home = testHome();
      const daemon = await startDaemon(home);
      daemon.child.kill(signal);
      expect((await daemon.exited).code).toBe(0);
      expect(existsSync(daemon.status.socket ?? "")).toBe(false);
      expect(existsSync(instanceFile(home.home))).toBe(false);
      // The lock is free again: a new daemon takes the home.
      const next = await startDaemon(home);
      expect(next.status.status).toBe("started");
      await stopDaemon(next.status.socket ?? "");
    }
  });

  it("exits with MOSTRA_HOME_GONE when its home is removed while it runs", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    rmSync(home.home, { recursive: true, force: true });
    const exit = await daemon.exited;
    expect(exit.code).toBe(3);
    expect(daemon.stderr()).toContain("instance.home_gone");
    expect(existsSync(daemon.status.socket ?? "")).toBe(false);
  }, 30_000);

  it("creates the home 0700, tightens an existing one, and refuses one it doesn't own", async () => {
    const home = testHome();
    mkdirSync(home.home, { recursive: true });
    chmodSync(home.home, 0o755);
    const daemon = await startDaemon(home);
    expect(statSync(home.home).mode & 0o777).toBe(0o700);
    expect(statSync(home.runtimeDir).mode & 0o777).toBe(0o700);
    expect(statSync(daemon.status.socket ?? "").mode & 0o777).toBe(0o600);
    expect(statSync(instanceFile(home.home)).mode & 0o777).toBe(0o600);
    expect(daemon.stderr()).toContain("home.tightened");
    await stopDaemon(daemon.status.socket ?? "");

    if (process.getuid?.() !== 0) {
      const foreign = await startDaemon({ ...home, home: "/" });
      expect(foreign.status).toMatchObject({
        status: "failed",
        diagnostic: { code: "MOSTRA_HOME_NOT_OWNED" },
      });
      expect((await foreign.exited).code).toBe(3);
    }
  });

  it("fails closed with MOSTRA_HOME_SOCKET_TOO_LONG before creating the runtime directory or the ledger", async () => {
    const home = testHome();
    const longRun = join(home.runtimeDir, "x".repeat(120));
    const daemon = await startDaemon(home, { env: { ...home.env, MOSTRA_RUNTIME_DIR: longRun } });
    expect(daemon.status.diagnostic?.code).toBe("MOSTRA_HOME_SOCKET_TOO_LONG");
    expect(daemon.status.diagnostic?.hint).toContain("MOSTRA_RUNTIME_DIR");
    expect((await daemon.exited).code).toBe(3);
    expect(existsSync(longRun)).toBe(false);
    expect(existsSync(join(home.home, "store"))).toBe(false);
  });
});
