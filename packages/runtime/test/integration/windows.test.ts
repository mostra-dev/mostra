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
import { attach, connectSocket } from "../../src/protocol-server/client.ts";
import {
  accessEntries,
  alive,
  connectTo,
  endpointExists,
  eventually,
  initializeParams,
  sealedAgainstWrites,
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

  it("creates the home owner-only, tightens a wider one, and refuses one another user owns (D85)", async () => {
    const security = (path: string): { protected: boolean; sddl: string } => {
      const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
      const out = execFileSync(probe, ["security", path], { encoding: "utf8" });
      return (JSON.parse(out) as { result: { protected: boolean; sddl: string } }).result;
    };
    const ownerOnly = (path: string): void => {
      expect(security(path).protected, path).toBe(true);
      const sids = new Set(accessEntries(path).map((entry) => entry.sid));
      // The user and SYSTEM, nobody else: no Everyone, Users, Authenticated Users, Administrators.
      expect(sids.size, [...sids].join(" ")).toBe(2);
      expect(sids.has("SY")).toBe(true);
      for (const wide of ["WD", "BU", "AU", "BA"]) expect(sids.has(wide)).toBe(false);
    };
    const everyone = (path: string): void => {
      execFileSync("C:\\Windows\\System32\\icacls.exe", [path, "/grant", "*S-1-1-0:(OI)(CI)F"]);
    };

    // Created by Mostra: owner-only from the start.
    const fresh = testHome();
    const first = await startDaemon(fresh);
    expect(first.status.status).toBe("started");
    ownerOnly(fresh.home);
    await stopDaemon(first.status.socket ?? "");

    // A home the user owns but everyone may use is tightened, and the supervisor says so.
    const wide = testHome();
    mkdirSync(wide.home, { recursive: true });
    everyone(wide.home);
    expect(accessEntries(wide.home).some((entry) => entry.sid === "WD")).toBe(true);
    // Something in it another user made, and so owns: an owner may always grant itself access
    // again, so tightening takes it over (GPT review of the Opus fixes).
    const planted = join(wide.home, "planted");
    const [plantedMade] = asOtherUser(`mkdir:${planted}`) as unknown as { created: boolean }[];
    expect(plantedMade?.created).toBe(true);
    // Owners as the descriptors spell them (SDDL may use an alias, such as LA, for the user).
    const owner = (path: string): string =>
      /^O:(.+?)(?:G:|D:)/.exec(security(path).sddl)?.[1] ?? "";
    expect(owner(planted)).not.toBe(owner(wide.home));
    const second = await startDaemon(wide);
    expect(second.status.status).toBe("started");
    ownerOnly(wide.home);
    ownerOnly(planted);
    expect(owner(planted)).toBe(owner(wide.home));
    const log = readFileSync(join(wide.home, "logs", "supervisor.log"), "utf8");
    expect(log).toContain('"home.tightened"');
    await stopDaemon(second.status.socket ?? "");

    // A home another user created (and so owns) is refused before anything is written in it.
    const parent = tempDir("not-owned");
    everyone(parent);
    const foreign = join(parent, "home");
    const [made] = asOtherUser(`mkdir:${foreign}`) as unknown as { created: boolean }[];
    expect(made?.created).toBe(true);
    const refused = await startDaemon({ ...testHome(), home: foreign });
    expect(refused.status.status).toBe("failed");
    expect(refused.status.diagnostic?.code).toBe("MOSTRA_HOME_NOT_OWNED");
    expect((await refused.exited).code).toBe(3);
    expect(existsSync(join(foreign, "store"))).toBe(false);
  }, 120_000);

  it("tightens a widened home without unsealing its versions or following a link out of it (Opus review)", async () => {
    const security = (path: string): string => {
      const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
      const out = execFileSync(probe, ["security", path], { encoding: "utf8" });
      return (JSON.parse(out) as { result: { sddl: string } }).result.sddl;
    };
    const icacls = (...args: string[]): void => {
      execFileSync("C:\\Windows\\System32\\icacls.exe", args);
    };
    const home = testHome();
    const first = await startDaemon(home);
    const client = await connectTo(first.status.socket ?? "");
    await client.call("mostra/initialize", initializeParams());
    const page = join(tempDir("tighten-art"), "page.tsx");
    cpSync(join(artifact("single-tsx"), "page.tsx"), page);
    const published = await client.call("artifact/publish", { source: { path: page } });
    expect(published.error).toBeUndefined();
    const { versionId } = published.result as { versionId: string };
    client.close();
    await stopDaemon(first.status.socket ?? "");
    const sealedFile = join(home.home, "versions", versionId, "manifest.json");
    expect(sealedAgainstWrites(sealedFile)).toBe(true);

    // Outside the home, a directory a junction inside the home points to.
    const outside = tempDir("tighten-outside");
    writeFileSync(join(outside, "kept.txt"), "x");
    const outsideBefore = security(outside);
    const fileBefore = security(join(outside, "kept.txt"));
    execFileSync("cmd.exe", ["/c", "mklink", "/J", join(home.home, "cache", "outside"), outside]);
    // The home widened (a restore that lost its list), and a file in it granted to everyone.
    const loose = join(home.home, "logs", "loose.txt");
    writeFileSync(loose, "x");
    icacls(home.home, "/grant", "*S-1-1-0:(OI)(CI)R");
    icacls(loose, "/grant", "*S-1-1-0:F");

    const second = await startDaemon(home);
    expect(second.status.status).toBe("started");
    const log = readFileSync(join(home.home, "logs", "supervisor.log"), "utf8");
    expect(log).toContain('"home.tightened"');
    // The version stays sealed; the loose file is the user's alone; the junction's target is
    // untouched.
    expect(sealedAgainstWrites(sealedFile)).toBe(true);
    expect(accessEntries(loose).some((entry) => entry.sid === "WD")).toBe(false);
    expect(security(outside)).toBe(outsideBefore);
    expect(security(join(outside, "kept.txt"))).toBe(fileBefore);
    const [denied] = asOtherUser(`file:${loose}`);
    expect(denied).toMatchObject({ read: false, readWrite: false });
    await stopDaemon(second.status.socket ?? "");
  }, 180_000);

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

  it("never talks to a pipe another user took under an old pipe's name (Opus review)", async () => {
    const home = testHome();
    const daemon = await startDaemon(home);
    const old = daemon.status.socket ?? "";
    await stopDaemon(old);
    expect((await daemon.exited).code).toBe(0);
    // The old name is free now; another user takes it.
    const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
    const squatter = spawn(
      probe,
      [
        "squat",
        process.env["MOSTRA_TEST_OTHER_USER"] ?? "",
        process.env["MOSTRA_TEST_OTHER_PASSWORD"] ?? "",
        old.slice("\\\\.\\pipe\\".length),
      ],
      { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
    );
    try {
      const [line] = (await once(squatter.stdout, "data")) as [Buffer];
      expect(JSON.parse(line.toString("utf8"))).toMatchObject({ ok: true });
      // A client refuses it before sending a byte, as if nothing served the name.
      const refused = await connectSocket(old, 5000).then(
        () => undefined,
        (error: unknown) => error as { diagnostic?: { code: string; message: string } },
      );
      expect(refused?.diagnostic?.code).toBe("MOSTRA_HOST_CONNECTION_CLOSED");
      expect(refused?.diagnostic?.message).toContain("another user");
      await expect(attach(old, { name: "test", version: "0" }, 5000)).rejects.toMatchObject({
        diagnostic: { code: "MOSTRA_HOST_CONNECTION_CLOSED" },
      });
    } finally {
      squatter.stdin.end();
      await once(squatter, "exit");
    }
  }, 60_000);

  it("names the new pipe in instance.json even when the first rewrite fails (Opus review)", async () => {
    const home = testHome();
    const daemon = await startDaemon(home, {
      env: { ...home.env, MOSTRA_TEST_FAULTS: "endpoint:moved:throw-once" },
    });
    const before = daemon.status.socket ?? "";
    const helper = (await status(before)).processes.find((child) => child.kind === "control-pipe");
    process.kill(helper?.pid ?? 0);
    // The heal that binds the new pipe fails to announce it; the next one announces it again.
    await eventually(
      async () =>
        record(home.home).socket !== before && (await endpointExists(record(home.home).socket)),
      25_000,
      "instance.json to name the served pipe",
    );
    const log = readFileSync(join(home.home, "logs", "supervisor.log"), "utf8");
    expect(log).toContain('"protocol.endpoint_announce_failed"');
    await stopDaemon(record(home.home).socket);
    expect((await daemon.exited).code).toBe(0);
  }, 60_000);

  it("binds one pipe at a time when a bind takes longer than its checks (Opus review)", async () => {
    const home = testHome();
    // Every helper takes 7 s to report READY; the checks run every 5 s.
    const daemon = await startDaemon(home, {
      env: { ...home.env, MOSTRA_TEST_PIPE_SLOW_READY_MS: "7000" },
    });
    const before = daemon.status.socket ?? "";
    const helper = (await status(before)).processes.find((child) => child.kind === "control-pipe");
    process.kill(helper?.pid ?? 0);
    await eventually(
      async () =>
        record(home.home).socket !== before && (await endpointExists(record(home.home).socket)),
      30_000,
      "the pipe to be served again",
    );
    // Long enough for an overlapping second heal to have bound a pipe of its own.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const helpers = (await status(record(home.home).socket)).processes.filter(
      (child) => child.kind === "control-pipe",
    );
    expect(helpers).toHaveLength(1);
    await stopDaemon(record(home.home).socket);
    expect((await daemon.exited).code).toBe(0);
  }, 90_000);

  it("answers a request sent just before it stops, though its pipe's helper writes slowly (Opus review)", async () => {
    const home = testHome();
    const daemon = await startDaemon(home, {
      env: { ...home.env, MOSTRA_TEST_PIPE_SLOW_WRITE_MS: "400" },
    });
    const client = await connectTo(daemon.status.socket ?? "");
    expect((await client.call("mostra/initialize", initializeParams())).error).toBeUndefined();
    // The answer is still queued in the helper when the instance closes its listener.
    const answer = await client.call("mostra/shutdown", undefined, 20_000);
    expect(answer.error).toBeUndefined();
    expect(answer.result).toEqual({});
    await client.closed;
    expect((await daemon.exited).code).toBe(0);
  }, 60_000);

  it("replaces a pipe whose helper lives on but can no longer serve it (GPT review finding 1)", async () => {
    const home = testHome();
    const marker = join(tempDir("pipe-fatal"), "failed-once");
    const daemon = await startDaemon(home, {
      env: { ...home.env, MOSTRA_TEST_PIPE_FATAL_ONCE: marker },
    });
    expect(daemon.status.status).toBe("started");
    const before = daemon.status.socket ?? "";
    // The first helper reported READY, then FATAL, and stays alive serving nothing.
    await eventually(() => existsSync(marker), 10_000, "the first helper to fail");
    await eventually(
      async () =>
        record(home.home).socket !== before && (await endpointExists(record(home.home).socket)),
      15_000,
      "a working pipe in place of the failed one",
    );
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

  // Through the child's job by its name, and, where that name can't be opened (a supervisor of
  // another logon session left it, Opus review), through the child's descendants by parent and
  // creation time.
  it.each([
    ["its job", "ignore-lifeline"],
    ["its descendants", "ignore-lifeline,hide-job"],
  ])(
    "reaps what a supervisor's stuck gates left, by PID and creation time, and spares look-alikes (%s)",
    async (_how, faults) => {
      const home = testHome();
      // Gates that miss their lifeline, as hung ones would: the children outlive the supervisor.
      const { supervisor, started } = await startFamily(home, {
        ...home.env,
        MOSTRA_TEST_GATE: faults,
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
          .map(
            (line) => JSON.parse(line) as { kind: string; skipped?: string; signalled: number[] },
          );
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
    },
    90_000,
  );

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

  it("holds a child at its gate for as long as its supervisor hasn't recorded it (issue #7)", async () => {
    // Node.js's own job ends a dead supervisor's gates, so the gate's wait for "go" is what holds
    // a child that a live, slow supervisor hasn't recorded yet.
    const home = testHome();
    const marker = join(tempDir("gate"), "ran.txt");
    const supervisor = spawn(process.execPath, [fixture("windows-gated.mjs"), home.home, marker], {
      env: { ...home.env, MOSTRA_TEST_FAULTS: "spawn:before-record:demo:hang" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    supervisor.stdout?.setEncoding("utf8");
    supervisor.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    try {
      await eventually(() => output === "ready\n", 30_000, "the instance");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(existsSync(marker)).toBe(false);
    } finally {
      supervisor.kill();
      await once(supervisor, "exit");
    }
  });
});

// The gate alone, started by the test (outside any supervisor), so what is judged is the gate's own
// handling of its lifeline and job, not Node.js's job ending it (Opus review of WP-W1).
describe.runIf(WINDOWS)("the gate on its own", () => {
  const gate = (env: NodeJS.ProcessEnv, script: string) =>
    spawn(helperPath(), ["gate", "--", process.execPath, "-e", script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      windowsHide: true,
    });

  it("never runs its command when its lifeline closes before go", async () => {
    const marker = join(tempDir("gate-eof"), "ran.txt");
    const child = gate({}, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`);
    const lifeline = child.stdio[3] as unknown as NodeJS.ReadWriteStream;
    const report = await new Promise<string>((resolve) =>
      lifeline.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8"))),
    );
    expect(report).toContain('"startTime":"win/');
    // Closing the test's end is what a dead supervisor does to the lifeline.
    (lifeline as unknown as { destroy(): void }).destroy();
    const [code] = (await once(child, "exit")) as [number | null];
    expect(code).toBe(125);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(existsSync(marker)).toBe(false);
  });

  it("takes its child along when it dies between creating it and naming its job", async () => {
    const child = gate(
      { MOSTRA_TEST_GATE: "stall-after-create" },
      "setInterval(() => {}, 1 << 30)",
    );
    // The gate names the child it created (not its own console host) when it stalls.
    let text = "";
    child.stderr?.setEncoding("utf8");
    const created = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the gate didn't stall: ${text}`)), 10_000);
      child.stderr?.on("data", (chunk: string) => {
        text += chunk;
        const match = /stalled after creating (\d+)/.exec(text);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    expect(alive(created)).toBe(true);
    child.kill();
    await once(child, "exit");
    await eventually(() => !alive(created), 10_000, `the suspended child ${created} to end`);
  });
});
