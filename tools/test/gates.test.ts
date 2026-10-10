/**
 * Every gate, proven by a seeded violation (WP-01 acceptance evidence; EN-01, EN-04, EN-06,
 * EN-07, DP-06, KT-02, HO-07, AX-03). Each test plants one violation in a repository copy, runs
 * the real gate command there and expects a failure that names the problem, then removes the
 * violation and expects the gate to pass.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyRepository, type RepoCopy } from "./repo-copy.ts";

let repo: RepoCopy;
const node = (script: string, ...args: string[]) => repo.run("node", [script, ...args]);
const depcruise = () =>
  repo.run("tools/ts6/node_modules/.bin/depcruise", [
    "--config",
    "tools/ts6/dependency-cruiser.config.mjs",
    "packages",
  ]);

beforeAll(() => {
  repo = copyRepository();
});
afterAll(() => repo?.dispose());
beforeEach(() => repo.reset());

describe("boundaries", () => {
  it("dependency-cruiser rejects imports across the package map", () => {
    expect(depcruise().code).toBe(0);

    repo.write(
      "packages/protocol/src/seed-builtin.ts",
      'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
    );
    repo.write(
      "packages/protocol/src/seed-external.ts",
      'import ts from "typescript";\nexport const y = ts;\n',
    );
    mkdirSync(join(repo.root, "packages/runtime/src/ledger"), { recursive: true });
    mkdirSync(join(repo.root, "packages/runtime/src/gateway"), { recursive: true });
    mkdirSync(join(repo.root, "packages/worker/src"), { recursive: true });
    repo.write("packages/runtime/src/ledger/index.ts", 'export * from "./internal.ts";\n');
    repo.write("packages/runtime/src/ledger/internal.ts", "export const ledger = 1;\n");
    repo.write(
      "packages/runtime/src/gateway/index.ts",
      'export { ledger } from "../ledger/internal.ts";\n',
    );
    repo.write(
      "packages/worker/src/index.ts",
      'export { ledger } from "../../runtime/src/ledger/index.ts";\n',
    );
    const result = depcruise();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no-node-builtins:@mostra/protocol");
    expect(result.output).toContain("external-allowlist:@mostra/protocol");
    expect(result.output).toContain("boundary:@mostra/worker");
    expect(result.output).toContain("runtime-module-internals");

    repo.reset();
    expect(depcruise().code).toBe(0);
  });

  it("knip rejects an unused export", () => {
    expect(repo.run("node_modules/.bin/knip", ["--no-progress", "--no-config-hints"]).code).toBe(0);
    repo.edit(
      "packages/protocol/src/ids.ts",
      (text) => `${text}\n/** Seeded. */\nexport const seededUnused: number = 1;\n`,
    );
    const result = repo.run("node_modules/.bin/knip", ["--no-progress", "--no-config-hints"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/Unused exports[\s\S]*seededUnused/);
  });
});

describe("size budget", () => {
  it("size-limit fails when the entry exceeds its budget", () => {
    const size = () => repo.run("node_modules/.bin/size-limit", [], { cwd: "packages/protocol" });
    expect(repo.run("node_modules/.bin/tsdown", [], { cwd: "packages/protocol" }).code).toBe(0);
    expect(size().code).toBe(0);
    repo.edit("packages/protocol/package.json", (text) =>
      text.replace('"limit": "4 kB"', '"limit": "1 kB"'),
    );
    const result = size();
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/Package size limit has exceeded|exceeded/i);
  });
});

describe("API reports", () => {
  const api = (env: Record<string, string> = {}) =>
    repo.run("node", [join(repo.root, "tools/bin/mostra-tools.ts"), "api"], {
      cwd: "packages/protocol",
      env,
    });
  const build = () => repo.run("node_modules/.bin/tsdown", [], { cwd: "packages/protocol" });

  it("a changed API report needs a changeset, and CI rejects a stale report", () => {
    expect(build().code).toBe(0);
    expect(api().code).toBe(0);

    repo.edit(
      "packages/protocol/src/index.ts",
      (text) => `${text}\n/** Seeded public export. */\nexport const seededExport: number = 1;\n`,
    );
    expect(build().code).toBe(0);
    const stale = api({ CI: "true" });
    expect(stale.code).not.toBe(0);
    expect(stale.output).toContain("API report out of date");

    const local = api();
    expect(local.code).not.toBe(0);
    expect(local.output).toContain("API report updated");
    const unchangeset = api();
    expect(unchangeset.code).not.toBe(0);
    expect(unchangeset.output).toContain("without a changeset for @mostra/protocol");

    repo.write(".changeset/seeded.md", '---\n"@mostra/protocol": minor\n---\n\nSeeded export.\n');
    expect(api().code).toBe(0);
  });

  it("publint and are-the-types-wrong reject a package whose types don't resolve", () => {
    expect(build().code).toBe(0);
    expect(api().code).toBe(0);
    repo.edit("packages/protocol/package.json", (text) =>
      text.replace('"types": "./dist/index.d.ts"', '"types": "./dist/missing.d.ts"'),
    );
    const result = api();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("publint:");
    expect(result.output).toContain("are-the-types-wrong:");
    expect(result.output).toContain("missing.d.ts");
  });
});

describe("wire schemas (HO-07)", () => {
  const schemas = (sub: "check" | "write") =>
    repo.run("node", [join(repo.root, "tools/bin/mostra-tools.ts"), "schemas", sub], {
      cwd: "packages/protocol",
    });

  it.each([
    [
      "field removed",
      (t: string) => t.replace("    count: positiveInt.exactOptional(),\n", ""),
      "Diagnostic.count: field removed",
    ],
    [
      "enum value removed",
      (t: string) =>
        t.replace('.enum(["error", "warning", "hint"])', '.enum(["error", "warning"])'),
      'enum value "hint" removed',
    ],
    [
      "required added",
      (t: string) => t.replace("    hint: z.string().exactOptional(),", "    hint: z.string(),"),
      "Diagnostic.hint: field became required",
    ],
    [
      "type narrowed",
      (t: string) => t.replace("    message: z.string(),", '    message: z.literal("x"),'),
      "Diagnostic.message: const added or changed",
    ],
  ])("fails on a non-additive change: %s", (_name, change, expected) => {
    expect(schemas("check").code).toBe(0);
    repo.edit("packages/protocol/src/diagnostics/diagnostic.ts", change);
    const write = schemas("write");
    expect(write.code).not.toBe(0);
    expect(write.output).toContain(expected);
    const check = schemas("check");
    expect(check.code).not.toBe(0);
    expect(check.output).toContain(expected);
  });

  it("accepts an additive change once the snapshot is regenerated", () => {
    repo.edit("packages/protocol/src/diagnostics/diagnostic.ts", (t) =>
      t.replace(
        "    count: positiveInt.exactOptional(),\n",
        "    count: positiveInt.exactOptional(),\n    extra: z.string().exactOptional(),\n",
      ),
    );
    expect(schemas("check").output).toContain("out of date");
    expect(schemas("write").code).toBe(0);
    expect(schemas("check").code).toBe(0);
  });
});

describe("diagnostic catalog (AX-03)", () => {
  const check = () => node("tools/docs/diagnostics.ts", "check");

  it("fails on a code without docs text and on a removed code", () => {
    expect(check().code).toBe(0);
    const generated = node(
      "tools/gen/cli.ts",
      "diagnostic",
      "MOSTRA_HOST_SEEDED",
      "--severity",
      "error",
      "--phase",
      "host",
      "--title",
      "Seeded",
    );
    expect(generated.code).toBe(0);
    const missing = check();
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain("MOSTRA_HOST_SEEDED has no hint text");

    repo.reset();
    repo.edit("packages/protocol/src/diagnostics/codes/host.ts", (t) =>
      t
        .replace('  "MOSTRA_HOST_REVISION_UNSUPPORTED",\n', "")
        .replace(/ {2}MOSTRA_HOST_REVISION_UNSUPPORTED: \{[\s\S]*?\n {2}\},\n/, ""),
    );
    repo.edit("packages/protocol/src/revision.ts", (t) =>
      t.replaceAll("MOSTRA_HOST_REVISION_UNSUPPORTED", "MOSTRA_HOST_X" as string),
    );
    const removed = check();
    expect(removed.code).not.toBe(0);
    expect(removed.output).toContain("MOSTRA_HOST_REVISION_UNSUPPORTED was removed");
  });
});

describe("repository lint", () => {
  const lint = () => node("tools/repo-lint/cli.ts");

  it("rejects an action not pinned to a commit SHA", () => {
    expect(lint().code).toBe(0);
    mkdirSync(join(repo.root, ".github/workflows"), { recursive: true });
    repo.write(
      ".github/workflows/seeded.yml",
      "name: seeded\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    );
    const result = lint();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("actions/checkout@v4 must be pinned to a full commit SHA");
  });

  it("rejects a LICENSE that isn't the canonical Apache-2.0 text, and a missing NOTICE", () => {
    repo.edit("LICENSE", (t) => t.replace("Apache License", "Apache Licence"));
    repo.run("rm", ["NOTICE"]);
    const result = lint();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("LICENSE is not the canonical Apache-2.0 text");
    expect(result.output).toContain("NOTICE is missing");
  });

  it("rejects a dependency version outside the catalogs", () => {
    repo.edit("packages/protocol/package.json", (t) =>
      t.replace('"zod": "catalog:"', '"zod": "^4.6.5"'),
    );
    const result = lint();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('dependencies.zod is "^4.6.5"');
  });
});

describe("commits (EN-01)", () => {
  const range = () => node("tools/commits/cli.ts", "range", "origin/main..HEAD");

  it("rejects a commit without a DCO sign-off or a Conventional Commit subject", () => {
    repo.write("seed.txt", "1\n");
    repo.git("add", "seed.txt");
    repo.git("commit", "-q", "--no-verify", "-m", "Add a seed");
    const result = range();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("missing the DCO sign-off");
    expect(result.output).toContain("is not a Conventional Commit");

    repo.git("reset", "-q", "--hard", "origin/main");
    repo.write("seed.txt", "2\n");
    repo.git("add", "seed.txt");
    repo.git("commit", "-q", "--no-verify", "-s", "-m", "chore: add a seed");
    expect(range().code).toBe(0);
    repo.git("reset", "-q", "--hard", "origin/main");
  });
});

describe("Rust", () => {
  const lib = "crates/mostra-host/src/lib.rs";

  it("cargo fmt and clippy fail on seeded violations", () => {
    expect(repo.run("cargo", ["fmt", "--all", "--check"]).code).toBe(0);
    repo.edit(lib, (t) => `${t}\npub fn seeded( )->u8{1}\n`);
    expect(repo.run("cargo", ["fmt", "--all", "--check"]).code).not.toBe(0);

    repo.reset();
    repo.edit(
      lib,
      (t) => `${t}\n/// Seeded.\n#[must_use]\npub fn seeded() -> u8 {\n    return 1;\n}\n`,
    );
    expect(repo.run("cargo", ["fmt", "--all", "--check"]).code).toBe(0);
    const clippy = repo.run("cargo", [
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ]);
    expect(clippy.code).not.toBe(0);
    expect(clippy.output).toContain("needless_return");
  });

  it("cargo-deny rejects a license outside the allowlist", () => {
    expect(repo.run("cargo", ["deny", "--locked", "check", "licenses"]).code).toBe(0);
    repo.edit("Cargo.toml", (t) => t.replace('license = "Apache-2.0"', 'license = "BUSL-1.1"'));
    const result = repo.run("cargo", ["deny", "--locked", "check", "licenses"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("BUSL-1.1");
  });
});

describe("generated design documents", () => {
  it("the docs job fails when the evidence matrix drifts from the dossier", () => {
    expect(repo.run("python3", ["tools/design/evidence_matrix.py", "--check"]).code).toBe(0);
    repo.edit("docs/design/EVIDENCE_MATRIX.md", (t) => `${t}\nSeeded drift.\n`);
    const result = repo.run("python3", ["tools/design/evidence_matrix.py", "--check"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("EVIDENCE_MATRIX.md is stale");
  });
});
