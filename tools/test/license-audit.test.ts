/**
 * License audit (DP-06, KT-02): the real CLI against seeded workspaces, and against this repository.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.ts";
import { spdxAllowed } from "../license-audit/cli.ts";

const CLI = join(ROOT, "tools/license-audit/cli.ts");
const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Dep {
  readonly name: string;
  readonly license?: string;
  /** The deprecated `licenses: [{ type }]` form some old packages use. */
  readonly legacyLicenses?: readonly string[];
  readonly files?: Record<string, string>;
  /** Peer dependencies installed next to this one. */
  readonly peers?: readonly Dep[];
}

/** A workspace with one published package depending on `deps` (installed as node_modules links). */
function workspace(deps: readonly Dep[]): string {
  const root = mkdtempSync(join(tmpdir(), "mostra-license-"));
  created.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const core = join(root, "packages/core");
  mkdirSync(join(core, "node_modules"), { recursive: true });
  writeFileSync(
    join(core, "package.json"),
    JSON.stringify({
      name: "@mostra/core-fixture",
      version: "0.0.0",
      license: "Apache-2.0",
      dependencies: Object.fromEntries(deps.map((dep) => [dep.name, "1.0.0"])),
    }),
  );
  const install = (dep: Dep, into: string): void => {
    const dir = join(root, "vendor", dep.name);
    mkdirSync(dir, { recursive: true });
    const peers = Object.fromEntries((dep.peers ?? []).map((peer) => [peer.name, "*"]));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: dep.name,
        version: "1.0.0",
        ...(dep.license ? { license: dep.license } : {}),
        ...(dep.legacyLicenses
          ? { licenses: dep.legacyLicenses.map((type) => ({ type, url: "https://example.com" })) }
          : {}),
        ...(dep.peers ? { peerDependencies: peers } : {}),
      }),
    );
    for (const [file, text] of Object.entries(dep.files ?? {})) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    mkdirSync(join(into, "node_modules", dep.name, ".."), { recursive: true });
    symlinkSync(dir, join(into, "node_modules", dep.name));
    for (const peer of dep.peers ?? []) install(peer, dir);
  };
  for (const dep of deps) install(dep, core);
  return root;
}

const audit = (root: string) => {
  const result = spawnSync("node", [CLI, "--root", root], { encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("license audit", () => {
  it("passes on this repository", () => {
    const result = audit(ROOT);
    expect(result.output).toContain("✓ license audit");
    expect(result.code).toBe(0);
  });

  it("reads the deprecated licenses array, as format@0.2.2 uses it (WP-03 finding)", () => {
    expect(audit(workspace([{ name: "old-format", legacyLicenses: ["MIT"] }])).code).toBe(0);
    expect(
      audit(workspace([{ name: "old-dual", legacyLicenses: ["MIT", "Apache-2.0"] }])).code,
    ).toBe(0);
    const proprietary = audit(workspace([{ name: "old-closed", legacyLicenses: ["Proprietary"] }]));
    expect(proprietary.code).not.toBe(0);
    expect(proprietary.output).toContain("old-closed");
    expect(audit(workspace([{ name: "old-none" }])).output).toContain("declares no SPDX license");
  });

  it("passes on an OSI-licensed dependency tree", () => {
    expect(audit(workspace([{ name: "fine", license: "MIT OR Apache-2.0" }])).code).toBe(0);
  });

  it("fails on a PolyForm-licensed engine in the core", () => {
    const result = audit(
      workspace([
        {
          name: "shiny-engine",
          license: "SEE LICENSE IN LICENSE.md",
          files: { "LICENSE.md": "# PolyForm Shield License 1.0.0\n" },
        },
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'shiny-engine@1.0.0 (@mostra/core-fixture > shiny-engine) is licensed "SEE LICENSE IN LICENSE.md"',
    );
    expect(result.output).toContain("ships PolyForm terms in LICENSE.md");
  });

  it("fails on PolyForm terms hidden under a permissive license field, as in pnpm's pnpr/", () => {
    const result = audit(
      workspace([
        {
          name: "pm",
          license: "MIT",
          files: { "pnpr/LICENSE.md": "PolyForm Shield License 1.0.0" },
        },
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain("ships PolyForm terms in pnpr/LICENSE.md");
  });

  it("fails on any @pnpm/pnpr package and on non-OSI or missing licenses", () => {
    const result = audit(
      workspace([
        { name: "@pnpm/pnpr.client", license: "MIT" },
        { name: "busl", license: "BUSL-1.1" },
        { name: "unlicensed" },
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain("@pnpm/pnpr.client@1.0.0");
    expect(result.output).toContain("pnpr subsystem");
    expect(result.output).toContain('"BUSL-1.1", which is not on the OSI allowlist');
    expect(result.output).toContain(
      "unlicensed@1.0.0 (@mostra/core-fixture > unlicensed) declares no SPDX license",
    );
  });

  it("follows installed peer dependencies (review finding 8)", () => {
    const result = audit(
      workspace([
        { name: "bridge", license: "MIT", peers: [{ name: "engine", license: "BUSL-1.1" }] },
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'engine@1.0.0 (@mostra/core-fixture > bridge > engine) is licensed "BUSL-1.1"',
    );
  });

  it("evaluates SPDX expressions", () => {
    expect(spdxAllowed("MIT")).toBe(true);
    expect(spdxAllowed("(MIT OR GPL-3.0-only)")).toBe(true);
    expect(spdxAllowed("MIT AND BUSL-1.1")).toBe(false);
    expect(spdxAllowed("GPL-3.0-only")).toBe(false);
    expect(spdxAllowed("SEE LICENSE IN LICENSE")).toBe(false);
    expect(spdxAllowed("Apache-2.0 WITH LLVM-exception")).toBe(true);
  });
});
