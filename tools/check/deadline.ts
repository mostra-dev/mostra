/**
 * `pnpm check --deadline <minutes>`: a run still going at its deadline says where it hung, then
 * fails, so a CI job's failure steps still run and keep the evidence (#55). A job GitHub cancels
 * for its own time limit runs no `if: failure()` step and keeps nothing; a step's time limit kills
 * every process of the step before anything can look at them.
 *
 * At the deadline the report (every process with its parent, elapsed time, state and, where the
 * system shows it, what it waits on in the kernel) goes to stdout and to `hang.txt` in
 * `MOSTRA_TEST_LOG_DIR`, with a copy of each supervisor log a test home still holds there: a test
 * file that hung never reached the `afterAll` that keeps its homes' logs.
 */
import { spawnSync } from "node:child_process";
import { cpSync, type Dirent, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** The command that lists every process on `platform`, with what a hang report needs. */
export function processListing(platform: NodeJS.Platform): {
  readonly command: string;
  readonly args: readonly string[];
} {
  if (platform === "linux")
    return { command: "ps", args: ["-eo", "pid,ppid,pgid,etimes,stat,wchan:32,args", "--forest"] };
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Sort-Object ParentProcessId,ProcessId | Format-Table ProcessId,ParentProcessId,CreationDate,CommandLine -AutoSize -Wrap | Out-String -Width 400",
      ],
    };
  }
  return { command: "ps", args: ["-axo", "pid,ppid,pgid,etime,state,wchan,command"] };
}

/**
 * The `logs` directories under `root` that hold a supervisor's log, at most `depth` levels down:
 * a test home is `<tmp>/<prefix>-XXXXXX/…/home/logs`.
 */
export function supervisorLogDirs(root: string, depth = 4): string[] {
  const found: string[] = [];
  const visit = (at: string, level: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(at, entry.name);
      if (entry.name === "logs") {
        try {
          if (readdirSync(path).includes("supervisor.log")) found.push(path);
        } catch {
          // Unreadable: someone else's.
        }
      } else if (level < depth && entry.name !== "node_modules") visit(path, level + 1);
    }
  };
  visit(root, 0);
  return found;
}

/**
 * Where test homes live: the system's temporary directory, and on POSIX `/tmp`, where the runtime's
 * suites make their short-pathed homes (`tempDir(…, true)`, for macOS's 104-byte socket paths),
 * which on macOS isn't `tmpdir()` (GPT review of MT-02). Each real directory once.
 */
export function searchRoots(platform: NodeJS.Platform, temporary: string): string[] {
  const roots = platform === "win32" ? [temporary] : [temporary, "/tmp"];
  const real = new Map<string, string>();
  for (const root of roots) {
    try {
      real.set(realpathSync.native(root), root);
    } catch {
      // Missing: nothing lives there.
    }
  }
  return [...real.keys()];
}

/** Writes the hang report; returns its text. */
export function reportHang(minutes: number, into: string | undefined): string {
  const { command, args } = processListing(process.platform);
  const listed = spawnSync(command, [...args], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = [
    `pnpm check: still running at its ${minutes}-minute deadline. The processes running now:`,
    listed.stdout?.trim() || `(${command} gave nothing: ${listed.error?.message ?? listed.stderr})`,
  ].join("\n");
  if (into) {
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, "hang.txt"), `${text}\n`);
    for (const root of searchRoots(process.platform, tmpdir())) {
      for (const dir of supervisorLogDirs(root)) {
        const name = relative(root, dir).replaceAll(/[\\/]/g, "-");
        try {
          cpSync(dir, join(into, "leftover", name), { recursive: true });
        } catch {
          // A log still being written is kept as far as it could be read.
        }
      }
    }
  }
  return text;
}

/** Every process below `root` in a table of (pid, parent) pairs, children before parents' ends. */
export function descendants(
  pairs: ReadonlyArray<readonly [number, number]>,
  root: number,
): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, parent] of pairs) {
    if (pid === parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const found: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [...(children.get(root) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/** Stops every process this one started, so nothing of the run holds the step's output open. */
function stopDescendants(): void {
  if (process.platform === "win32") {
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Not PowerShell itself, a child of this process too, which would end the cleanup first.
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { taskkill.exe /F /T /PID $_.ProcessId }`,
      ],
      { stdio: "ignore", timeout: 120_000, windowsHide: true },
    );
    return;
  }
  const listed = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 30_000 });
  const pairs = (listed.stdout ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isInteger));
  for (const pid of descendants(pairs, process.pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone already.
    }
  }
}

/** Arms the deadline: at `minutes`, reports, stops the run and exits 1. Returns the disarm. */
export function armDeadline(minutes: number, into: string | undefined): () => void {
  const timer = setTimeout(() => {
    console.log(`\n${reportHang(minutes, into)}`);
    stopDescendants();
    process.exit(1);
  }, minutes * 60_000);
  timer.unref();
  return () => clearTimeout(timer);
}
