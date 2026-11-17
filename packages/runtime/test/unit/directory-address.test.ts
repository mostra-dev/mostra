/**
 * The server's directory keeps no sign-in's address (MT-05, D176; DATA_MODEL §7.1): directory
 * migration 7 clears the addresses an operator's sign-ins wrote before it, over a real directory
 * built at migration 6 and opened again as the server opens it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { SERVER_MIGRATIONS } from "../../src/server/directory.ts";
import { tempDir } from "../support.ts";

const open: Ledger[] = [];

/** The directory in `dir`, with the server's migrations up to `upTo` (all by default). */
function directory(dir: string, upTo = SERVER_MIGRATIONS.length): Ledger {
  const opening = openLedger({
    storeDir: dir,
    fileName: "server.sqlite",
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
    migrations: SERVER_MIGRATIONS.slice(0, upTo),
    locking: "normal",
  });
  if (!opening.ok) throw new Error("locked");
  open.push(opening.ledger);
  return opening.ledger;
}

afterEach(() => {
  for (const ledger of open.splice(0)) ledger.close();
});

describe("the directory keeps no sign-in's address (MT-05)", () => {
  it("clears the addresses written before, and leaves every identity otherwise as it was", () => {
    const dir = tempDir("directory-no-address");
    const before = SERVER_MIGRATIONS.findIndex((migration) => migration.version === 7);
    expect(before).toBeGreaterThan(0);
    const old = directory(dir, before);
    old.write((db) => {
      db.run(
        "INSERT INTO account (id, name, status, created_at) VALUES ('acct_1', 'Ada', 'active', '2026-11-16T00:00:00Z')",
      );
      for (const [subject, email] of [
        ["4242", "ada@example.org"],
        ["4243", null],
      ] as const) {
        db.run(
          "INSERT INTO identity (provider, subject, account_id, email, name, linked_at, verified_by) VALUES ('github', ?, 'acct_1', ?, 'Ada', '2026-11-16T00:00:00Z', 'GitHub')",
          subject,
          email,
        );
      }
    });
    old.close();
    open.splice(open.indexOf(old), 1);

    const now = directory(dir);
    const rows = now.read((db) =>
      db.all<Record<string, unknown>>(
        "SELECT provider, subject, account_id, email, name, verified_by FROM identity ORDER BY subject",
      ),
    );
    expect(rows).toEqual([
      {
        provider: "github",
        subject: "4242",
        account_id: "acct_1",
        email: null,
        name: "Ada",
        verified_by: "GitHub",
      },
      {
        provider: "github",
        subject: "4243",
        account_id: "acct_1",
        email: null,
        name: "Ada",
        verified_by: "GitHub",
      },
    ]);
  });
});
