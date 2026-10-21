import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostNeutralProblems } from "../audit/host-neutral.ts";

/** A tree shaped like the repository: one package, one crate, the lockfiles. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "host-neutral-"));
  const all: Record<string, string> = {
    "packages/runtime/src/index.ts": "export const x = 1;\n",
    "packages/runtime/package.json": '{ "name": "@mostra/runtime" }\n',
    "crates/mostra-host/src/lib.rs": "//! A host crate.\n",
    "crates/mostra-host/Cargo.toml": '[package]\nname = "mostra-host"\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "Cargo.lock": "version = 4\n",
    "docs/reference/cli.md": "# CLI\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the host-neutral core (HO-06)", () => {
  it("the repository's core names no host", () => {
    expect(hostNeutralProblems()).toEqual([]);
  });

  it("a clean tree passes", () => {
    expect(hostNeutralProblems(tree({}))).toEqual([]);
  });

  it.each([
    [
      "a host's name in core code",
      "packages/runtime/src/hosts.ts",
      "if (client.name === 'jcode') {}\n",
    ],
    [
      "a host's contract in a crate",
      "crates/mostra-host/src/jobs.rs",
      "// maps to session_work_v1\n",
    ],
    ["a host's package in a lockfile", "pnpm-lock.yaml", "  jcode-adapter@1.0.0:\n"],
    ["a host's path in CLI help", "docs/reference/cli.md", "mostra host --home ~/.jcode/mostra\n"],
    [
      "a host in a package manifest",
      "packages/runtime/package.json",
      '{ "keywords": ["Jcode"] }\n',
    ],
  ])("is refused: %s", (_what, path, text) => {
    const problems = hostNeutralProblems(tree({ [path]: text }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${path.replace(/[.]/g, "\\.")}:1: `));
  });
});
