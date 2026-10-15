/**
 * Shared set-up for the interaction core's in-process suites: a real ledger with artifacts,
 * versions and views, and a fake host connection set that records port calls.
 */
import { join } from "node:path";
import { type FieldOp, MutationId, VersionId } from "@mostra/protocol";
import { appendEvent } from "../src/interaction/events.ts";
import { localViewerId, openView } from "../src/interaction/viewers.ts";
import { type Ledger, type LedgerDb, openLedger } from "../src/ledger/index.ts";
import { silentLog } from "../src/log.ts";
import { tempDir } from "./support.ts";

/** A fresh ledger in a temporary home. */
export function freshLedger(): { ledger: Ledger; storeDir: string } {
  const storeDir = join(tempDir("mostra-int"), "store");
  return { ledger: open(storeDir), storeDir };
}

/** Opens (or reopens, after a "restart") the ledger in `storeDir`. */
export function open(storeDir: string): Ledger {
  const opening = openLedger({
    storeDir,
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
  });
  if (!opening.ok) throw new Error("locked");
  return opening.ledger;
}

let counter = 0;

/** Inserts an artifact with a policy and `versions` versions, newest latest; returns their IDs. */
export function addArtifact(
  ledger: Ledger,
  options: { id: string; policy?: unknown; versions?: number; title?: string },
): { artifactId: string; versions: string[] } {
  const versions: string[] = [];
  ledger.write((db) => {
    db.run(
      "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, ?, 'review', ?, ?, ?, NULL)",
      options.id,
      options.title ?? "Sidebar review",
      JSON.stringify([{ rel: "follows", artifact: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" }]),
      options.policy === undefined ? null : JSON.stringify(options.policy),
      new Date().toISOString(),
    );
    appendEvent(db, { artifactId: options.id, type: "artifact.created", payload: {} });
    for (let number = 1; number <= (options.versions ?? 1); number++) {
      versions.push(publishVersion(db, options.id, number, options.title ?? "Sidebar review"));
    }
  });
  return { artifactId: options.id, versions };
}

/** Inserts version `number` of an artifact, makes it the latest and appends `version.published`. */
export function publishVersion(
  db: LedgerDb,
  artifactId: string,
  number: number,
  title = "Sidebar review",
): string {
  const digest = new Uint8Array(32);
  digest[0] = ++counter % 256;
  digest[1] = Math.floor(counter / 256);
  digest[2] = number;
  const id = VersionId.fromSha256(digest);
  const hex = "a".repeat(64);
  db.run(
    "INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest, manifest_json, forced_codes_json, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
    id,
    artifactId,
    number,
    hex,
    hex,
    hex,
    JSON.stringify({
      title,
      description: "Pick a sidebar",
      family: "review",
      links: [{ rel: "follows", artifact: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" }],
    }),
    new Date().toISOString(),
  );
  db.run("UPDATE artifact SET latest_version_id = ? WHERE id = ?", id, artifactId);
  appendEvent(db, { artifactId, type: "version.published", payload: { versionId: id, number } });
  return id;
}

/** The home's local viewer and a view of a version. */
export function viewOf(
  ledger: Ledger,
  artifactId: string,
  versionId: string,
  viewerId?: string,
): { viewerId: string; viewId: string } {
  return ledger.write((db) => {
    const viewer = viewerId ?? localViewerId(db);
    return { viewerId: viewer, viewId: openView(db, { artifactId, versionId, viewerId: viewer }) };
  });
}

/** One field op. */
export const set = (id: string, value: unknown, extra: Partial<FieldOp> = {}): FieldOp => ({
  id,
  value,
  ...extra,
});

/** A new mutation ID. */
export const mutationId = (): string => MutationId.create();

/** A port call a fake host received. */
export interface PortCall {
  readonly session: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** A fake set of host connections: the test decides who is registered and how they answer. */
export class FakeHosts {
  readonly calls: PortCall[] = [];
  readonly notifications: { session: number; method: string; params: unknown }[] = [];
  registered: { session: number; owner: string; ports: string[] }[] = [];
  answer: (call: PortCall) => Promise<unknown> = async () => ({ accepted: true });

  registrants(port: string): { session: number; owner: string }[] {
    return this.registered
      .filter((entry) => entry.ports.includes(port))
      .map(({ session, owner }) => ({ session, owner }));
  }

  call(session: number, method: string, params: unknown): Promise<unknown> {
    const call = { session, method, params: params as Record<string, unknown> };
    this.calls.push(call);
    return this.answer(call);
  }

  /** Set by a test to hold the connection "full" until it settles. */
  full: Promise<void> | undefined;

  drained(): Promise<void> | undefined {
    return this.full;
  }

  notify(session: number, method: string, params: unknown): boolean {
    this.notifications.push({ session, method, params });
    return true;
  }
}

/** Waits until `condition` holds, polling. */
export async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
