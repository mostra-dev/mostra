/**
 * The registry is what the generator makes from the pinned shadcn items, byte for byte, and the
 * generator fails on a change of the kit's that no longer reaches the pinned items: a newer shadcn
 * can't make a part quietly ignore the theme (Opus review of WP-18, finding 11).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const KIT = fileURLToPath(new URL("../", import.meta.url));

function run(root: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [join(root, "scripts/generate.ts"), "--check"], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The copies made by this file's tests, removed after each (each copy is about 3 MB). */
const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the kit's generator and its inputs, its `studio.ts` changed by `edit`. */
function copyWith(edit: (studio: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), "mostra-kit-generate-"));
  copies.push(root);
  for (const dir of ["scripts", "src", "upstream", "parts", "css", "registry", "package.json"]) {
    cpSync(join(KIT, dir), join(root, dir), { recursive: true });
  }
  // The generator reads the on-demand libraries' own manifests (their peers) from the kit's packages.
  symlinkSync(join(KIT, "node_modules"), join(root, "node_modules"), "junction");
  const studio = join(root, "scripts/studio.ts");
  const before = readFileSync(studio, "utf8");
  const after = edit(before);
  expect(after).not.toBe(before);
  writeFileSync(studio, after);
  return root;
}

describe("the kit's registry generator", () => {
  it("finds the committed registry current with the pinned items and the kit's changes", () => {
    const result = run(KIT);
    expect(result.output).toMatch(/files current/);
    expect(result.status).toBe(0);
  }, 60_000);

  it("fails on a rule whose replacement no longer meets the class it installs a token over", () => {
    // As if shadcn's dialog had moved from `rounded-xl` to another radius the rule doesn't map.
    const root = copyWith((studio) =>
      studio.replace(
        '"rounded-xl": "rounded-(--dialog-radius)",',
        '"rounded-9xl": "rounded-(--dialog-radius)",',
      ),
    );
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(
      /the rule "dialog surface" applied .* without rounded-\(--dialog-radius\)/,
    );
  }, 60_000);

  it("fails on a file's change that changes nothing in either base", () => {
    const root = copyWith((studio) =>
      studio.replace(
        'code.replace(/^import \\* as React from "react"\\n/m, "")',
        'code.replace(/^import \\* as Nothing from "nowhere"\\n/m, "")',
      ),
    );
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("- components/ui/scroll-area.tsx");
  }, 60_000);
});
