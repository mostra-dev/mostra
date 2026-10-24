/**
 * Which Windows helper a client uses to open a home's pipe (D150 item 4, D151 item 2): the one
 * beside the runtime it resolved, in the runtime's own order (`helperPath` in `@mostra/runtime`'s
 * platform layer), so the CLI, the SDK and the runtime never reach a pipe through different
 * helpers (Opus review of WP-W2, finding 10). The package map keeps the two apart (neither may
 * import the other), so this test pins the SDK's order to the runtime's.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { windowsHelper } from "../../src/control.ts";
import type { Runtime } from "../../src/runtime.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function touch(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  return path;
}

describe("the Windows helper a client opens a pipe with", () => {
  it("is MOSTRA_WIN_HELPER, else the bundle's bin\\mostra-win.exe, else a checkout's Cargo build, release before debug", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "mostra-helper-")));
    made.push(root);
    const entry = touch(join(root, "packages", "runtime", "dist", "bin.js"));
    const checkout: Runtime = {
      source: "development",
      node: process.execPath,
      runtimeEntry: entry,
    };
    const debug = touch(join(root, "target", "debug", "mostra-win.exe"));
    expect(windowsHelper(checkout, {})).toBe(debug);
    const release = touch(join(root, "target", "release", "mostra-win.exe"));
    expect(windowsHelper(checkout, {})).toBe(release);
    const override = touch(join(root, "elsewhere", "mostra-win.exe"));
    expect(windowsHelper(checkout, { MOSTRA_WIN_HELPER: override })).toBe(override);
    expect(() => windowsHelper(checkout, { MOSTRA_WIN_HELPER: join(root, "missing.exe") })).toThrow(
      /MOSTRA_WIN_HELPER names/,
    );
    const bundleRoot = join(root, "bundle");
    const bundled = touch(join(bundleRoot, "bin", "mostra-win.exe"));
    const inBundle = {
      ...checkout,
      source: "bundle",
      bundle: { root: bundleRoot },
    } as unknown as Runtime;
    expect(windowsHelper(inBundle, {})).toBe(bundled);
    expect(() => windowsHelper(undefined, {})).toThrow(/No runtime was resolved/);
    // Reached through a link (a relative MOSTRA_RUNTIME_BIN through a project's link), the
    // runtime is still the checkout's, as the runtime itself finds its helper.
    const project = join(root, "project");
    mkdirSync(project, { recursive: true });
    symlinkSync(join(root, "packages", "runtime", "dist"), join(project, "runtime"), "junction");
    const linked: Runtime = { ...checkout, runtimeEntry: join(project, "runtime", "bin.js") };
    expect(windowsHelper(linked, {})).toBe(release);
  });
});
