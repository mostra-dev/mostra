/**
 * The process manager (RT-09, ARCHITECTURE §4, FAILURE_MODEL §2). Every child runs as the leader
 * of its own process group and is recorded in the ledger's `child` table with its PID and start
 * time before anyone relies on it. A child's group dies with it, and a supervisor that starts
 * after a crash reaps every recorded group that is still running.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { type JsonRpcParams, RpcPeer } from "@mostra/protocol";
import * as z from "zod";
import type { Ledger } from "../ledger/index.ts";
import type { Environment, Log, Redactor } from "../log.ts";
import {
  listProcesses,
  type ProcessInfo,
  readProcess,
  sameBoot,
  startedNoEarlier,
} from "./identity.ts";

/** How long a stopping child gets between SIGTERM and SIGKILL, by default. */
const DEFAULT_GRACE_MS = 5000;
/** How long reaping waits between SIGTERM and SIGKILL. */
const REAP_GRACE_MS = 2000;
/** How long to wait for SIGKILLed processes to disappear before reporting them. */
const KILL_WAIT_MS = 5000;
/** How many stderr lines a child's exit report keeps. */
const STDERR_TAIL = 50;

/** How a child ended. */
export interface ChildExit {
  /** The exit code, or `null` when a signal ended it. */
  readonly code: number | null;
  /** The signal that ended it, if any. */
  readonly signal: string | null;
  /** Its last stderr lines, for diagnostics such as `MOSTRA_BUILD_CRASHED`. */
  readonly stderrTail: readonly string[];
}

/** What to start. */
export interface SpawnSpec {
  /** What the child is: `builder`, `verify`, `worker`, `pty-host`, `demo`, `install` … */
  readonly kind: string;
  /** What it serves, such as an artifact or version ID. */
  readonly ownerRef: string;
  /** The executable. */
  readonly command: string;
  /** Its arguments. */
  readonly args?: readonly string[];
  /** Its working directory. Default: the supervisor's. */
  readonly cwd?: string;
  /** The child's whole environment. Default: the supervisor's. */
  readonly env?: Environment;
  /**
   * Values the child receives that must never appear in logs or reports, such as secrets.
   * Variables whose names look like secrets (`*_TOKEN`, `*_SECRET` …) are redacted as well.
   */
  readonly redact?: readonly string[];
  /**
   * Opens a JSON-RPC channel over Node IPC; the command must then be a Node.js executable. The
   * handlers answer the child's requests besides the built-in `child/adopt` and `child/release`.
   */
  readonly ipc?: {
    readonly onRequest?: (method: string, params: unknown) => unknown;
    readonly onNotification?: (method: string, params: unknown) => void;
  };
}

/** A running child. */
export interface ChildHandle {
  /** Its process ID, which is also its process group ID. */
  readonly pid: number;
  /** What it is (`SpawnSpec.kind`). */
  readonly kind: string;
  /** What it serves (`SpawnSpec.ownerRef`). */
  readonly ownerRef: string;
  /** When it was started (RFC 3339). */
  readonly startedAt: string;
  /** Sends requests to the child, when it was started with `ipc`. */
  request(
    method: string,
    params?: JsonRpcParams,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  /** Resolves when the child has exited and its process groups are gone. */
  readonly exited: Promise<ChildExit>;
  /** Stops the child: SIGTERM to its group, SIGKILL after `graceMs`. */
  stop(graceMs?: number): Promise<ChildExit>;
}

/** What reaping found for one recorded child. */
export interface ReapedChild {
  /** The recorded process ID. */
  readonly pid: number;
  /** The recorded kind; a program a child adopted has its parent's kind plus "/adopted". */
  readonly kind: string;
  /** What it served. */
  readonly ownerRef: string;
  /** The processes that were signalled: the leader if it still ran, and its group's members. */
  readonly signalled: readonly number[];
  /** Why nothing was signalled, when nothing was. */
  readonly skipped?: "gone" | "pid reused" | "other boot";
}

interface ChildRow {
  pid: number;
  start_time: string;
  kind: string;
  owner_ref: string;
  pgid: number;
  started_at: string;
  parent_pid: number | null;
}

const AdoptParams = z.object({ pid: z.int().min(2) });

/** The process manager of one supervisor. */
export interface ProcessManager {
  /** Starts a child in its own process group and records it. */
  spawn(spec: SpawnSpec): Promise<ChildHandle>;
  /** The children running now, for `instance/status`. */
  list(): readonly { pid: number; kind: string; ownerRef: string; startedAt: string }[];
  /** Stops every child; used when the supervisor stops. */
  stopAll(graceMs?: number): Promise<void>;
}

/** Options for {@link openProcessManager}. */
export interface ProcessManagerOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  /** Learns the secrets children receive, so their output is redacted wherever it goes. */
  readonly redactor: Redactor;
}

/**
 * Opens the process manager: first reaps every child a previous supervisor of this home left
 * running (FAILURE_MODEL §2), then accepts new children. Call it only while holding the home's
 * ledger lock, so no live supervisor's children are touched.
 */
export async function openProcessManager(
  options: ProcessManagerOptions,
): Promise<{ manager: ProcessManager; reaped: readonly ReapedChild[] }> {
  const reaped = await reapRecorded(options.ledger, options.log);
  return { manager: createManager(options), reaped };
}

/** Signals `pids`, ignoring ones already gone. */
function signalAll(pids: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

const groupAlive = (pgid: number): boolean => signalGroup(pgid, 0 as unknown as NodeJS.Signals);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The processes of a recorded group that are provably the recorded child's: see FAILURE_MODEL §2. */
function targetsFor(
  row: ChildRow,
  processes: readonly ProcessInfo[],
): number[] | NonNullable<ReapedChild["skipped"]> {
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

async function reapRecorded(ledger: Ledger, log: Log): Promise<ReapedChild[]> {
  const rows = ledger.read((db) => db.all<ChildRow>("SELECT * FROM child ORDER BY started_at"));
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
  signalAll(members(before), "SIGTERM");
  const deadline = Date.now() + REAP_GRACE_MS;
  let remaining = members(await listProcesses());
  while (remaining.length > 0 && Date.now() < deadline) {
    await delay(100);
    remaining = members(await listProcesses());
  }
  const killDeadline = Date.now() + KILL_WAIT_MS;
  while (remaining.length > 0 && Date.now() < killDeadline) {
    signalAll(remaining, "SIGKILL");
    await delay(50);
    remaining = members(await listProcesses());
  }
  if (remaining.length > 0) log.warn("process.reap_incomplete", { pids: remaining });
  ledger.write((db) => {
    for (const { row } of plan) {
      db.run("DELETE FROM child WHERE pid = ? AND start_time = ?", row.pid, row.start_time);
    }
  });
  const report = plan.map(({ row, targets }): ReapedChild => {
    const base = { pid: row.pid, kind: row.kind, ownerRef: row.owner_ref };
    return Array.isArray(targets)
      ? { ...base, signalled: targets }
      : { ...base, signalled: [], skipped: targets };
  });
  for (const entry of report) log.info("process.reaped", { ...entry });
  return report;
}

function createManager({ ledger, log, redactor }: ProcessManagerOptions): ProcessManager {
  const running = new Map<number, ChildHandle>();
  let stopping = false;

  const record = (row: ChildRow): void => {
    ledger.write((db) =>
      db.run(
        "INSERT OR REPLACE INTO child (pid, start_time, kind, owner_ref, pgid, started_at, parent_pid) VALUES (?, ?, ?, ?, ?, ?, ?)",
        row.pid,
        row.start_time,
        row.kind,
        row.owner_ref,
        row.pgid,
        row.started_at,
        row.parent_pid,
      ),
    );
  };
  const forget = (pid: number): void => {
    ledger.write((db) => db.run("DELETE FROM child WHERE pid = ? OR parent_pid = ?", pid, pid));
  };

  /**
   * Terminates groups: SIGTERM, then SIGKILL after `graceMs` to those still present, then waits
   * (boundedly) until they are gone.
   */
  const endGroups = async (pgids: readonly number[], graceMs: number): Promise<void> => {
    for (const pgid of pgids) signalGroup(pgid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && pgids.some(groupAlive)) await delay(25);
    for (const pgid of pgids) if (groupAlive(pgid)) signalGroup(pgid, "SIGKILL");
    const killDeadline = Date.now() + KILL_WAIT_MS;
    while (Date.now() < killDeadline && pgids.some(groupAlive)) await delay(10);
    const left = pgids.filter(groupAlive);
    if (left.length > 0) log.warn("process.group_survived_sigkill", { pgids: left });
  };

  const spawnChild = async (spec: SpawnSpec): Promise<ChildHandle> => {
    if (stopping) throw new Error("The process manager is stopping.");
    for (const value of spec.redact ?? []) redactor.protect(value);
    redactor.protectEnvironment(spec.env ?? process.env);
    const child: ChildProcess = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      detached: true,
      stdio: spec.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
      serialization: "json",
    });
    const startedAt = new Date().toISOString();
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("spawn", () => resolve(child.pid ?? 0));
      child.once("error", reject);
    });
    // After the spawn, errors (a failed signal or IPC send) are reported, never thrown: an
    // unhandled 'error' event would take the supervisor down.
    child.on("error", (error) => log.warn("process.error", { kind: spec.kind, pid, error }));
    const adopted = new Map<number, number>(); // adopted pid → its pgid
    const stderrTail: string[] = [];
    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) =>
        log.info("process.stdout", { kind: spec.kind, pid, line }),
      );
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        // The log redacts what it writes; the tail feeds diagnostics, so it is redacted here.
        stderrTail.push(redactor.redact(line));
        if (stderrTail.length > STDERR_TAIL) stderrTail.shift();
        log.info("process.stderr", { kind: spec.kind, pid, line });
      });
    }

    let peer: RpcPeer | undefined;
    if (spec.ipc) {
      const ipc = spec.ipc;
      peer = new RpcPeer({
        send: (message) => {
          if (!child.connected) throw new Error("The IPC channel is closed.");
          child.send(message);
        },
        onRequest: async (method, params) => {
          if (method === "child/adopt" || method === "child/release") {
            const parsed = AdoptParams.safeParse(params);
            if (!parsed.success) throw new Error(`Invalid params for ${method}.`);
            if (method === "child/release") {
              adopted.delete(parsed.data.pid);
              ledger.write((db) =>
                db.run("DELETE FROM child WHERE pid = ? AND parent_pid = ?", parsed.data.pid, pid),
              );
              return {};
            }
            const info = await readProcess(parsed.data.pid);
            // Only a group leader (a program in its own session, such as a PTY program) can be
            // adopted: its whole group is then signalled, and no foreign group ever is.
            if (!info || info.pgid !== info.pid) return { adopted: false };
            adopted.set(info.pid, info.pgid);
            record({
              pid: info.pid,
              start_time: info.startTime,
              kind: `${spec.kind}/adopted`,
              owner_ref: spec.ownerRef,
              pgid: info.pgid,
              started_at: new Date().toISOString(),
              parent_pid: pid,
            });
            return { adopted: true };
          }
          if (!ipc.onRequest) throw new Error(`No handler for ${method}.`);
          return ipc.onRequest(method, params);
        },
        ...(ipc.onNotification ? { onNotification: ipc.onNotification } : {}),
        onInternalError: (error, method) =>
          log.error("process.ipc_error", { kind: spec.kind, pid, method, error }),
      });
      const connected = peer;
      child.on("message", (message) => connected.receive(message));
      child.on("disconnect", () => connected.close());
    }

    // Record the child before anyone relies on it (RT-09). If it already exited, nothing is left
    // to reap.
    const registered = (async () => {
      const info = await readProcess(pid);
      if (!info) return;
      record({
        pid,
        start_time: info.startTime,
        kind: spec.kind,
        owner_ref: spec.ownerRef,
        pgid: pid,
        started_at: startedAt,
        parent_pid: null,
      });
    })();

    // From here on, the child's group ends with it, whatever happens to its registration.
    const exited = exit.then(async ({ code, signal }) => {
      // The child's lifetime bounds its group and the groups it adopted.
      await endGroups([pid, ...adopted.values()], 2000);
      await registered.catch(() => {});
      running.delete(pid);
      try {
        forget(pid);
      } catch (error) {
        log.warn("process.forget_failed", { pid, error });
      }
      log.info("process.exited", { kind: spec.kind, pid, code, signal });
      return { code, signal, stderrTail: [...stderrTail] };
    });

    const handle: ChildHandle = {
      pid,
      kind: spec.kind,
      ownerRef: spec.ownerRef,
      startedAt,
      exited,
      request(method, params, options) {
        if (!peer) return Promise.reject(new Error(`${spec.kind} was started without IPC.`));
        return peer.request(method, params, options);
      },
      async stop(graceMs = DEFAULT_GRACE_MS) {
        if (child.exitCode === null && child.signalCode === null) {
          await endGroups([pid, ...adopted.values()], graceMs);
        }
        return exited;
      },
    };
    // Tracked from the spawn on, so stopAll reaches a child whose registration is still running.
    running.set(pid, handle);

    try {
      await registered;
    } catch (error) {
      // A child that can't be recorded can't be reaped after a crash: don't keep it.
      log.error("process.record_failed", { kind: spec.kind, pid, error });
      await handle.stop(500);
      throw error;
    }
    log.info("process.started", { kind: spec.kind, ownerRef: spec.ownerRef, pid });
    return handle;
  };

  /** Spawns in progress, so stopAll waits for them before it stops the children. */
  const inflight = new Set<Promise<unknown>>();
  const trackedSpawn = (spec: SpawnSpec): Promise<ChildHandle> => {
    const spawning = spawnChild(spec);
    const settled = spawning.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(settled);
    void settled.then(() => inflight.delete(settled));
    return spawning;
  };

  return {
    spawn: trackedSpawn,
    list: () =>
      [...running.values()].map((child) => ({
        pid: child.pid,
        kind: child.kind,
        ownerRef: child.ownerRef,
        startedAt: child.startedAt,
      })),
    async stopAll(graceMs = DEFAULT_GRACE_MS) {
      stopping = true;
      // Spawns already under way finish first, so their children are tracked and stopped too.
      await Promise.all(inflight);
      await Promise.all([...running.values()].map((child) => child.stop(graceMs)));
    },
  };
}
