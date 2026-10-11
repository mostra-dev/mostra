/**
 * Source trees and snapshots (INTERFACES §2.1, DATA_MODEL §1, §2): entries, ignore rules,
 * symbolic links, Unicode names, and the deterministic tar the home keeps.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { copySnapshot, listSource, resolveSource } from "../../src/publish/source.ts";
import { readTar, TAR_END, tarFile } from "../../src/publish/tar.ts";
import { tempDir } from "../support.ts";

function tree(files: Record<string, string>): string {
  const root = tempDir("source");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic.code;
    throw error;
  }
  return "none";
}

describe("entries (INTERFACES §2.1)", () => {
  it("finds a directory's index entry and accepts single .tsx, .jsx and .mdx files", async () => {
    const root = tree({ "index.mdx": "# x", "page.tsx": "", "notes.txt": "" });
    expect(await resolveSource(root)).toMatchObject({
      kind: "dir",
      entry: "index.mdx",
      bindingPath: root,
    });
    expect(await resolveSource(join(root, "page.tsx"))).toMatchObject({
      kind: "file",
      entry: "page.tsx",
      root,
    });
    expect(await code(resolveSource(join(root, "notes.txt")))).toBe("MOSTRA_ARTIFACT_NO_ENTRY");
    expect(await code(resolveSource(tree({ "a.tsx": "" })))).toBe("MOSTRA_ARTIFACT_NO_ENTRY");
    expect(await code(resolveSource(tree({ "index.tsx": "", "index.mdx": "" })))).toBe(
      "MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS",
    );
    expect(await code(resolveSource(join(root, "missing")))).toBe("MOSTRA_ARTIFACT_SOURCE_MISSING");
  });

  it("binds a symlinked source to its real path (D51)", async () => {
    const root = tree({ "index.tsx": "" });
    const link = join(tempDir("link"), "artifact");
    symlinkSync(root, link);
    expect((await resolveSource(link)).bindingPath).toBe(root);
  });
});

describe("ignore rules (DATA_MODEL §2)", () => {
  it("skips node_modules, .git and .mostra at any depth, editor and Finder files, and .mostraignore matches", async () => {
    const root = tree({
      "index.tsx": "",
      "components/a.tsx": "",
      "node_modules/react/index.js": "",
      "components/node_modules/x.js": "",
      ".git/HEAD": "",
      ".mostra/cache": "",
      "index.tsx.swp": "",
      "draft.md~": "",
      ".#index.tsx": "",
      "#index.tsx#": "",
      ".DS_Store": "",
      "notes/a.md": "",
      "notes/keep.md": "",
      "big.csv": "",
      ".mostraignore": "notes/\n!notes/keep.md\n*.csv\n",
    });
    const files = (await listSource(await resolveSource(root))).map((file) => file.path).sort();
    expect(files).toEqual([".mostraignore", "components/a.tsx", "index.tsx"]);
  });

  it("refuses a .mostraignore that excludes the entry", async () => {
    const root = tree({ "index.tsx": "", ".mostraignore": "*.tsx\n" });
    expect(await code(listSource(await resolveSource(root)))).toBe("MOSTRA_ARTIFACT_NO_ENTRY");
  });

  it("follows symbolic links to files and directories, and skips loops and dangling links", async () => {
    const outside = tree({ "shared.json": "{}" });
    const root = tree({ "index.tsx": "" });
    symlinkSync(join(outside, "shared.json"), join(root, "shared.json"));
    symlinkSync(outside, join(root, "vendor"));
    symlinkSync(root, join(root, "loop"));
    symlinkSync(join(root, "nowhere"), join(root, "dangling"));
    const files = (await listSource(await resolveSource(root))).map((file) => file.path).sort();
    expect(files).toEqual(["index.tsx", "shared.json", "vendor/shared.json"]);
  });

  it("normalizes names to NFC, and refuses two names that become one", async () => {
    const root = tree({ "index.tsx": "", "cafe\u0301.json": "{}" });
    const files = (await listSource(await resolveSource(root))).map((file) => file.path);
    expect(files).toContain("caf\u00e9.json");
    const clash = tree({ "index.tsx": "", "cafe\u0301.json": "{}", "caf\u00e9.json": "[]" });
    // APFS treats the two spellings as one name; ext4 keeps both. Either way nothing is lost silently.
    const names = readdirSync(clash).filter((name) => name.endsWith(".json"));
    const listed = await code(listSource(await resolveSource(clash)));
    expect(listed).toBe(names.length === 2 ? "MOSTRA_ARTIFACT_SOURCE_UNREADABLE" : "none");
  });
});

describe("snapshots", () => {
  it("copies files with their execute bit and lists the copies' digests", async () => {
    const root = tree({ "index.tsx": "x", "bin/run.sh": "#!/bin/sh\n" });
    chmodSync(join(root, "bin/run.sh"), 0o755);
    const target = tempDir("snapshot");
    const listed = await copySnapshot(await listSource(await resolveSource(root)), target);
    expect(listed.find((file) => file.path === "bin/run.sh")?.executable).toBe(true);
    expect(listed.find((file) => file.path === "index.tsx")).toMatchObject({
      executable: false,
      sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    });
  });

  it("archives deterministically and reads back long, non-ASCII and empty files exactly", () => {
    const files = [
      {
        path: "index.tsx",
        executable: false,
        data: new TextEncoder().encode("export default 1;\n"),
      },
      {
        path: `${"deep/".repeat(30)}file.ts`,
        executable: false,
        data: new Uint8Array(1500).fill(7),
      },
      { path: "données/été.json", executable: true, data: new TextEncoder().encode("{}") },
      { path: "empty", executable: false, data: new Uint8Array() },
    ];
    const archive = () => Buffer.concat([...files.flatMap(tarFile), TAR_END]);
    expect(archive().equals(archive())).toBe(true);
    expect(readTar(archive())).toEqual(files);
    // Any POSIX tar reads it: the system tar extracts the same files.
    const out = tempDir("tar");
    writeFileSync(join(out, "snapshot.tar"), archive());
    const extracted = spawnSync("tar", ["-xf", "snapshot.tar"], { cwd: out, encoding: "utf8" });
    expect(extracted.status).toBe(0);
    for (const entry of files) {
      const path = join(out, ...entry.path.split("/"));
      expect(new Uint8Array(readFileSync(path))).toEqual(entry.data);
      expect((statSync(path).mode & 0o111) !== 0).toBe(entry.executable);
    }
  });
});
