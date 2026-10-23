/**
 * The process manager (RT-09, RT-10, ARCHITECTURE §4, FAILURE_MODEL §2). Every child starts
 * behind a gate in a group of its own (a process group on POSIX, a Job Object on Windows,
 * `platform/launch.ts`) and is recorded in the ledger's `child` table with its PID and start
 * time before it may run. A child's group dies with it, and a supervisor that starts after a
 * crash reaps every recorded group that is still running.
 */
import { createInterface } from "node:readline";
import type { Duplex } from "node:stream";
import { type JsonRpcParams, RpcPeer } from "@mostra/protocol";
import * as z from "zod";
import { type Faults, noFaults } from "../faults.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Environment, Log, Redactor } from "../log.ts";
import { adoptable, launch, reapRecorded } from "../platform/index.ts";

/** How long a stopping child gets between SIGTERM and SIGKILL, by default. */
const DEFAULT_GRACE_MS = 5000;
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
   * Receives each line the child writes to stdout, redacted, instead of the log: for children
   * whose output is data, such as the installer's NDJSON report. Every line has arrived before
   * `exited` resolves.
   */
  readonly onStdout?: (line: string) => void;
  /**
   * Opens a JSON-RPC channel over Node IPC; the command must then be a Node.js executable. The
   * handlers answer the child's requests besides the built-in `child/adopt` and `child/release`.
   */
  readonly ipc?: {
    readonly onRequest?: (method: string, params: unknown) => unknown;
    readonly onNotification?: (method: string, params: unknown) => void;
  };
  /**
   * Opens a plain byte channel as the child's fd 4 (an artifact's worker, D124): a pipe the child
   * reads and writes as it likes, unlike `ipc`, which is Node's own channel on the main thread.
   * The two exclude each other.
   */
  readonly channel?: true;
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
  /** The child's fd 4, when it was started with `channel`. */
  readonly channel?: Duplex;
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
  /** Ends every child at once without waiting: the last resort at the supervisor's exit. */
  killAll(): void;
}

/** Options for {@link openProcessManager}. */
export interface ProcessManagerOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  /** Learns the secrets children receive, so their output is redacted wherever it goes. */
  readonly redactor: Redactor;
  /** Test fault points (`spawn:before-record`). Default: none. */
  readonly faults?: Faults;
}

/**
 * Opens the process manager: first reaps every child a previous supervisor of this home left
 * running (FAILURE_MODEL §2), then accepts new children. Call it only while holding the home's
 * ledger lock, so no live supervisor's children are touched.
 */
export async function openProcessManager(
  options: ProcessManagerOptions,
): Promise<{ manager: ProcessManager; reaped: readonly ReapedChild[] }> {
  const reaped = await reap(options.ledger, options.log);
  return { manager: createManager(options), reaped };
}

/** Waits for `promise` to settle, or `ms` at most, leaving no timer behind. */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function reap(ledger: Ledger, log: Log): Promise<ReapedChild[]> {
  const rows = ledger.read((db) => db.all<ChildRow>("SELECT * FROM child ORDER BY started_at"));
  if (rows.length === 0) return [];
  const outcomes = await reapRecorded(rows, (event, fields) => log.warn(event, fields));
  ledger.write((db) => {
    for (const row of rows) {
      db.run("DELETE FROM child WHERE pid = ? AND start_time = ?", row.pid, row.start_time);
    }
  });
  const report = rows.map((row, index): ReapedChild => {
    const base = { pid: row.pid, kind: row.kind, ownerRef: row.owner_ref };
    const outcome = outcomes[index];
    return outcome?.skipped === undefined
      ? { ...base, signalled: outcome?.ended ?? [] }
      : { ...base, signalled: [], skipped: outcome.skipped };
  });
  for (const entry of report) log.info("process.reaped", { ...entry });
  return report;
}

function createManager({
  ledger,
  log,
  redactor,
  faults = noFaults,
}: ProcessManagerOptions): ProcessManager {
  const running = new Map<number, { handle: ChildHandle; kill(): void }>();
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
  const warn = (event: string, fields: Readonly<Record<string, unknown>>): void =>
    log.warn(event, fields);

  const spawnChild = async (spec: SpawnSpec): Promise<ChildHandle> => {
    if (stopping) throw new Error("The process manager is stopping.");
    if (spec.ipc && spec.channel) throw new Error("A child takes ipc or a channel, not both.");
    for (const value of spec.redact ?? []) redactor.protect(value);
    redactor.protectEnvironment(spec.env ?? process.env);
    // fd 3 is the gate; the IPC channel or the byte channel, when there is one, is fd 4.
    const launched = launch(
      {
        kind: spec.kind,
        command: spec.command,
        args: spec.args ?? [],
        cwd: spec.cwd,
        env: spec.env ?? process.env,
        extra: spec.ipc ? "ipc" : spec.channel ? "channel" : undefined,
      },
      warn,
    );
    const child = launched.process;
    const startedAt = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    // The gate's process ID until the child's own is known (the same one on POSIX).
    let pid = child.pid ?? 0;
    // After the spawn, errors (a failed signal or IPC send) are reported, never thrown: an
    // unhandled 'error' event would take the supervisor down.
    child.on("error", (error) => log.warn("process.error", { kind: spec.kind, pid, error }));
    const adopted = new Map<number, number>(); // adopted pid → its pgid
    const stderrTail: string[] = [];
    const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    // Output can still be in the pipes when the process exits; `exited` waits for it.
    const drained: Promise<unknown>[] = [];

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      drained.push(new Promise((resolve) => lines.once("close", resolve)));
      lines.on("line", (line) => {
        if (spec.onStdout) spec.onStdout(redactor.redact(line));
        else log.info("process.stdout", { kind: spec.kind, pid, line });
      });
    }
    if (child.stderr) {
      const lines = createInterface({ input: child.stderr });
      drained.push(new Promise((resolve) => lines.once("close", resolve)));
      lines.on("line", (line) => {
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
            // Only a group leader (a program in its own session, such as a PTY program) can be
            // adopted on POSIX: its whole group is then signalled, and no foreign group ever is.
            // On Windows every descendant already ends with the child's job.
            const found = await adoptable(parsed.data.pid);
            if (!found) return { adopted: false };
            if (!found.record) return { adopted: true };
            adopted.set(found.info.pid, found.info.pgid);
            record({
              pid: found.info.pid,
              start_time: found.info.startTime,
              kind: `${spec.kind}/adopted`,
              owner_ref: spec.ownerRef,
              pgid: found.info.pgid,
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

    // Record the child before it may run its command (RT-09, issue #7), then open its gate. If it
    // already exited, nothing is left to reap.
    const registered = (async () => {
      const info = await launched.identify();
      faults.at("spawn:before-record");
      // The same point for one kind of child (`spawn:before-record:demo`), for an instance whose
      // start already spawns children of its own (on Windows the control pipe's helper).
      faults.at(`spawn:before-record:${spec.kind}`);
      // A supervisor stalled here (a test's `hang`) shows the child waiting at its gate, unrecorded.
      if (faults.hangs(`spawn:before-record:${spec.kind}`)) await new Promise(() => {});
      if (!info) return;
      pid = info.pid;
      record({
        pid: info.pid,
        start_time: info.startTime,
        kind: spec.kind,
        owner_ref: spec.ownerRef,
        pgid: info.pid,
        started_at: startedAt,
        parent_pid: null,
      });
      launched.release();
    })();

    // From here on, the child's group ends with it, whatever happens to its registration.
    const exited = exit.then(async ({ code, signal }) => {
      // The child's lifetime bounds its group and the groups it adopted.
      await launched.sweep([...adopted.values()]);
      // The group is gone, so nothing holds the pipes open any more; the bound covers a
      // descendant that left the group with them.
      await settleWithin(Promise.all(drained), 2000);
      await registered.catch(() => {});
      running.delete(child.pid ?? 0);
      try {
        forget(pid);
      } catch (error) {
        log.warn("process.forget_failed", { pid, error });
      }
      log.info("process.exited", { kind: spec.kind, pid, code, signal });
      return { code, signal, stderrTail: [...stderrTail] };
    });

    const channel = spec.channel ? (child.stdio[4] as Duplex | null) : null;
    channel?.on("error", (error) =>
      log.warn("process.channel_error", { kind: spec.kind, pid, error }),
    );
    const stop = async (graceMs = DEFAULT_GRACE_MS): Promise<ChildExit> => {
      if (launched.running()) await launched.end(graceMs, [...adopted.values()]);
      return exited;
    };
    const handle = {
      get pid() {
        return pid;
      },
      kind: spec.kind,
      ownerRef: spec.ownerRef,
      startedAt,
      ...(channel ? { channel } : {}),
      exited,
      request(method: string, params?: JsonRpcParams, options?: { timeoutMs?: number }) {
        if (!peer) return Promise.reject(new Error(`${spec.kind} was started without IPC.`));
        return peer.request(method, params, options);
      },
      stop,
    } satisfies ChildHandle;
    // Tracked from the spawn on, so stopAll reaches a child whose registration is still running.
    running.set(child.pid ?? 0, { handle, kill: () => launched.kill() });

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
      [...running.values()].map(({ handle }) => ({
        pid: handle.pid,
        kind: handle.kind,
        ownerRef: handle.ownerRef,
        startedAt: handle.startedAt,
      })),
    async stopAll(graceMs = DEFAULT_GRACE_MS) {
      stopping = true;
      // Spawns already under way finish first, so their children are tracked and stopped too.
      await Promise.all(inflight);
      await Promise.all([...running.values()].map(({ handle }) => handle.stop(graceMs)));
    },
    killAll() {
      for (const { kill } of running.values()) kill();
    },
  };
}
