/**
 * The process manager with real children (RT-09, ARCHITECTURE §4): process groups, records in the
 * ledger, typed IPC both ways, stopping a child with its grandchildren, and adoption rules.
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { type Log, openFileLog, Redactor, silentLog } from "../../src/log.ts";
import { bootId, readProcess } from "../../src/processes/identity.ts";
import {
  listProcesses,
  openProcessManager,
  type ProcessManager,
} from "../../src/processes/index.ts";
import { alive, eventually, tempDir } from "../support.ts";

let ledger: Ledger | undefined;
let manager: ProcessManager | undefined;
afterEach(async () => {
  await manager?.stopAll(500);
  ledger?.close();
  manager = undefined;
  ledger = undefined;
});

function openStore(storeDir = join(tempDir("mpm"), "store")): Ledger {
  const opening = openLedger({
    storeDir,
    runtimeVersion: "0.0.0",
    owner: { pid: process.pid, startTime: "b/1" },
    log: silentLog,
  });
  if (!opening.ok) throw new Error("locked");
  return opening.ledger;
}

async function open(
  log: Log = silentLog,
  redactor: Redactor = new Redactor(),
): Promise<{ ledger: Ledger; manager: ProcessManager }> {
  ledger = openStore();
  manager = (await openProcessManager({ ledger, log, redactor })).manager;
  return { ledger, manager };
}

const rows = (target: Ledger) =>
  target.read((db) =>
    db.all<{ pid: number; kind: string; pgid: number; parent_pid: number | null }>(
      "SELECT * FROM child",
    ),
  );

describe("children", () => {
  it("run as process group leaders, are recorded, and leave no row or process after they stop", async () => {
    const { ledger, manager } = await open();
    const child = await manager.spawn({
      kind: "demo",
      ownerRef: "art_x",
      command: "/bin/sh",
      args: ["-c", "sleep 600 & sleep 600 & echo started >&2; wait"],
    });
    await eventually(
      async () => (await listProcesses()).filter((p) => p.pgid === child.pid).length === 3,
      5000,
      "three group members",
    );
    expect(rows(ledger)).toMatchObject([
      { pid: child.pid, kind: "demo", pgid: child.pid, parent_pid: null },
    ]);
    expect(manager.list()).toMatchObject([{ pid: child.pid, kind: "demo", ownerRef: "art_x" }]);
    const members = (await listProcesses()).filter((p) => p.pgid === child.pid).map((p) => p.pid);

    const exit = await child.stop(1000);
    expect(exit.signal ?? exit.code).toBeTruthy();
    expect(exit.stderrTail).toContain("started");
    // Killed grandchildren are re-parented and reaped by init, so they may linger as zombies for
    // a moment after the group is signalled.
    for (const pid of members)
      await eventually(() => !alive(pid), 2000, `process ${pid} to disappear`);
    expect(rows(ledger)).toEqual([]);
    expect(manager.list()).toEqual([]);
  });

  it("take down their group when they exit on their own", async () => {
    const { manager } = await open();
    const file = join(tempDir("mpm"), "grandchild");
    const child = await manager.spawn({
      kind: "demo",
      ownerRef: "x",
      command: "/bin/sh",
      args: ["-c", `sleep 600 & echo $! > ${file}; sleep 1`],
    });
    await eventually(
      () => existsSync(file) && readFileSync(file, "utf8").endsWith("\n"),
      5000,
      "the grandchild's PID",
    );
    const grandchild = Number(readFileSync(file, "utf8"));
    expect(alive(grandchild)).toBe(true);
    expect((await child.exited).code).toBe(0);
    await eventually(() => !alive(grandchild), 2000, "the grandchild to disappear");
  });

  it("exchange typed JSON-RPC requests both ways over IPC, and adopt only group leaders", async () => {
    const { ledger, manager } = await open();
    const asked: string[] = [];
    const child = await manager.spawn({
      kind: "pty-host",
      ownerRef: "pty",
      command: process.execPath,
      args: [fileURLToPath(new URL("../fixtures/pty-host.mjs", import.meta.url))],
      ipc: {
        onRequest: (method) => {
          asked.push(method);
          return {};
        },
      },
    });
    const started = (await child.request("start", {}, { timeoutMs: 10_000 })) as {
      pid: number;
      adopted: boolean;
    };
    expect(started.adopted).toBe(true);
    expect(rows(ledger).find((row) => row.pid === started.pid)).toMatchObject({
      kind: "pty-host/adopted",
      pgid: started.pid,
      parent_pid: child.pid,
    });
    // The child's own requests reach the supervisor's handler.
    expect(await child.request("ask", { n: 1 }, { timeoutMs: 5000 })).toEqual({});
    expect(asked).toEqual(["custom/hello"]);
    // A process that doesn't lead its own group (here, the test runner's own child) is refused:
    // adopting it would signal a group the supervisor doesn't own.
    const sleeper = spawn("/bin/sh", ["-c", "sleep 600"], { stdio: "ignore" });
    await once(sleeper, "spawn");
    expect(await child.request("adopt", { pid: sleeper.pid }, { timeoutMs: 5000 })).toEqual({
      adopted: false,
    });
    sleeper.kill("SIGKILL");
    await expect(child.request("nope", {}, { timeoutMs: 5000 })).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_HOST_INTERNAL_ERROR" },
    });
    // Stopping the PTY host also ends the program it adopted.
    await child.stop(1000);
    await eventually(() => !alive(started.pid), 2000, "the adopted program to disappear");
    expect(rows(ledger)).toEqual([]);
  });
});

describe("review findings (D80)", () => {
  it("redacts secrets and capability parameters from child output in the log and the stderr tail (finding 1)", async () => {
    const logs = tempDir("mpm-log");
    const redactor = new Redactor();
    const { manager } = await open(openFileLog({ dir: logs, redactor }), redactor);
    const child = await manager.spawn({
      kind: "demo",
      ownerRef: "x",
      command: "/bin/sh",
      args: [
        "-c",
        'echo "token $MY_API_TOKEN and $EXPLICIT"; echo "url http://localhost:1/?t=capability-secret-1 $MY_API_TOKEN" >&2',
      ],
      env: {
        PATH: "/usr/bin:/bin",
        MY_API_TOKEN: "tok-0123456789",
        EXPLICIT: "explicit-secret-42",
      },
      redact: ["explicit-secret-42"],
    });
    const exit = await child.exited;
    const log = readFileSync(join(logs, "supervisor.log"), "utf8");
    expect(log).toContain("[redacted]");
    for (const secret of ["tok-0123456789", "explicit-secret-42", "capability-secret-1"]) {
      expect(log).not.toContain(secret);
      expect(exit.stderrTail.join("\n")).not.toContain(secret);
    }
    expect(exit.stderrTail.join("\n")).toContain("?t=[redacted]");
  });

  it("ends a child it couldn't record, instead of leaving it untracked (finding 2)", async () => {
    const { ledger, manager } = await open();
    ledger.close();
    // A unique duration marks the child, which may be stopped before it could report anything.
    const marker = `600.${process.pid}${Date.now() % 100_000}`;
    const running = (): boolean =>
      spawnSync("/usr/bin/pgrep", ["-f", `^sleep ${marker}$`], {
        encoding: "utf8",
      }).stdout.trim() !== "";
    await expect(
      manager.spawn({
        kind: "demo",
        ownerRef: "x",
        command: "/bin/sh",
        args: ["-c", `exec sleep ${marker}`],
      }),
    ).rejects.toThrow();
    // Give a surviving child time to reach `sleep`, so its absence means it was stopped.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await eventually(() => !running(), 5000, "the unrecorded child to be stopped");
    expect(manager.list()).toEqual([]);
  });

  it("stops a child whose spawn was still in progress when stopAll began (finding 3)", async () => {
    const { manager } = await open();
    const spawning = manager.spawn({
      kind: "demo",
      ownerRef: "x",
      command: "/bin/sh",
      args: ["-c", "sleep 600"],
    });
    const stopping = manager.stopAll(500);
    const child = await spawning;
    await stopping;
    await eventually(() => !alive(child.pid), 5000, "the in-flight child to be stopped");
    await expect(
      manager.spawn({ kind: "demo", ownerRef: "x", command: "/usr/bin/true" }),
    ).rejects.toThrow("stopping");
  });

  it("reaps a process a recorded group starts while handling SIGTERM (finding 4)", async () => {
    const storeDir = join(tempDir("mpm"), "store");
    const lateFile = join(tempDir("mpm"), "late");
    // A leader that, on SIGTERM, starts a new member of its group and exits.
    const leader = spawn(
      "/bin/sh",
      [
        "-c",
        "trap 'sleep 600 & echo $! > \"$0\"; exit 0' TERM; while :; do sleep 0.1; done",
        lateFile,
      ],
      { detached: true, stdio: "ignore" },
    );
    await once(leader, "spawn");
    leader.unref();
    const pid = leader.pid ?? 0;
    const info = await readProcess(pid);
    expect(info?.startTime.startsWith(`${await bootId()}/`)).toBe(true);
    const store = openStore(storeDir);
    store.write((db) =>
      db.run(
        "INSERT INTO child (pid, start_time, kind, owner_ref, pgid, started_at, parent_pid) VALUES (?, ?, 'demo', 'x', ?, 'then', NULL)",
        pid,
        info?.startTime ?? "",
        pid,
      ),
    );
    store.close();

    ledger = openStore(storeDir);
    const opened = await openProcessManager({ ledger, log: silentLog, redactor: new Redactor() });
    manager = opened.manager;
    expect(opened.reaped).toMatchObject([{ pid, kind: "demo" }]);
    await eventually(
      () => existsSync(lateFile) && readFileSync(lateFile, "utf8").endsWith("\n"),
      5000,
      "the late member",
    );
    const late = Number(readFileSync(lateFile, "utf8"));
    await eventually(() => !alive(late), 5000, "the late member to be reaped");
    await eventually(() => !alive(pid), 5000, "the leader to be gone");
  });
});
