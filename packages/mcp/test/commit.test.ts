import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localWorkspace } from "@mostra/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

// A rename that fails once its destination is the one named, as a full disk or a file another
// program holds would make it fail part-way through a change.
const failing: { to: string | undefined } = { to: undefined };
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
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
});
