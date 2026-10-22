/**
 * The platform layer owns every difference between operating systems (WP-W1, RT-10): no other
 * module reads `process.platform`, so a Windows path can't hide in a module that tests only run
 * on POSIX. The layer itself is the one place that may.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkFarm, linkTarget, unlinkDirectory } from "../../src/platform/files.ts";
import { isUnder, pathKey } from "../../src/platform/index.ts";
import { tempDir, WINDOWS } from "../support.ts";

const SRC = join(import.meta.dirname, "../../src");

describe("the platform layer (RT-10)", () => {
  it("is the only module that reads process.platform", () => {
    const readers = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".ts") && !file.startsWith("platform/"))
      .filter((file) => /process\.platform\b/.test(readFileSync(join(SRC, file), "utf8")));
    expect(readers).toEqual([]);
  });

  it("compares paths however the bundler or the file system spells them (WP-W1)", () => {
    expect(isUnder("/a/b/c.ts", "/a/b")).toBe(true);
    expect(isUnder("/a/b", "/a/b/")).toBe(true);
    expect(isUnder("/a/bc/d.ts", "/a/b")).toBe(false);
    expect(isUnder("C:/work/src/x.tsx", "C:\\work\\src")).toBe(true);
    expect(isUnder("C:\\work\\srcx\\x.tsx", "C:/work/src")).toBe(false);
    expect(pathKey("C:\\A\\b").length).toBe("C:\\A\\b".length);
    // Windows names compare without case; POSIX names don't.
    expect(isUnder("c:/WORK/src/x.tsx", "C:\\work\\src")).toBe(WINDOWS);
  });

  it("mirrors a node_modules as a farm of links to real paths, which knows when it went stale", async () => {
    // pnpm's layout: a store beside `node_modules`, whose entries are relative links into it. On
    // Windows a link to the whole `node_modules` breaks those (VERIFIED_FACTS, WP-W1).
    const root = tempDir("farm");
    const store = join(root, "store", "react", "1");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "index.js"), "module.exports = 1;\n");
    const scoped = join(root, "store", "scope-x");
    mkdirSync(scoped, { recursive: true });
    const modules = join(root, "pkg", "node_modules");
    mkdirSync(join(modules, "@scope"), { recursive: true });
    mkdirSync(join(modules, ".bin"));
    symlinkSync(join("..", "..", "store", "react", "1"), join(modules, "react"), "junction");
    symlinkSync(scoped, join(modules, "@scope", "x"), "junction");
    const farm = join(root, "build", "node_modules");
    mkdirSync(join(farm, ".."));
    await linkFarm(modules, farm);

    expect(readFileSync(join(farm, "react", "index.js"), "utf8")).toContain("1");
    expect(realpathSync(join(farm, "react"))).toBe(realpathSync(store));
    expect(realpathSync(join(farm, "@scope", "x"))).toBe(realpathSync(scoped));
    expect(existsSync(join(farm, ".bin"))).toBe(false);
    expect(await linkTarget(farm)).toBe(modules);

    // A package added to the mirrored directory makes the farm stale: it no longer stands for it.
    const extra = join(root, "store", "extra");
    mkdirSync(extra);
    symlinkSync(extra, join(modules, "extra"), "junction");
    expect(await linkTarget(farm)).toBeUndefined();

    // Removing the farm removes its links, never what they point to.
    await unlinkDirectory(farm);
    expect(existsSync(farm)).toBe(false);
    expect(readFileSync(join(store, "index.js"), "utf8")).toContain("1");
    expect(readdirSync(join(modules, "@scope"))).toEqual(["x"]);
  });
});
