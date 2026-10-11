/**
 * `instance.json` (D81): how starters and clients find the supervisor that owns a home. It is a
 * discovery record, never a lock: the ledger lock decides ownership. The owner writes it
 * atomically after binding its socket and removes it on a clean exit; a record whose PID and
 * start time match no live process is stale.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";
import { isSameProcess } from "../processes/index.ts";

/** The record's file name in the home. */
export const INSTANCE_FILE = "instance.json";

/** What `instance.json` holds. */
export interface InstanceRecord {
  /** The owner's process ID. */
  readonly pid: number;
  /** The owner's process start time (processes/identity.ts). */
  readonly startTime: string;
  /** The control socket clients attach to. */
  readonly socket: string;
  /** The owner's runtime release. */
  readonly runtimeVersion: string;
  /** The host protocol revisions the owner speaks. */
  readonly revisions: readonly string[];
  /** `host` or `daemon` (`InstanceInfo.mode`). */
  readonly mode: "host" | "daemon";
  /** When the owner took the home (RFC 3339). */
  readonly startedAt: string;
}

const InstanceRecordSchema = z.object({
  pid: z.int().min(1),
  startTime: z.string(),
  socket: z.string(),
  runtimeVersion: z.string(),
  revisions: z.array(z.string()),
  mode: z.enum(["host", "daemon"]),
  startedAt: z.string(),
});

/** Reads the record, or `undefined` when it is missing or unreadable. */
export function readInstanceRecord(home: string): InstanceRecord | undefined {
  try {
    const parsed = InstanceRecordSchema.safeParse(
      JSON.parse(readFileSync(join(home, INSTANCE_FILE), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the record when it names a live process: the owner, or a starter's view of it. */
export async function readLiveInstanceRecord(home: string): Promise<InstanceRecord | undefined> {
  const record = readInstanceRecord(home);
  if (!record) return undefined;
  return (await isSameProcess(record.pid, record.startTime)) ? record : undefined;
}

/** Writes the record atomically (a temporary file, then a rename), mode 0600. */
export function writeInstanceRecord(home: string, record: InstanceRecord): void {
  const file = join(home, INSTANCE_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** Removes the record when it is still this process's (a clean exit). */
export function removeInstanceRecord(home: string, pid: number, startTime: string): void {
  const record = readInstanceRecord(home);
  if (record && record.pid === pid && record.startTime === startTime) {
    rmSync(join(home, INSTANCE_FILE), { force: true });
  }
}
