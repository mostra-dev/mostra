/**
 * The version store's durability rules (FAILURE_MODEL §3, review finding 2): a file that can't be
 * synced fails the publish; only a directory may lack sync support.
 */
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sealPlaced } from "../../src/platform/index.ts";
import { fsyncPath, removeTree } from "../../src/registry/index.ts";
import { sealTree } from "../../src/registry/store.ts";
import { accessEntries, tempDir, WINDOWS, WRITE_RIGHTS } from "../support.ts";

describe("fsyncPath", () => {
  it("syncs files and directories", () => {
    const dir = tempDir("sync");
    writeFileSync(join(dir, "a"), "x");
    expect(() => fsyncPath(join(dir, "a"))).not.toThrow();
    expect(() => fsyncPath(dir, true)).not.toThrow();
  });

  // Root opens anything, so the refusals below exist only for an ordinary user (as CI runs).
  it.skipIf(process.getuid?.() === 0)(
    "fails for a file it can't sync, and tolerates only a directory that refuses",
    () => {
      const dir = tempDir("sync");
      const file = join(dir, "unreadable");
      writeFileSync(file, "x");
      chmodSync(file, 0o000);
      try {
        // Opening fails with EACCES (EPERM on Windows, where 0o000 is the read-only attribute and
        // a sync needs a handle that may write): for a file that is a failure, never "unsupported".
        expect(() => fsyncPath(file)).toThrow(WINDOWS ? /EPERM/ : /EACCES/);
        expect(() => fsyncPath(join(dir, "missing"))).toThrow(/ENOENT/);
        expect(() => fsyncPath(join(dir, "missing"), true)).toThrow(/ENOENT/);
        const locked = join(dir, "locked");
        mkdirSync(locked);
        chmodSync(locked, 0o000);
        expect(() => fsyncPath(locked, true)).not.toThrow();
        chmodSync(locked, 0o755);
      } finally {
        chmodSync(file, 0o644);
      }
    },
  );
});

describe.skipIf(WINDOWS)("sealing", () => {
  it("makes every file 0444 and every directory 0555, and removeTree still removes it", async () => {
    const dir = join(tempDir("seal"), "version");
    mkdirSync(join(dir, "client/assets"), { recursive: true });
    writeFileSync(join(dir, "client/assets/app.js"), "x");
    chmodSync(join(dir, "client/assets/app.js"), 0o755);
    await sealTree(dir);
    expect(statSync(join(dir, "client/assets/app.js")).mode & 0o777).toBe(0o444);
    expect(statSync(join(dir, "client")).mode & 0o777).toBe(0o555);
    expect(statSync(dir).mode & 0o777).toBe(0o555);
    await removeTree(dir);
    expect(() => statSync(dir)).toThrow();
  });
});

describe.runIf(WINDOWS)("sealing on Windows (RT-10)", () => {
  it("leaves a placed version readable only, its owner included, and removeTree still removes it", async () => {
    const dir = join(tempDir("seal"), "version");
    mkdirSync(join(dir, "client/assets"), { recursive: true });
    writeFileSync(join(dir, "client/assets/app.js"), "x");
    await sealTree(dir, true);
    await sealPlaced(dir);
    // Every entry of every file's and directory's list grants reading only, to anyone. (A write
    // attempt can't show it on CI: the runner's administrator holds the backup and restore
    // privileges, and Node.js opens files with backup semantics, which pass any list.)
    for (const path of [dir, join(dir, "client"), join(dir, "client/assets/app.js")]) {
      const entries = accessEntries(path);
      expect(entries.length, path).toBeGreaterThan(0);
      for (const entry of entries)
        expect(entry.mask & WRITE_RIGHTS, `${path} ${entry.sid}`).toBe(0);
    }
    expect(readFileSync(join(dir, "client/assets/app.js"), "utf8")).toBe("x");
    await removeTree(dir);
    expect(() => statSync(dir)).toThrow();
  });
});
