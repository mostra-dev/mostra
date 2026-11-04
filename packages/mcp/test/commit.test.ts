import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localWorkspace } from "@mostra/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

// A rename that fails once its destination is the one named, as a full disk or a file another
// program holds would make it fail part-way through a change.
const failing: { to: string | undefined } = { to: undefined };
// Something another program does just before a file is written aside (finding 7's race).
const before: { write: ((path: string) => void) | undefined } = { write: undefined };
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: async (path: string, ...rest: unknown[]) => {
      before.write?.(path);
      return (fs.writeFile as (...args: unknown[]) => Promise<void>)(path, ...rest);
    },
    rename: async (from: string, to: string) => {
      if (failing.to !== undefined && to.endsWith(failing.to) && from.endsWith(".tmp")) {
        throw Object.assign(new Error(`ENOSPC: no space left on device, rename '${to}'`), {
          code: "ENOSPC",
        });
      }
      return fs.rename(from, to);
    },
  };
});
afterEach(() => {
  failing.to = undefined;
  before.write = undefined;
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** An artifact directory holding `files`, and what it holds afterwards, every file by name. */
function artifact(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "mostra-commit-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const contents = () =>
    Object.fromEntries(
      readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")]),
    );
  return { dir, contents };
}

describe("a change of several files is all or nothing (D164)", () => {
  it("puts back every file it replaced when a later one fails, and leaves no scratch file", async () => {
    const { dir, contents } = artifact({ "a.tsx": "A1", "b.tsx": "B1" });
    failing.to = "c.tsx";
    const workspace = localWorkspace(dir);
    await expect(
      workspace.apply(dir, {
        write: [
          { path: "a.tsx", content: encode("A2") },
          { path: "b.tsx", content: encode("B2") },
          { path: "c.tsx", content: encode("C2") },
        ],
        delete: [],
      }),
    ).rejects.toThrow(/ENOSPC/);
    expect(contents()).toEqual({ "a.tsx": "A1", "b.tsx": "B1" });
  });

  it("keeps a file it was to delete when a write in the same change fails", async () => {
    const { dir, contents } = artifact({ "a.tsx": "A1", "old.tsx": "OLD" });
    failing.to = "b.tsx";
    const workspace = localWorkspace(dir);
    await expect(
      workspace.apply(dir, {
        write: [
          { path: "a.tsx", content: encode("A2") },
          { path: "b.tsx", content: encode("B2") },
        ],
        delete: ["old.tsx"],
      }),
    ).rejects.toThrow(/ENOSPC/);
    expect(contents()).toEqual({ "a.tsx": "A1", "old.tsx": "OLD" });
  });

  it("applies the whole change when nothing fails, and leaves no scratch file", async () => {
    const { dir, contents } = artifact({ "a.tsx": "A1", "old.tsx": "OLD" });
    const changed = await localWorkspace(dir).apply(dir, {
      write: [
        { path: "a.tsx", content: encode("A2") },
        { path: "b.tsx", content: encode("B2") },
      ],
      delete: ["old.tsx", "never-there.tsx"],
    });
    expect(changed).toEqual({ written: ["a.tsx", "b.tsx"], deleted: ["old.tsx"] });
    expect(contents()).toEqual({ "a.tsx": "A2", "b.tsx": "B2" });
    expect(existsSync(join(dir, "old.tsx"))).toBe(false);
  });

  it("removes the artifact's directory it made when the change fails (Opus review of WP-15, finding 3)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-commit-"));
    const dir = join(root, "typo", "new");
    failing.to = "b.tsx";
    await expect(
      localWorkspace(root).apply(dir, {
        write: [
          { path: "a/a.tsx", content: encode("A") },
          { path: "b.tsx", content: encode("B") },
        ],
        delete: [],
      }),
    ).rejects.toThrow(/ENOSPC/);
    expect(existsSync(join(root, "typo"))).toBe(false);
  });

  it("writes nothing outside the artifact when a folder becomes a link during the change (Opus review of WP-15, finding 7)", async () => {
    const { dir } = artifact({ "a.tsx": "A1" });
    const outside = mkdtempSync(join(tmpdir(), "mostra-outside-"));
    const workspace = localWorkspace(dir);
    await workspace.apply(dir, {
      write: [{ path: "components/x.tsx", content: encode("X1") }],
      delete: [],
    });
    // After the paths were checked, another program swaps components/ for a link out.
    before.write = (path) => {
      if (!path.includes("a.tsx.mostra-")) return;
      before.write = undefined;
      renameSync(join(dir, "components"), join(dir, "components-moved"));
      symlinkSync(outside, join(dir, "components"), "junction");
    };
    await expect(
      workspace.apply(dir, {
        write: [
          { path: "a.tsx", content: encode("A2") },
          { path: "components/x.tsx", content: encode("X2") },
        ],
        delete: [],
      }),
    ).rejects.toThrow(/moved out of its directory/);
    expect(readdirSync(outside)).toEqual([]);
    expect(readFileSync(join(dir, "a.tsx"), "utf8")).toBe("A1");
  });
});
