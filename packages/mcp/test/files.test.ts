import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { artifactPath, localWorkspace, planPatch, slug } from "@mostra/mcp";
import { describe, expect, it } from "vitest";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const files = (map: Record<string, string>) => async (path: string) =>
  map[path] === undefined ? undefined : encode(map[path] as string);

describe("artifact_patch's plan", () => {
  it("replaces text that appears exactly once, in order", async () => {
    const plan = await planPatch(
      {
        path: "index.tsx",
        edits: [
          { old: "Hello", new: "Hi" },
          { old: "Hi there", new: "Hi, you" },
        ],
      },
      files({ "index.tsx": "Hello there" }),
    );
    expect(plan).toEqual({
      ok: true,
      change: { write: [{ path: "index.tsx", content: "Hi, you" }], delete: [] },
    });
  });

  it("names each edit that doesn't apply, and why, and writes nothing", async () => {
    const plan = await planPatch(
      {
        path: "index.tsx",
        edits: [
          { old: "a", new: "b" },
          { old: "zzz", new: "y" },
        ],
      },
      files({ "index.tsx": "a a" }),
    );
    expect(plan).toEqual({
      ok: false,
      rejected: [
        { path: "index.tsx", edit: 0, reason: "ambiguous", occurrences: 2 },
        { path: "index.tsx", edit: 1, reason: "not-found" },
      ],
    });
    expect(
      await planPatch({ path: "gone.tsx", edits: [{ old: "a", new: "b" }] }, files({})),
    ).toEqual({
      ok: false,
      rejected: [{ path: "gone.tsx", reason: "missing" }],
    });
  });

  it("writes a new file from an edit with an empty old text", async () => {
    expect(await planPatch({ path: "new.tsx", edits: [{ old: "", new: "x" }] }, files({}))).toEqual(
      {
        ok: true,
        change: { write: [{ path: "new.tsx", content: "x" }], delete: [] },
      },
    );
  });

  it("applies a unified diff of several files, creating and deleting", async () => {
    const diff = [
      "--- a/index.tsx",
      "+++ b/index.tsx",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+deux",
      " three",
      "--- /dev/null",
      "+++ b/added.ts",
      "@@ -0,0 +1 @@",
      "+export const x = 1;",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      "",
    ].join("\n");
    const plan = await planPatch(
      { diff },
      files({ "index.tsx": "one\ntwo\nthree\n", "old.ts": "gone\n" }),
    );
    expect(plan).toEqual({
      ok: true,
      change: {
        write: [
          { path: "index.tsx", content: "one\ndeux\nthree\n" },
          { path: "added.ts", content: "export const x = 1;\n" },
        ],
        delete: ["old.ts"],
      },
    });
  });

  it("drops a/ and b/ only from git's headers, and never renames onto a file that is there (Opus review of WP-15, finding 6)", async () => {
    const hunk = ["@@ -1 +1 @@", "-old", "+new", ""];
    const tree = files({ "a/index.tsx": "old\n", "index.tsx": "old\n" });
    // A plain diff -u of a file in a folder named a: that file, not the root's.
    const plain = await planPatch(
      { diff: ["--- a/index.tsx", "+++ a/index.tsx", ...hunk].join("\n") },
      tree,
    );
    expect(plain).toEqual({
      ok: true,
      change: { write: [{ path: "a/index.tsx", content: "new\n" }], delete: [] },
    });
    // Git's form names the root's file.
    const git = await planPatch(
      { diff: ["--- a/index.tsx", "+++ b/index.tsx", ...hunk].join("\n") },
      tree,
    );
    expect(git).toEqual({
      ok: true,
      change: { write: [{ path: "index.tsx", content: "new\n" }], delete: [] },
    });
    // A rename onto a file that exists is refused; onto a new name it moves the file.
    const rename = (to: string) =>
      [
        `diff --git a/index.tsx b/${to}`,
        "similarity index 100%",
        "rename from index.tsx",
        `rename to ${to}`,
        "",
      ].join("\n");
    const onto = await planPatch(
      { diff: rename("page.tsx") },
      files({ "index.tsx": "x\n", "page.tsx": "keep\n" }),
    );
    expect(onto).toEqual({ ok: false, rejected: [{ path: "page.tsx", reason: "exists" }] });
    const moved = await planPatch({ diff: rename("main.tsx") }, files({ "index.tsx": "x\n" }));
    expect(moved).toEqual({
      ok: true,
      change: { write: [{ path: "main.tsx", content: "x\n" }], delete: ["index.tsx"] },
    });
  });

  it("names the hunk whose context doesn't match", async () => {
    const diff = [
      "--- a/index.tsx",
      "+++ b/index.tsx",
      "@@ -1,2 +1,2 @@",
      " alpha",
      "-beta",
      "+gamma",
      "",
    ].join("\n");
    expect(await planPatch({ diff }, files({ "index.tsx": "alpha\nBETA\n" }))).toEqual({
      ok: false,
      rejected: [{ path: "index.tsx", hunk: 0, header: "@@ -1,2 +1,2 @@", reason: "context" }],
    });
    expect(await planPatch({ diff: "not a diff" }, files({}))).toMatchObject({
      ok: false,
      rejected: [{ reason: "malformed" }],
    });
  });
});

describe("the local workspace", () => {
  it("refuses paths that leave the artifact", () => {
    for (const bad of [
      "",
      "/etc/passwd",
      "../x",
      "a/../../x",
      "a//b",
      "./a",
      "C:\\x",
      "a\u0000b",
    ]) {
      expect(() => artifactPath(bad), bad).toThrow(/isn't a path inside the artifact/);
    }
    expect(artifactPath("components\\chart.tsx")).toBe("components/chart.tsx");
  });

  it("keeps a relative directory inside the workspace, and takes any absolute one", () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-ws-"));
    const workspace = localWorkspace(root);
    expect(workspace.resolveDir("my-page")).toBe(join(root, "my-page"));
    expect(workspace.resolveDir("a/../b")).toBe(join(root, "b"));
    expect(workspace.resolveDir("..foo")).toBe(join(root, "..foo"));
    for (const bad of ["..", "../outside", "a/../../outside", ".", "a/.."]) {
      expect(() => workspace.resolveDir(bad), bad).toThrow(/isn't a folder inside the workspace/);
    }
    const elsewhere = resolve(tmpdir(), "elsewhere");
    expect(workspace.resolveDir(elsewhere)).toBe(elsewhere);
  });

  it("refuses names not every system can hold (Opus review of WP-15, finding 5)", () => {
    for (const bad of [
      "index.tsx:x",
      "index.tsx.",
      "index.tsx ",
      "pages /a.tsx",
      "CON",
      "nul.tsx",
      "Lpt1.txt",
      "com9",
      "a?b.tsx",
      'a"b',
      "a|b",
      "a<b>",
      "a*b",
    ]) {
      expect(() => artifactPath(bad), bad).toThrow(/not every system can hold/);
    }
    for (const good of [
      "pages/[id].tsx",
      "pages/docs/[...rest].tsx",
      "con-tents.tsx",
      "console.tsx",
      "a b.tsx",
      ".well-known/x.json",
    ]) {
      expect(artifactPath(good), good).toBe(good);
    }
  });

  it("makes no folder for a change it refuses, and removes those a failed change made (Opus review of WP-15, finding 3)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-ws-"));
    const outside = mkdtempSync(join(tmpdir(), "mostra-outside-"));
    const workspace = localWorkspace(root);
    const dir = workspace.resolveDir("page");
    await workspace.apply(dir, {
      write: [{ path: "index.tsx", content: encode("i") }],
      delete: [],
    });
    symlinkSync(outside, join(dir, "link"), "junction");
    await expect(
      workspace.apply(dir, {
        write: [
          { path: "a/b/c.tsx", content: encode("c") },
          { path: "link/x.tsx", content: encode("x") },
        ],
        delete: [],
      }),
    ).rejects.toThrow(/leads out of the artifact's directory/);
    expect(existsSync(join(dir, "a"))).toBe(false);
    // One change can't make a name both a file and a folder; nothing is made for it.
    const fresh = join(root, "typo", "new");
    await expect(
      workspace.apply(fresh, {
        write: [
          { path: "a/b.tsx", content: encode("b") },
          { path: "A/b.tsx/c.tsx", content: encode("c") },
        ],
        delete: [],
      }),
    ).rejects.toThrow(/both a file and a folder/);
    expect(existsSync(join(root, "typo"))).toBe(false);
  });

  it("counts names that differ only in case as one file in a change (Opus review of WP-15, finding 4)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-ws-"));
    const workspace = localWorkspace(root);
    const dir = workspace.resolveDir("page");
    await workspace.apply(dir, {
      write: [{ path: "index.tsx", content: encode("i") }],
      delete: [],
    });
    await expect(
      workspace.apply(dir, {
        write: [{ path: "index.tsx", content: encode("new") }],
        delete: ["INDEX.tsx"],
      }),
    ).rejects.toThrow(/appears twice in one change/);
    expect(readFileSync(join(dir, "index.tsx"), "utf8")).toBe("i");
  });

  it("writes and deletes files, creating folders, and never through a link out of the artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-ws-"));
    const outside = mkdtempSync(join(tmpdir(), "mostra-outside-"));
    const workspace = localWorkspace(root);
    const dir = workspace.resolveDir("page");
    const done = await workspace.apply(dir, {
      write: [
        { path: "components/a.tsx", content: encode("a") },
        { path: "index.tsx", content: encode("i") },
      ],
      delete: ["missing.txt"],
    });
    expect(done).toEqual({ written: ["components/a.tsx", "index.tsx"], deleted: [] });
    expect(readFileSync(join(dir, "components", "a.tsx"), "utf8")).toBe("a");
    // A junction on Windows, which needs no privilege; a symbolic link elsewhere.
    symlinkSync(outside, join(dir, "escape"), "junction");
    await expect(
      workspace.apply(dir, {
        write: [{ path: "escape/new/x.txt", content: encode("x") }],
        delete: [],
      }),
    ).rejects.toThrow(/leads out of the artifact's directory/);
    expect(existsSync(join(outside, "new"))).toBe(false);
    if (process.platform !== "win32") {
      // A file link needs a privilege on Windows that ordinary users don't hold.
      writeFileSync(join(outside, "target.txt"), "keep");
      symlinkSync(join(outside, "target.txt"), join(dir, "linked.txt"));
      await expect(
        workspace.apply(dir, { write: [{ path: "linked.txt", content: encode("x") }], delete: [] }),
      ).rejects.toThrow(/is a link/);
      expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("keep");
    }
    await expect(
      workspace.apply(dir, {
        write: [
          { path: "ok.txt", content: encode("x") },
          { path: "../x", content: encode("y") },
        ],
        delete: [],
      }),
    ).rejects.toThrow();
    expect(existsSync(join(dir, "ok.txt"))).toBe(false);
    expect(await workspace.apply(dir, { write: [], delete: ["index.tsx"] })).toEqual({
      written: [],
      deleted: ["index.tsx"],
    });
  });

  it("allocates a new folder named after the title", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-ws-"));
    const workspace = localWorkspace(root);
    expect(slug("Café: the Q3 plan!")).toBe("cafe-the-q3-plan");
    expect(slug(undefined)).toBe("artifact");
    expect(slug("--- !!! ---")).toBe("artifact");
    expect(slug(`${"a".repeat(47)}-b`)).toBe("a".repeat(47));
    expect(slug(`x${"-".repeat(1000)}x!`)).toBe("x-x");
    mkdirSync(join(root, "plan"));
    expect(await workspace.allocateDir("Plan")).toBe(join(root, "plan-2"));
    expect(workspace.resolveDir(resolve("/abs/dir"))).toBe(resolve("/abs/dir"));
  });
});
