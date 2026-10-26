/**
 * A shim's process tree on Windows, for ending it when the shim won't close (Opus review of WP-W3,
 * finding 3). Windows has no process groups: `taskkill /T` walks parent PIDs from a process that
 * must still run, so once the shell a host command runs in has exited, its descendants can't be
 * reached from its PID. The kit therefore notes the tree while the shell runs (the helper's
 * `processes`: PID, parent and creation time of every process) and ends exactly those processes
 * later with the helper's `reap`, which ends a process only while its creation time still matches,
 * so a PID Windows handed to another process meanwhile is never touched.
 */
import { spawnSync } from "node:child_process";

/** One process as `mostra-win processes` lists it. */
export interface ProcessEntry {
  readonly pid: number;
  readonly ppid?: number | undefined;
  /** `win/<100 ns since 1601>`; absent for a process this user can't open. */
  readonly startTime?: string | undefined;
}

/** A process to end later: its PID and creation time. */
export interface TreeMember {
  readonly pid: number;
  readonly startTime: string;
}

function created(entry: ProcessEntry): bigint | undefined {
  const match = /^win\/(\d+)$/.exec(entry.startTime ?? "");
  return match ? BigInt(match[1] as string) : undefined;
}

/**
 * `root` and every process below it in `processes`. A process counts as a child of another only
 * when it was created after it, since a parent PID outlives its process and can name a later one;
 * processes without a creation time (another user's) are left out, as they can't be ended safely.
 */
export function treeOf(processes: readonly ProcessEntry[], root: number): TreeMember[] {
  const byParent = new Map<number, ProcessEntry[]>();
  for (const entry of processes) {
    if (entry.ppid === undefined || entry.ppid === entry.pid) continue;
    const siblings = byParent.get(entry.ppid) ?? [];
    siblings.push(entry);
    byParent.set(entry.ppid, siblings);
  }
  const top = processes.find((entry) => entry.pid === root);
  const topCreated = top ? created(top) : undefined;
  if (top === undefined || topCreated === undefined) return [];
  const out: TreeMember[] = [{ pid: root, startTime: top.startTime as string }];
  const queue: [number, bigint][] = [[root, topCreated]];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const [parent, parentCreated] = queue.shift() as [number, bigint];
    for (const child of byParent.get(parent) ?? []) {
      const born = created(child);
      if (born === undefined || born < parentCreated || seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push({ pid: child.pid, startTime: child.startTime as string });
      queue.push([child.pid, born]);
    }
  }
  return out;
}

/** Runs the helper with `args`; its `result`, or `undefined` when it fails. */
function helperResult(helper: string, args: readonly string[]): unknown {
  const run = spawnSync(helper, args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (run.status !== 0) return undefined;
  try {
    const answer = JSON.parse(run.stdout) as { ok?: boolean; result?: unknown };
    return answer.ok === true ? answer.result : undefined;
  } catch {
    return undefined;
  }
}

/** The tree under `root` now, through the helper; empty when the helper can't list processes. */
export function snapshotTree(helper: string, root: number): TreeMember[] {
  const listed = helperResult(helper, ["processes"]);
  return Array.isArray(listed) ? treeOf(listed as ProcessEntry[], root) : [];
}

/** Ends every member still running with its noted creation time (`mostra-win reap`). */
export function endTree(helper: string, members: readonly TreeMember[]): void {
  if (members.length === 0) return;
  helperResult(helper, ["reap", ...members.map((member) => `${member.pid}:${member.startTime}`)]);
}
