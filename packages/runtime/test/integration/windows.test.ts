/**
 * RT-10 on Windows (WP-W1, FAILURE_MODEL §2, §3, D150): what the platform layer guarantees there
 * that the POSIX suites check with modes, sockets and signals.
 *
 * - another local user can open neither the home, nor a file in it, nor its control pipe, nor a
 *   sealed version (a file in an ordinary directory, which they can open, is the control);
 * - a killed supervisor's children and grandchildren end with it, through their Job Objects;
 * - a gate that misses its lifeline leaves them running, and the next supervisor reaps them by
 *   PID and creation time, sparing a process that only shares a recorded PID;
 * - a child is never run before it is recorded (issue #7);
 * - a control pipe whose helper stopped is served again, and `instance.json` names it;
 * - a frozen owner whose pipe is gone is reported as `MOSTRA_HOME_LOCKED`;
 * - a running home can't be removed (Windows keeps files in use).
 *
 * The other user is the one the CI leg creates (`MOSTRA_TEST_OTHER_USER`,
 * `MOSTRA_TEST_OTHER_PASSWORD`); without them the access checks fail, never skip, on Windows.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LineSplitter } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { helperPath, readProcess } from "../../src/platform/index.ts";
import {
  accessEntries,
  alive,
  connectTo,
  endpointExists,
  eventually,
  initializeParams,
  startDaemon,
  tempDir,
  testHome,
  WINDOWS,
  WRITE_RIGHTS,
} from "../support.ts";

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const artifact = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/artifacts/${name}`, import.meta.url));

interface Opened {
  readonly path: string;
  readonly read: boolean;
  readonly readWrite: boolean;
}

/** Opens each `kind:path` as the other local user, through the helper's probe. */
function asOtherUser(...targets: string[]): Opened[] {
  const user = process.env["MOSTRA_TEST_OTHER_USER"];
  const password = process.env["MOSTRA_TEST_OTHER_PASSWORD"];
  if (!user || !password) {
    throw new Error("Set MOSTRA_TEST_OTHER_USER and MOSTRA_TEST_OTHER_PASSWORD (the CI leg does).");
  }
  const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
  const out = execFileSync(probe, ["as-user", user, password, ...targets], { encoding: "utf8" });
  const answer = JSON.parse(out) as { ok: boolean; result?: Opened[]; error?: unknown };
  if (!answer.ok || !answer.result) throw new Error(`probe failed: ${out}`);
  return answer.result;
}

function probe(command: "suspend" | "resume", pid: number): void {
  const binary = join(dirname(helperPath()), "mostra-win-probe.exe");
  execFileSync(binary, [command, String(pid)], { encoding: "utf8" });
}

async function stopDaemon(socket: string): Promise<void> {
  const client = await connectTo(socket);
  await client.call("mostra/initialize", initializeParams());
  expect((await client.call("mostra/shutdown")).error).toBeUndefined();
  await client.closed;
}

const record = (home: string): { pid: number; socket: string } =>
  JSON.parse(readFileSync(join(home, "instance.json"), "utf8")) as { pid: number; socket: string };

async function status(socket: string): Promise<{ processes: { pid: number; kind: string }[] }> {
  const client = await connectTo(socket);
  await client.call("mostra/initialize", initializeParams());
  const result = (await client.call("instance/status")).result as {
    processes: { pid: number; kind: string }[];
  };
  client.close();
  return result;
}

interface Family {
  supervisor: number;
  socket: string;
  demo: number;
  family: { pid: number; grandchildren: number[] };
}

async function startFamily(home: ReturnType<typeof testHome>, env: NodeJS.ProcessEnv) {
  const scratch = tempDir("family");
  const supervisor = spawn(
    process.execPath,
    [fixture("windows-supervisor.mjs"), home.home, scratch],
    {
      env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const started = await new Promise<Family>((resolve, reject) => {
    const splitter = new LineSplitter();
    supervisor.stdout?.setEncoding("utf8");
    supervisor.stdout?.on("data", (chunk: string) => {
      const [line] = splitter.push(chunk);
      if (line) resolve(JSON.parse(line) as Family);
    });
    supervisor.once("exit", (code) => reject(new Error(`fixture supervisor exited ${code}`)));
  });
  return { supervisor, started };
}

describe.runIf(WINDOWS)("Windows: owner-only home and transport (RT-10)", () => {
  it("lets another local user open neither the home, its files, its pipe nor a sealed version", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const socket = daemon.status.socket ?? "";
    expect(socket).toMatch(/^\\\\\.\\pipe\\mostra-[0-9A-HJKMNP-TV-Z]{16}-[0-9a-f]{16}$/);
    // A published, sealed version.
    const client = await connectTo(socket);
    await client.call("mostra/initialize", initializeParams());
    const page = join(tempDir("cross-user-art"), "page.tsx");
    cpSync(join(artifact("single-tsx"), "page.tsx"), page);
    const published = await client.call("artifact/publish", { source: { path: page } });
    expect(published.error).toBeUndefined();
    const { versionId } = published.result as { versionId: string };
    client.close();
    const sealedFile = join(home.home, "versions", versionId, "manifest.json");
    expect(existsSync(sealedFile)).toBe(true);
    // Nobody may write a sealed file, its owner included, as with mode 0444 (the owner can unseal
    // it). Checked on the list itself: the runner's administrator passes any list with Node.js's
    // backup-semantics opens.
    for (const entry of accessEntries(sealedFile)) expect(entry.mask & WRITE_RIGHTS).toBe(0);

    // The control: a file in an ordinary directory another user can open.
    const open = join("C:\\", `mostra-public-${process.pid}`);
    mkdirSync(open, { recursive: true });
    writeFileSync(join(open, "readable.txt"), "x");
    try {
      const results = asOtherUser(
        `file:${join(open, "readable.txt")}`,
        `dir:${home.home}`,
        `file:${join(home.home, "instance.json")}`,
        `file:${join(home.home, "store", "ledger.sqlite")}`,
        `file:${join(home.home, "logs", "supervisor.log")}`,
        `dir:${join(home.home, "versions", versionId)}`,
        `file:${sealedFile}`,
        `pipe:${socket}`,
      );
      expect(results[0]).toMatchObject({ read: true, readWrite: true });
      for (const result of results.slice(1)) {
        expect(result, result.path).toMatchObject({ read: false, readWrite: false });
      }
    } finally {
      rmSync(open, { recursive: true, force: true });
    }
    await stopDaemon(socket);
    expect((await daemon.exited).code).toBe(0);
  });

  it("keeps a running home: Windows refuses to remove files in use, and the owner keeps serving", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    expect(() => rmSync(join(home.home, "store"), { recursive: true })).toThrow(/EBUSY|EPERM/);
    const client = await connectTo(daemon.status.socket ?? "");
    const init = await client.call("mostra/initialize", initializeParams());
    expect(init.error).toBeUndefined();
    client.close();
    await stopDaemon(daemon.status.socket ?? "");
  });
});

describe.runIf(WINDOWS)("Windows: the control pipe (D81 item 4, RT-06)", () => {
  it("serves the pipe again when its helper stops, and instance.json names the new one", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const before = daemon.status.socket ?? "";
    const helper = (await status(before)).processes.find((child) => child.kind === "control-pipe");
    expect(helper).toBeDefined();
    process.kill(helper?.pid ?? 0);
    // Within the 10 s bound (the check runs every 5 s by default).
    await eventually(
      async () =>
        record(home.home).socket !== before && (await endpointExists(record(home.home).socket)),
      15_000,
      "the pipe to be served again",
    );
    expect(await endpointExists(before)).toBe(false);
    const again = await startDaemon(home);
    expect(again.status).toMatchObject({ status: "attached", pid: daemon.status.pid });
    await stopDaemon(record(home.home).socket);
    expect((await daemon.exited).code).toBe(0);
  }, 60_000);

  it("reports MOSTRA_HOME_LOCKED with the owner's PID when the owner is frozen and its pipe gone", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const helper = (await status(daemon.status.socket ?? "")).processes.find(
      (child) => child.kind === "control-pipe",
    );
    const pid = daemon.status.pid ?? 0;
    probe("suspend", pid);
    try {
      process.kill(helper?.pid ?? 0);
      await eventually(
        async () => !(await endpointExists(daemon.status.socket ?? "")),
        10_000,
        "the pipe to go",
      );
      const starter = await startDaemon(home);
      expect(starter.status.status).toBe("failed");
      expect(starter.status.diagnostic?.code).toBe("MOSTRA_HOME_LOCKED");
      expect(starter.status.diagnostic?.message).toContain(`PID ${pid}`);
      expect((await starter.exited).code).toBe(3);
    } finally {
      probe("resume", pid);
    }
    await eventually(
      async () => endpointExists(record(home.home).socket),
      15_000,
      "the pipe to return",
    );
    await stopDaemon(record(home.home).socket);
  }, 90_000);
});

describe.runIf(WINDOWS)("Windows: children end with their supervisor (RT-09, RT-10)", () => {
  it("ends a killed supervisor's child and grandchildren through their job at once", async () => {
    const home = testHome();
    const { supervisor, started } = await startFamily(home, home.env);
    const everyone = [started.demo, ...started.family.grandchildren];
    expect(started.demo).toBe(started.family.pid);
    for (const pid of everyone) expect(alive(pid)).toBe(true);
    supervisor.kill(); // TerminateProcess: nothing of the supervisor runs to clean up.
    await once(supervisor, "exit");
    for (const pid of everyone) {
      await eventually(() => !alive(pid), 10_000, `process ${pid} to end with the job`);
    }
    // The next supervisor finds nothing left to end.
    const next = await startDaemon(home);
    expect(next.status.status).toBe("started");
    await stopDaemon(next.status.socket ?? "");
  });

  it("reaps what a supervisor's stuck gates left, by PID and creation time, and spares look-alikes", async () => {
    const home = testHome();
    // Gates that miss their lifeline, as hung ones would: the children outlive the supervisor.
    const { supervisor, started } = await startFamily(home, {
      ...home.env,
      MOSTRA_TEST_GATE: "ignore-lifeline",
    });
    const everyone = [started.demo, ...started.family.grandchildren];
    supervisor.kill();
    await once(supervisor, "exit");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const pid of everyone) expect(alive(pid)).toBe(true);

    // A look-alike: a row whose PID now belongs to an unrelated process created at another time.
    const decoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
      stdio: "ignore",
    });
    await once(decoy, "spawn");
    const decoyInfo = await readProcess(decoy.pid ?? 0);
    expect(decoyInfo).toBeDefined();
    const ledger = new Database(join(home.home, "store", "ledger.sqlite"));
    ledger
      .prepare(
        "INSERT INTO child (pid, start_time, kind, owner_ref, pgid, started_at, parent_pid) VALUES (?, 'win/1', 'decoy', 'x', ?, 'then', NULL)",
      )
      .run(decoy.pid, decoy.pid);
    ledger.close();

    try {
      const next = await startDaemon(home, { env: home.env });
      expect(next.status.status).toBe("started");
      for (const pid of everyone) {
        await eventually(() => !alive(pid), 10_000, `process ${pid} to be reaped`);
      }
      expect(alive(decoy.pid ?? 0)).toBe(true);
      const log = readFileSync(join(home.home, "logs", "supervisor.log"), "utf8");
      const reaped = log
        .split("\n")
        .filter((line) => line.includes('"process.reaped"'))
        .map((line) => JSON.parse(line) as { kind: string; skipped?: string; signalled: number[] });
      // The job held the child and both grandchildren (and the console host Windows gives a
      // console program, which lives in its client's job), never the look-alike.
      const demo = reaped.find((entry) => entry.kind === "demo")?.signalled ?? [];
      expect(demo).toEqual(expect.arrayContaining(everyone));
      expect(demo).not.toContain(decoy.pid);
      expect(reaped.find((entry) => entry.kind === "decoy")?.skipped).toBe("pid reused");
      await stopDaemon(next.status.socket ?? "");
      const after = new Database(join(home.home, "store", "ledger.sqlite"), { readonly: true });
      expect(after.prepare("SELECT count(*) n FROM child").get()).toEqual({ n: 0 });
      after.close();
    } finally {
      decoy.kill();
      for (const pid of everyone) {
        try {
          process.kill(pid);
        } catch {
          // Reaped.
        }
      }
    }
  }, 90_000);

  it("never runs the command of a child whose supervisor died before recording it (issue #7)", async () => {
    const home = testHome();
    const marker = join(tempDir("gate"), "ran.txt");
    const supervisor = spawn(process.execPath, [fixture("windows-gated.mjs"), home.home, marker], {
      // The demo child's own point: the instance's start already spawned the pipe's helper.
      env: { ...home.env, MOSTRA_TEST_FAULTS: "spawn:before-record:demo:crash" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    supervisor.stdout?.setEncoding("utf8");
    supervisor.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    await once(supervisor, "exit");
    expect(output).toBe("ready\n");
    // The gate saw its lifeline close before "go": the command never ran.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(existsSync(marker)).toBe(false);
  });
});
