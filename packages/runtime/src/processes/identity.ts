/**
 * Process identity (DATA_MODEL §3 `child.start_time`, FAILURE_MODEL §2). A PID alone can be
 * reused, so a process is identified by its PID plus an opaque start time: the boot it started in
 * and when it started within that boot. Linux reads `/proc/<pid>/stat` (start ticks since boot)
 * and the boot ID; macOS reads `ps -o lstart` (seconds) and `kern.boottime` (VERIFIED_FACTS,
 * WP-02). Zombies count as gone: they have exited and only wait for their parent.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

/** One running process as the operating system reports it. */
export interface ProcessInfo {
  readonly pid: number;
  /** Its process group. */
  readonly pgid: number;
  /** `<boot>/<start>`: opaque, but comparable with {@link startedNoEarlier} within one boot. */
  readonly startTime: string;
}

/** Splits a start time into its boot and its position within the boot. */
function parts(startTime: string): { boot: string; at: number } | undefined {
  const slash = startTime.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const at = Number(startTime.slice(slash + 1));
  return Number.isSafeInteger(at) ? { boot: startTime.slice(0, slash), at } : undefined;
}

/** Whether two start times belong to the same boot of the machine. */
export function sameBoot(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  return left !== undefined && right !== undefined && left.boot === right.boot;
}

/**
 * Whether `candidate` started in the same boot as `reference` and no earlier. On macOS the
 * resolution is one second, so a process started in the same second counts as no earlier.
 */
export function startedNoEarlier(candidate: string, reference: string): boolean {
  const c = parts(candidate);
  const r = parts(reference);
  return c !== undefined && r !== undefined && c.boot === r.boot && c.at >= r.at;
}

/** Parses one `/proc/<pid>/stat` line. `comm` may contain spaces and parentheses. */
export function parseProcStat(line: string, boot: string): ProcessInfo | undefined {
  const open = line.indexOf("(");
  const close = line.lastIndexOf(")");
  if (open < 0 || close < open) return undefined;
  const pid = Number(line.slice(0, open).trim());
  // Fields after `comm` start at field 3 (state); pgrp is field 5 and starttime field 22.
  const rest = line
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // A zombie has exited; only its parent's wait is missing. It runs nothing and is skipped.
  if (rest[0] === "Z") return undefined;
  const pgid = Number(rest[2]);
  const start = rest[19];
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid) || start === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(start)) return undefined;
  return { pid, pgid, startTime: `${boot}/${start}` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parses one line of `LC_ALL=C TZ=UTC ps -o pid=,pgid=,stat=,lstart=`, such as
 * `  214 99444 Ss   Tue Oct  6 13:53:19 2026`. Zombies (`stat` starting with `Z`) are skipped.
 */
export function parsePsLine(line: string, boot: string): ProcessInfo | undefined {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 8) return undefined;
  const [pidText, pgidText, stat, , monthText, dayText, timeText, yearText] = fields;
  if (stat?.startsWith("Z")) return undefined;
  const pid = Number(pidText);
  const pgid = Number(pgidText);
  const month = MONTHS.indexOf(monthText ?? "");
  const [hours, minutes, seconds] = (timeText ?? "").split(":").map(Number);
  const millis = Date.UTC(
    Number(yearText),
    month,
    Number(dayText),
    hours ?? Number.NaN,
    minutes ?? Number.NaN,
    seconds ?? Number.NaN,
  );
  if (
    !Number.isSafeInteger(pid) ||
    !Number.isSafeInteger(pgid) ||
    month < 0 ||
    Number.isNaN(millis)
  ) {
    return undefined;
  }
  return { pid, pgid, startTime: `${boot}/${millis / 1000}` };
}

function run(file: string, args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        env: { LC_ALL: "C", TZ: "UTC", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout });
      },
    );
  });
}

let cachedBoot: Promise<string> | undefined;

/** The identity of the current boot of this machine. */
export function bootId(): Promise<string> {
  cachedBoot ??= (async () => {
    if (process.platform === "linux") {
      return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    }
    const { stdout } = await run("/usr/sbin/sysctl", ["-n", "kern.boottime"]);
    const match = /sec = (\d+), usec = (\d+)/.exec(stdout);
    if (!match) throw new Error("Couldn't read kern.boottime.");
    return `${match[1]}.${match[2]}`;
  })();
  return cachedBoot;
}

/** Reads one process, or `undefined` when no process has that PID. */
export async function readProcess(pid: number): Promise<ProcessInfo | undefined> {
  const boot = await bootId();
  if (process.platform === "linux") {
    try {
      return parseProcStat(await readFile(`/proc/${pid}/stat`, "utf8"), boot);
    } catch {
      return undefined;
    }
  }
  const { code, stdout } = await run("/bin/ps", [
    "-o",
    "pid=,pgid=,stat=,lstart=",
    "-p",
    String(pid),
  ]);
  if (code !== 0) return undefined;
  const [line] = stdout.split("\n").filter((text) => text.trim() !== "");
  return line === undefined ? undefined : parsePsLine(line, boot);
}

/** Lists every process the user can see. */
export async function listProcesses(): Promise<ProcessInfo[]> {
  const boot = await bootId();
  if (process.platform === "linux") {
    const entries = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
    const infos = await Promise.all(
      entries.map(async (name) => {
        try {
          return parseProcStat(await readFile(`/proc/${name}/stat`, "utf8"), boot);
        } catch {
          return undefined;
        }
      }),
    );
    return infos.filter((info): info is ProcessInfo => info !== undefined);
  }
  const { stdout } = await run("/bin/ps", ["-A", "-o", "pid=,pgid=,stat=,lstart="]);
  return stdout
    .split("\n")
    .map((line) => parsePsLine(line, boot))
    .filter((info): info is ProcessInfo => info !== undefined);
}

/** Whether a process with this PID exists (it may belong to another user). */
export function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether the process recorded as `pid` and `startTime` is still the one running. */
export async function isSameProcess(pid: number, startTime: string): Promise<boolean> {
  const info = await readProcess(pid);
  return info !== undefined && info.startTime === startTime;
}
