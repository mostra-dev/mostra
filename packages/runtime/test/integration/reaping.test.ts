/**
 * Reaping after a supervisor crash (RT-09, FAILURE_MODEL §2): SIGKILL a supervisor that runs a
 * demo dev server (grandchildren in its process group) and a PTY host whose program runs in its
 * own session; the next `mostra-runtime daemon` reaps them by recorded PID and start time, and
 * leaves alone processes that only look like recorded ones.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LineSplitter } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { bootId, listProcesses, readProcess } from "../../src/processes/identity.ts";
import {
  alive,
  connectTo,
  eventually,
  initializeParams,
  startDaemon,
  testHome,
} from "../support.ts";

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

interface Started {
  supervisor: number;
  socket: string;
  demo: number;
  ptyHost: number;
  program: { pid: number; adopted: boolean };
}

async function groupMembers(pgid: number): Promise<number[]> {
  return (await listProcesses()).filter((info) => info.pgid === pgid).map((info) => info.pid);
}

async function startDecoy(): Promise<number> {
  const child = spawn("/bin/sh", ["-c", "sleep 600"], { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  child.unref();
  return child.pid ?? 0;
}

describe("reaping after a supervisor crash (RT-09)", () => {
  it("reaps demo and PTY grandchildren by recorded PID and start time, and spares look-alikes", async () => {
    const home = testHome();
    const supervisor = spawn(process.execPath, [fixture("supervisor.mjs"), home.home], {
      env: home.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const started = await new Promise<Started>((resolve, reject) => {
      const splitter = new LineSplitter();
      supervisor.stdout?.setEncoding("utf8");
      supervisor.stdout?.on("data", (chunk: string) => {
        const [line] = splitter.push(chunk);
        if (line) resolve(JSON.parse(line) as Started);
      });
      supervisor.once("exit", (code) => reject(new Error(`fixture supervisor exited ${code}`)));
    });
    expect(started.program.adopted).toBe(true);

    // The supervisor reports both children through instance/status.
    const client = await connectTo(started.socket);
    await client.call("mostra/initialize", initializeParams());
    const status = (await client.call("instance/status")).result as {
      processes: { pid: number; kind: string }[];
    };
    expect(status.processes.map((child) => [child.kind, child.pid]).sort()).toEqual(
      [
        ["demo", started.demo],
        ["pty-host", started.ptyHost],
      ].sort(),
    );
    client.close();

    const demoGroup = await groupMembers(started.demo);
    const programGroup = await groupMembers(started.program.pid);
    expect(demoGroup.length).toBe(3); // sh and its two sleeps
    expect(programGroup.length).toBe(2); // sh and its sleep, in their own session
    expect((await readProcess(started.ptyHost))?.pgid).toBe(started.ptyHost);

    supervisor.kill("SIGKILL");
    await once(supervisor, "exit");

    // The PTY host noticed the IPC disconnect and exited with its group (FAILURE_MODEL §2).
    await eventually(() => !alive(started.ptyHost), 10_000, "the PTY host to exit");
    // What a crash leaves behind: the demo's group and the PTY program's session.
    for (const pid of [...demoGroup, ...programGroup]) expect(alive(pid)).toBe(true);

    // Look-alikes: a row whose PID now belongs to an unrelated process with a different start
    // time, and a row whose leader is gone and whose group ID an unrelated, older group reuses.
    const gone = await startDecoy();
    process.kill(gone, "SIGKILL");
    await eventually(() => !alive(gone), 5000, "the gone decoy to exit");
    const reused = await startDecoy();
    const older = await startDecoy();
    const olderInfo = await readProcess(older);
    const later = Number(olderInfo?.startTime.split("/").at(-1)) + 100_000;
    const ledger = new Database(join(home.home, "store", "ledger.sqlite"));
    const insert = ledger.prepare(
      "INSERT INTO child (pid, start_time, kind, owner_ref, pgid, started_at, parent_pid) VALUES (?, ?, 'decoy', 'x', ?, 'then', NULL)",
    );
    insert.run(reused, `${await bootId()}/1`, reused);
    insert.run(gone, `${await bootId()}/${later}`, older);
    ledger.close();

    try {
      const next = await startDaemon(home);
      expect(next.status.status).toBe("started");
      expect(next.status.reaped).toBe(2);
      for (const pid of [...demoGroup, ...programGroup]) {
        await eventually(() => !alive(pid), 10_000, `process ${pid} to be reaped`);
      }
      expect(alive(reused)).toBe(true);
      expect(alive(older)).toBe(true);

      const log = readFileSync(join(home.home, "logs", "supervisor.log"), "utf8");
      const reaped = log
        .split("\n")
        .filter((line) => line.includes('"process.reaped"'))
        .map((line) => JSON.parse(line) as { kind: string; skipped?: string; signalled: number[] });
      expect(reaped.find((entry) => entry.kind === "demo")?.signalled.sort()).toEqual(
        demoGroup.sort(),
      );
      expect(reaped.find((entry) => entry.kind === "pty-host/adopted")?.signalled.sort()).toEqual(
        programGroup.sort(),
      );
      expect(reaped.find((entry) => entry.kind === "pty-host")?.skipped).toBe("gone");
      expect(
        reaped
          .filter((entry) => entry.kind === "decoy")
          .map((entry) => entry.skipped)
          .sort(),
      ).toEqual(["gone", "pid reused"]);

      next.child.kill("SIGTERM");
      expect((await next.exited).code).toBe(0);
      const after = new Database(join(home.home, "store", "ledger.sqlite"), { readonly: true });
      expect(after.prepare("SELECT count(*) n FROM child").get()).toEqual({ n: 0 });
      after.close();
    } finally {
      for (const pid of [reused, older]) process.kill(-pid, "SIGKILL");
    }
  });
});
