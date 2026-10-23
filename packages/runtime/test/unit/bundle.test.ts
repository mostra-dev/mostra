/**
 * The verify runner inside a runtime bundle (RT-01, D142): a runtime that sits in a bundle gives
 * its runner exactly the bundle's own browsers directory, whatever `PLAYWRIGHT_BROWSERS_PATH` the
 * environment names, so verify renders with the browser the bundle's setup checked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE_NAME } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { enclosingBundle, locateRunner, runnerEnvironment } from "../../src/verify/runner.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bundle-shaped tree: `<root>/lib/node_modules/@mostra/runtime`, with `bundle.json` at its root. */
function bundleTree(name: string): { root: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), "mrb-"));
  dirs.push(root);
  const runtime = join(root, "lib", "node_modules", "@mostra", "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(root, "bundle.json"), JSON.stringify({ name }));
  return { root, runtime };
}

describe("the verify runner in a runtime bundle", () => {
  it("uses the bundle's browsers, over whatever the environment names", () => {
    const { root, runtime } = bundleTree(BUNDLE_NAME);
    expect(enclosingBundle(runtime)).toBe(root);
    const located = locateRunner({}, runtime);
    expect(located.browsers).toBe(join(root, "browsers"));
    const env = runnerEnvironment(
      { PLAYWRIGHT_BROWSERS_PATH: "/elsewhere", PATH: "/bin" },
      located.browsers,
    );
    expect(env["PLAYWRIGHT_BROWSERS_PATH"]).toBe(join(root, "browsers"));
  });

  it("keeps the environment's browsers outside a bundle, and ignores a bundle.json that isn't a bundle's", () => {
    const { runtime } = bundleTree("something-else");
    expect(enclosingBundle(runtime)).toBeUndefined();
    const located = locateRunner({}, runtime);
    expect(located.browsers).toBeUndefined();
    expect(
      runnerEnvironment({ PLAYWRIGHT_BROWSERS_PATH: "/elsewhere" })["PLAYWRIGHT_BROWSERS_PATH"],
    ).toBe("/elsewhere");
  });
});
