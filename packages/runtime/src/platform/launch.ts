/**
 * Starting, ending and reaping children on each operating system (RT-09, RT-10, issue #7, D93,
 * FAILURE_MODEL §2). The process manager keeps the policy (record a child before it runs, end its
 * descendants with it, reap what a crashed supervisor left); this module is how each system does
 * it.
 *
 * - **POSIX.** A child is started detached, as the leader of its own process group, behind a
 *   `/bin/sh` gate that waits for "go" on descriptor 3 and then `exec`s the command, keeping its
 *   PID, group and start time. It is ended by signalling its group (SIGTERM, then SIGKILL), and
 *   the reaper signals a recorded group's members that started no earlier than its leader.
 * - **Windows.** A child is started behind `mostra-win gate`, which creates it suspended in a Job
 *   Object of its own that ends every member when its last handle closes, reports its PID and
 *   creation time on descriptor 3, and lets it run on "go". Descriptor 3 stays open as the
 *   child's lifeline: closing it (a stop, or the supervisor's exit or crash) ends the job, child
 *   and descendants at once. Windows has no signals to ask a process to stop, so a stop is that:
 *   graceful work goes over the child's own channel first (D87). The reaper ends a recorded
 *   child's job, which it opens by the name the gate gave it (`Local\mostra-job-<pid>-<creation>`),
 *   and the child itself if it still runs as the recorded process.
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { WINDOWS } from "./directories.ts";
import { helperPath, runHelperAsync } from "./helper.ts";
import {
  listProcesses,
  type ProcessInfo,
  readProcess,
  sameBoot,
  startedNoEarlier,
} from "./identity.ts";

/**
 * The POSIX gate (issue #7): `/bin/sh` waits for "go" on file descriptor 3 and only then replaces
 * itself with the real command. A supervisor killed in between leaves a gate that reads
 * end-of-file and exits 125 without running anything.
 */
const GATE_SCRIPT = 'IFS= read -r go <&3 && [ "$go" = go ] || exit 125; exec 3<&-; exec "$@"';

/** How long reaping waits between SIGTERM and SIGKILL. */
const REAP_GRACE_MS = 2000;
/** How long to wait for SIGKILLed processes to disappear before reporting them. */
const KILL_WAIT_MS = 5000;

/** What a launch needs. */
export interface LaunchSpec {
  /** What the child is (`builder`, `install` …), shown in process listings. */
  readonly kind: string;
  /** The executable: an absolute path on Windows. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  /** Node's IPC channel or a plain byte channel on descriptor 4, or nothing. */
  readonly extra?: "ipc" | "channel" | undefined;
}

/** A child started behind its gate. */
export interface Launched {
  /** The process Node started (on Windows the gate, which ends when its child does). */
  readonly process: ChildProcess;
  /** The child's identity once known, `undefined` when it is already gone; rejects when unreadable. */
  identify(): Promise<{ readonly pid: number; readonly startTime: string } | undefined>;
  /** Lets the recorded child run. */
  release(): void;
  /** Whether the child or anything it started still runs. */
  running(): boolean;
  /**
   * Ends the child and everything it started: POSIX signals its group and `extraGroups` (SIGTERM,
   * SIGKILL after `graceMs`); Windows closes its lifeline and, after `graceMs`, kills the gate.
   */
  end(graceMs: number, extraGroups: readonly number[]): Promise<void>;
  /** After the child exited, ends what is left of its group (nothing on Windows: its job ended). */
  sweep(extraGroups: readonly number[]): Promise<void>;
  /** At the supervisor's own exit: ends everything at once, without waiting. */
  kill(): void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

const groupAlive = (pgid: number): boolean => signalGroup(pgid, 0);

/** Starts `spec` behind its gate. */
export function launch(
  spec: LaunchSpec,
  warn: (event: string, fields: Readonly<Record<string, unknown>>) => void,
): Launched {
  return WINDOWS ? launchWindows(spec) : launchPosix(spec, warn);
}

function stdioFor(extra: LaunchSpec["extra"]): ("ignore" | "pipe" | "ipc" | "overlapped")[] {
  const base: ("ignore" | "pipe" | "ipc" | "overlapped")[] = ["ignore", "pipe", "pipe", "pipe"];
  // A byte channel is overlapped on Windows so both ends can read and write at once; the option
  // means "pipe" elsewhere.
  if (extra === "ipc") return [...base, "ipc"];
  if (extra === "channel") return [...base, "overlapped"];
  return base;
}

function launchPosix(
  spec: LaunchSpec,
  warn: (event: string, fields: Readonly<Record<string, unknown>>) => void,
): Launched {
  const child = spawn(
    "/bin/sh",
    ["-c", GATE_SCRIPT, `mostra-${spec.kind}`, spec.command, ...spec.args],
    {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: stdioFor(spec.extra),
      serialization: "json",
    },
  );
  const gate = child.stdio[3] as Writable | null;
  gate?.on("error", () => {
    // The child exited before reading "go"; its exit is reported through `exit`.
  });
  const pid = (): number => child.pid ?? 0;
  const end = async (pgids: readonly number[], graceMs: number): Promise<void> => {
    for (const pgid of pgids) signalGroup(pgid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && pgids.some(groupAlive)) await delay(25);
    for (const pgid of pgids) if (groupAlive(pgid)) signalGroup(pgid, "SIGKILL");
    const killDeadline = Date.now() + KILL_WAIT_MS;
    while (Date.now() < killDeadline && pgids.some(groupAlive)) await delay(10);
    const left = pgids.filter(groupAlive);
    if (left.length > 0) warn("process.group_survived_sigkill", { pgids: left });
  };
  return {
    process: child,
    async identify() {
      const info = await readProcess(pid());
      if (info) return { pid: info.pid, startTime: info.startTime };
      // Gone already: nothing is left to record or reap.
      if (child.exitCode !== null || child.signalCode !== null) return undefined;
      // Still waiting at its gate, so it can't have exited by itself: its identity just couldn't
      // be read (D80 Claude review finding 8).
      throw new Error(`Couldn't read the process identity of ${spec.kind} ${pid()}.`);
    },
    release() {
      gate?.end("go\n");
    },
    running: () => child.exitCode === null && child.signalCode === null,
    end: (graceMs, extraGroups) => end([pid(), ...extraGroups], graceMs),
    sweep: (extraGroups) => end([pid(), ...extraGroups], 2000),
    kill() {
      signalGroup(pid(), "SIGKILL");
    },
  };
}

function launchWindows(spec: LaunchSpec): Launched {
  // Node.js puts every child it starts, the gate too, into one kill-on-close job of its own
  // (libuv's global job), so a supervisor that dies takes its gates with it, and each gate's death
  // closes its child's job. A gate a test makes miss its lifeline (MOSTRA_TEST_GATE, a hung gate's
  // stand-in) is started outside that job, or nothing would be left for the reaper to find.
  const hung = spec.env["MOSTRA_TEST_GATE"] === "ignore-lifeline";
  const child = spawn(helperPath(), ["gate", "--", spec.command, ...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    windowsHide: true,
    detached: hung,
    stdio: stdioFor(spec.extra),
    serialization: "json",
  });
  const lifeline = child.stdio[3] as (Readable & Writable) | null;
  lifeline?.on("error", () => {});
  const report = new Promise<{ pid: number; startTime: string } | undefined>((resolve, reject) => {
    let text = "";
    const onData = (chunk: Buffer): void => {
      text += chunk.toString("utf8");
      const end = text.indexOf("\n");
      if (end < 0) return;
      lifeline?.off("data", onData);
      try {
        const line = JSON.parse(text.slice(0, end)) as {
          pid?: number;
          startTime?: string;
          error?: string;
        };
        if (line.pid !== undefined && line.startTime !== undefined) {
          resolve({ pid: line.pid, startTime: line.startTime });
        } else {
          reject(
            new Error(`The gate couldn't start ${spec.kind}: ${line.error ?? text.slice(0, end)}`),
          );
        }
      } catch {
        reject(new Error(`The gate of ${spec.kind} reported ${text.slice(0, 200)}`));
      }
    };
    lifeline?.on("data", onData);
    child.once("exit", () => resolve(undefined));
    child.once("error", reject);
  });
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    child.once("exit", () => resolve());
  });
  const running = (): boolean => child.exitCode === null && child.signalCode === null;
  return {
    process: child,
    identify: () => report,
    release() {
      lifeline?.write("go\n");
    },
    running,
    async end(graceMs) {
      // Graceful work travels over the child's own channel before this (D87). Closing the
      // lifeline ends the job; a gate that doesn't exit by itself is killed, which closes the job
      // with its last handle.
      lifeline?.end();
      if (!running()) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        exited,
        new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs))),
      ]);
      clearTimeout(timer);
      if (running()) child.kill();
      await Promise.race([exited, delay(KILL_WAIT_MS)]);
    },
    async sweep() {
      // The gate ended the child's job before it exited.
    },
    kill() {
      lifeline?.destroy();
      child.kill();
    },
  };
}

/** One recorded child, as the ledger's `child` table holds it. */
export interface RecordedChild {
  readonly pid: number;
  readonly start_time: string;
  readonly pgid: number;
}

/** What reaping did for one recorded child. */
export interface ReapOutcome {
  /** The processes it ended: the child if it still ran, and what its group or job held. */
  readonly ended: readonly number[];
  /** Why nothing was ended, when nothing was. */
  readonly skipped?: "gone" | "pid reused" | "other boot";
}

/**
 * Ends what a previous supervisor's children left running, by their recorded identities, and
 * leaves alone processes that only look like them (FAILURE_MODEL §2). Call it only while holding
 * the home's ledger lock.
 */
export function reapRecorded(
  rows: readonly RecordedChild[],
  warn: (event: string, fields: Readonly<Record<string, unknown>>) => void,
): Promise<ReapOutcome[]> {
  return WINDOWS ? reapWindows(rows, warn) : reapPosix(rows, warn);
}

async function reapWindows(
  rows: readonly RecordedChild[],
  warn: (event: string, fields: Readonly<Record<string, unknown>>) => void,
): Promise<ReapOutcome[]> {
  if (rows.length === 0) return [];
  const answers = await runHelperAsync<
    { pid: number; job?: boolean; ended?: number[]; reused?: boolean; error?: string }[]
  >(["reap", ...rows.map((row) => `${row.pid}:${row.start_time}`)]);
  return rows.map((row, index): ReapOutcome => {
    const answer = answers[index];
    // A process the helper couldn't end (access, a protected process) is reported, never hidden.
    if (answer?.error !== undefined) {
      warn("process.reap_incomplete", { pid: row.pid, error: answer.error });
    }
    const ended = answer?.ended ?? [];
    if (ended.length > 0) return { ended };
    return { ended: [], skipped: answer?.reused ? "pid reused" : "gone" };
  });
}

/** The processes of a recorded group that are provably the recorded child's. */
function targetsFor(
  row: RecordedChild,
  processes: readonly ProcessInfo[],
): number[] | NonNullable<ReapOutcome["skipped"]> {
  const leader = processes.find((info) => info.pid === row.pid);
  if (leader && leader.startTime !== row.start_time) return "pid reused";
  if (!leader) {
    const boot = processes.find((info) => info.pid === process.pid)?.startTime;
    if (boot === undefined || !sameBoot(boot, row.start_time)) return "other boot";
  }
  const members = processes
    .filter((info) => info.pgid === row.pgid && info.pid !== process.pid)
    .filter((info) => startedNoEarlier(info.startTime, row.start_time))
    .map((info) => info.pid);
  return members.length > 0 ? members : "gone";
}

function signalAll(pids: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

async function reapPosix(
  rows: readonly RecordedChild[],
  warn: (event: string, fields: Readonly<Record<string, unknown>>) => void,
): Promise<ReapOutcome[]> {
  if (rows.length === 0) return [];
  const before = await listProcesses();
  const plan = rows.map((row) => ({ row, targets: targetsFor(row, before) }));
  // Only groups proven to be the recorded children's are signalled, then watched until they are
  // empty: a member may start more processes in the group while it handles SIGTERM, so every
  // round re-lists the groups instead of trusting the first snapshot (RT-09).
  const owned = plan.filter((entry) => Array.isArray(entry.targets)).map((entry) => entry.row);
  const members = (processes: readonly ProcessInfo[]): number[] => [
    ...new Set(
      owned.flatMap((row) => {
        const targets = targetsFor(row, processes);
        return Array.isArray(targets) ? targets : [];
      }),
    ),
  ];
  // A listing is a series of reads, so a process that starts while another exits can slip
  // between them; the groups count as gone only when the kernel has no member left either.
  const groupsLeft = (): boolean => owned.some((row) => groupAlive(row.pgid));
  signalAll(members(before), "SIGTERM");
  const deadline = Date.now() + REAP_GRACE_MS;
  let remaining = members(await listProcesses());
  while ((remaining.length > 0 || groupsLeft()) && Date.now() < deadline) {
    await delay(100);
    remaining = members(await listProcesses());
  }
  const killDeadline = Date.now() + KILL_WAIT_MS;
  while ((remaining.length > 0 || groupsLeft()) && Date.now() < killDeadline) {
    signalAll(remaining, "SIGKILL");
    await delay(50);
    remaining = members(await listProcesses());
  }
  if (remaining.length > 0 || groupsLeft()) {
    warn("process.reap_incomplete", { pids: remaining, pgids: owned.map((row) => row.pgid) });
  }
  return plan.map(({ targets }) =>
    Array.isArray(targets) ? { ended: targets } : { ended: [], skipped: targets },
  );
}

/**
 * Whether `pid` can be adopted by a child whose own group is `childPgid`: on POSIX a program the
 * child started in its own session (a PTY program), which only a group leader is; on Windows every
 * descendant is already in the child's job and ends with it, so a running process needs nothing
 * more (it isn't recorded again).
 */
export async function adoptable(
  pid: number,
): Promise<{ info: ProcessInfo; record: boolean } | undefined> {
  const info = await readProcess(pid);
  if (!info) return undefined;
  if (WINDOWS) return { info, record: false };
  return info.pgid === info.pid ? { info, record: true } : undefined;
}
