/**
 * An open hosted home's high-water marks (MT-05; DATA_MODEL §7.1, INTERFACES §18.2): `home_cursor`
 * is written when a home opens and when it closes, and while it is open only when a mark moved
 * (its incarnation, its head cursor or its relay mark). A home with nothing happening writes
 * nothing, so a WAL replicator has no transaction to ship; one whose incarnation rotates while it
 * is open (its owner showed it was restored) or whose head moves has the row written at the next
 * tick. The directory's own transaction count (`PRAGMA data_version`, read from a connection of
 * its own as a replicator reads it) is the measure.
 */
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { Ledger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { type DataDirectory, openDataDirectory } from "../../src/server/data.ts";
import { tempDir } from "../support.ts";

const TICK_MS = 20;
const closing: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

interface Row {
  readonly incarnation: string;
  readonly high_cursor: number;
  readonly relay_high: number;
  readonly updated_at: string;
}

/** A data directory with one home of its own account, and a replicator's view of the directory. */
async function serve(): Promise<{
  data: DataDirectory<{ incarnation: string }>;
  rotate(to: string): void;
  row(): Row | undefined;
  commits(): number;
  ledger(): Promise<Ledger>;
}> {
  const dir = join(tempDir("marks-data"), "data");
  let current = "";
  const data = await openDataDirectory<{ incarnation: string }>({
    dir,
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    env: {},
    markIntervalMs: TICK_MS,
    assembler: {
      assemble: async (home) => {
        current = home.incarnation;
        return { incarnation: home.incarnation };
      },
      disassemble: async () => {},
      busy: () => false,
      incarnation: () => current,
    },
  });
  closing.push(() => data.close());
  data.directory.write((db) => {
    db.run(
      "INSERT INTO account (id, name, status, created_at) VALUES ('acct_1', NULL, 'active', ?)",
      new Date(0).toISOString(),
    );
    db.run(
      "INSERT INTO home (id, owner_account_id, data_path, created_at) VALUES ('hom_1', 'acct_1', 'homes/hom_1', ?)",
      new Date(0).toISOString(),
    );
  });
  // A replicator's connection: it reads the directory from a process of its own.
  const replica = new Database(join(dir, "server.sqlite"), { readonly: true });
  closing.push(() => {
    replica.close();
  });
  let version = replica.pragma("data_version", { simple: true }) as number;
  let commits = 0;
  return {
    data,
    rotate: (to) => {
      current = to;
    },
    row: () =>
      replica.prepare("SELECT * FROM home_cursor WHERE home_id = 'hom_1'").get() as Row | undefined,
    // The directory's commits a replicator has seen, counted at each look (at most one a look).
    commits: () => {
      const now = replica.pragma("data_version", { simple: true }) as number;
      if (now !== version) commits += 1;
      version = now;
      return commits;
    },
    ledger: async () => (await data.home("hom_1")).ledger,
  };
}

const ticks = (count: number) => new Promise((resolve) => setTimeout(resolve, TICK_MS * count));

/** Appends an event to a hosted home's ledger, moving its head. */
function append(ledger: Ledger): number {
  return ledger.write((db) => {
    db.run(
      "INSERT INTO event (type, actor_json, payload_json, at) VALUES ('test.moved', '{}', '{}', ?)",
      new Date().toISOString(),
    );
    return (db.get<{ head: number }>("SELECT MAX(cursor) AS head FROM event")?.head ?? 0) as number;
  });
}

describe("an open home's high-water marks (MT-05)", () => {
  it("writes them at opening, then nothing while nothing happens", async () => {
    const server = await serve();
    await server.ledger();
    const opened = server.row();
    expect(opened).toBeDefined();
    const base = server.commits();
    // Fifty ticks with nothing happening: no transaction at all in the directory.
    for (let tick = 0; tick < 50; tick += 1) {
      await ticks(1);
      expect(server.commits(), `tick ${tick}`).toBe(base);
    }
    expect(server.row()).toEqual(opened);
  });

  it("writes them at the next tick once the head moves, and only once", async () => {
    const server = await serve();
    const ledger = await server.ledger();
    const base = server.commits();
    const head = append(ledger);
    await ticks(5);
    expect(server.row()?.high_cursor).toBe(head);
    const written = server.commits();
    expect(written).toBeGreaterThan(base);
    await ticks(20);
    expect(server.commits()).toBe(written);
  });

  it("writes a new incarnation the home took while open, as its marks", async () => {
    const server = await serve();
    await server.ledger();
    const before = server.row()?.incarnation;
    server.rotate("rotated-incarnation");
    await ticks(5);
    expect(server.row()?.incarnation).toBe("rotated-incarnation");
    expect(server.row()?.incarnation).not.toBe(before);
    const written = server.commits();
    await ticks(20);
    expect(server.commits()).toBe(written);
  });

  it("records the marks the home reached when it closes, before any tick", async () => {
    const server = await serve();
    const ledger = await server.ledger();
    const before = server.row()?.updated_at;
    const head = append(ledger);
    // Closed before a tick could write the moved head: the closing write records it.
    await server.data.closeHome("hom_1");
    expect(server.row()?.updated_at).not.toBe(before);
    expect(server.row()?.high_cursor).toBe(head);
  });
});
