/**
 * The owner's answer to relayed authoring (INTERFACES §18.8, D165 item 5): what of this machine a
 * server may read through `port/relay.author`. A screenshot is a PNG verify wrote, and nothing else
 * of verify's cache crosses the relay (Fable review of WP-30, 10); directories stay inside the MCP
 * workspace.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOwnerAuthor } from "../../src/link/index.ts";
import { silentLog } from "../../src/log.ts";

/** A minimal PNG: its signature and one IHDR chunk's worth of bytes. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(25),
]);

describe("relayed authoring on the owner", () => {
  const home = mkdtempSync(join(tmpdir(), "owner-author-"));
  const runs = join(home, "cache", "verify", "runs", "run-1");
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, "desktop.png"), PNG);
  writeFileSync(join(runs, "ledger.sqlite"), "SQLite format 3\u0000 a run's scratch ledger");
  writeFileSync(join(runs, "key.png"), "a run's key, named to pass for a screenshot");
  writeFileSync(join(home, "outside.png"), PNG);
  // A link needs a privilege on Windows a test runner may lack: the case runs where it can be made.
  let linked = true;
  try {
    symlinkSync(join(home, "outside.png"), join(runs, "linked.png"));
  } catch {
    linked = false;
  }
  const author = createOwnerAuthor({
    home,
    env: { MOSTRA_MCP_WORKSPACE: join(home, "work") },
    log: silentLog,
    runtimeVersion: "0.0.0",
    protocol: () => undefined,
    hostedOn: () => [],
  });
  const screenshot = (path: string) =>
    author("https://api.example", { method: "verify/screenshot", params: { path } });

  it("returns a screenshot verify wrote", async () => {
    expect(await screenshot(join(runs, "desktop.png"))).toEqual({ png: PNG.toString("base64") });
  });

  it("returns nothing else of verify's cache, nor what a link inside it leads to", async () => {
    for (const name of ["ledger.sqlite", "key.png", ...(linked ? ["linked.png"] : [])]) {
      expect(await screenshot(join(runs, name)), name).toEqual({});
    }
    expect(await screenshot(join(home, "outside.png"))).toEqual({});
  });
});
