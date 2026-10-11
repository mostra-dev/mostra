/**
 * The process manager with real children (RT-09, ARCHITECTURE §4): process groups, records in the
 * ledger, typed IPC both ways, stopping a child with its grandchildren, and adoption rules.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
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

async function open(): Promise<{ ledger: Ledger; manager: ProcessManager }> {
  const opening = openLedger({
    storeDir: join(tempDir("mpm"), "store"),
    runtimeVersion: "0.0.0",
    owner: { pid: process.pid, startTime: "b/1" },
    log: silentLog,
  });
  if (!opening.ok) throw new Error("locked");
  ledger = opening.ledger;
  manager = (await openProcessManager({ ledger, log: silentLog })).manager;
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
