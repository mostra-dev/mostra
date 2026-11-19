/**
 * The directory's sweep of what sign-in leaves behind (MT-06, DATA_MODEL §7.1): expired browser
 * sessions, sign-ins in progress past their time, authorization codes once their replay window
 * passed, and expired device, access and refresh tokens go; everything live stays, and a code
 * spent within the hour is still there to revoke its grant if it is shown again (D167 item 22). A
 * sweep that finds nothing commits nothing a WAL replicator would ship (MT-05).
 */
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { CODE_KEPT_MS } from "../../src/server/auth.ts";
import { SERVER_MIGRATIONS } from "../../src/server/directory.ts";
import { sweepSignIns } from "../../src/server/sweep.ts";
import { tempDir } from "../support.ts";

const open: { close(): void }[] = [];
afterEach(() => {
  for (const one of open.splice(0)) one.close();
});

function directory(): { ledger: Ledger; dir: string } {
  const dir = tempDir("sweep-directory");
  const opening = openLedger({
    storeDir: dir,
    fileName: "server.sqlite",
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    migrations: SERVER_MIGRATIONS,
    locking: "normal",
  });
  if (!opening.ok) throw new Error("locked");
  open.push(opening.ledger);
  return { ledger: opening.ledger, dir };
}

const NOW = Date.UTC(2026, 10, 18, 12);
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe("the sign-in sweep (MT-06)", () => {
  it("removes what expired and keeps what lives, a spent code through its replay window", () => {
    const { ledger } = directory();
    ledger.write((db) => {
      db.run("INSERT INTO account (id, status, created_at) VALUES ('acct_1', 'active', ?)", at(0));
      for (const [hash, expires] of [
        ["s-expired", -1],
        ["s-live", 60_000],
      ] as const) {
        db.run(
          "INSERT INTO browser_session (hash, account_id, created_at, expires_at) VALUES (?, 'acct_1', ?, ?)",
          hash,
          at(-7 * 86_400_000),
          at(expires),
        );
      }
      for (const [hash, expires] of [
        ["i-expired", -1],
        ["i-live", 60_000],
      ] as const) {
        db.run(
          "INSERT INTO signin (hash, kind, data_json, expires_at) VALUES (?, 'provider', '{}', ?)",
          hash,
          at(expires),
        );
      }
      const token = (hash: string, kind: string, expires: number, used = false) =>
        db.run(
          "INSERT INTO token (hash, kind, expires_at, used_at) VALUES (?, ?, ?, ?)",
          hash,
          kind,
          at(expires),
          used ? at(expires - 30_000) : null,
        );
      // A code spent and expired a minute ago still revokes its grant if shown again: kept.
      token("c-spent-recent", "code", -60_000, true);
      token("c-past-window", "code", -CODE_KEPT_MS - 1);
      token("c-live", "code", 30_000);
      token("d-expired", "device", -1);
      token("d-live", "device", 60_000);
      token("a-expired", "access", -1);
      token("a-live", "access", 60_000);
      token("r-expired", "refresh", -1, true);
      token("r-live", "refresh", 86_400_000);
    });
    const swept = sweepSignIns(ledger, NOW);
    expect(swept).toEqual({ sessions: 1, signins: 1, tokens: 4 });
    const left = ledger.read((db) => ({
      sessions: db.all<{ hash: string }>("SELECT hash FROM browser_session ORDER BY hash"),
      signins: db.all<{ hash: string }>("SELECT hash FROM signin ORDER BY hash"),
      tokens: db.all<{ hash: string }>("SELECT hash FROM token ORDER BY hash"),
    }));
    expect(left.sessions.map((row) => row.hash)).toEqual(["s-live"]);
    expect(left.signins.map((row) => row.hash)).toEqual(["i-live"]);
    expect(left.tokens.map((row) => row.hash)).toEqual([
      "a-live",
      "c-live",
      "c-spent-recent",
      "d-live",
      "r-live",
    ]);
  });

  it("commits nothing when nothing expired, so an idle server's directory takes no write", () => {
    const { ledger, dir } = directory();
    ledger.write((db) => {
      db.run("INSERT INTO account (id, status, created_at) VALUES ('acct_1', 'active', ?)", at(0));
      db.run(
        "INSERT INTO browser_session (hash, account_id, created_at, expires_at) VALUES ('s', 'acct_1', ?, ?)",
        at(0),
        at(86_400_000),
      );
    });
    // A replicator's connection, reading the directory from a connection of its own.
    const replica = new Database(join(dir, "server.sqlite"), { readonly: true });
    open.push(replica);
    const before = replica.pragma("data_version", { simple: true });
    for (let sweep = 0; sweep < 20; sweep += 1) {
      expect(sweepSignIns(ledger, NOW)).toEqual({ sessions: 0, signins: 0, tokens: 0 });
    }
    expect(replica.pragma("data_version", { simple: true })).toBe(before);
  });
});
