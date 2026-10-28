/**
 * Every gate, proven by a seeded violation (WP-01 acceptance evidence; EN-01, EN-04, EN-06,
 * EN-07, DP-06, KT-02, HO-07, AX-03; WP-11: EN-09's ee/ boundary). Each test plants one violation in a repository copy, runs
 * the real gate command there and expects a failure that names the problem, then removes the
 * violation and expects the gate to pass.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
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
    const baseline = depcruise();
    expect(baseline.code, baseline.output).toBe(0);

    repo.write(
      "packages/protocol/src/seed-builtin.ts",
      'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
    );
    repo.write(
      "packages/protocol/src/seed-external.ts",
      'import ts from "typescript";\nexport const y = ts;\n',
    );
    // Seeded modules with names of their own, so the real runtime modules stay untouched.
    mkdirSync(join(repo.root, "packages/runtime/src/seed-store"), { recursive: true });
    mkdirSync(join(repo.root, "packages/runtime/src/seed-gate"), { recursive: true });
    mkdirSync(join(repo.root, "packages/worker/src"), { recursive: true });
    repo.write("packages/runtime/src/seed-store/index.ts", 'export * from "./internal.ts";\n');
    repo.write("packages/runtime/src/seed-store/internal.ts", "export const ledger = 1;\n");
    repo.write(
      "packages/runtime/src/seed-gate/index.ts",
      'export { ledger } from "../seed-store/internal.ts";\n',
    );
    repo.write(
      "packages/worker/src/index.ts",
      'export { ledger } from "../../runtime/src/seed-store/index.ts";\n',
    );
    const result = depcruise();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no-node-builtins:@mostra/protocol");
    expect(result.output).toContain("external-allowlist:@mostra/protocol");
    expect(result.output).toContain("boundary:@mostra/worker");
    expect(result.output).toContain("runtime-module-internals");

    repo.reset();
    const fixed = depcruise();
    expect(fixed.code, fixed.output).toBe(0);
  });

  it("dependency-cruiser keeps the bundler and native modules out of the supervisor (RT-02, RT-07)", () => {
    // The supervisor imports Vite, a builder child module, and a native module at load time.
    repo.write(
      "packages/runtime/src/seed-supervisor.ts",
      [
        'import { build } from "vite";',
        'import { buildSpa } from "./builder/child/spa.ts";',
        'import { parseSync } from "oxc-parser";',
        "export const seeded = [build, buildSpa, parseSync];",
        "",
      ].join("\n"),
    );
    const result = depcruise();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("runtime-vite-in-builder-only");
    expect(result.output).toContain("runtime-builder-child-isolated");
    expect(result.output).toContain("runtime-native-modules-lazy");

    repo.reset();
    // A type-only import of a native module is fine: it loads nothing.
    repo.write(
      "packages/runtime/src/seed-supervisor.ts",
      'import type * as Oxc from "oxc-parser";\nexport type Seeded = typeof Oxc;\n',
    );
    const fixed = depcruise();
    expect(fixed.code, fixed.output).toBe(0);
  });

  it("dependency-cruiser refuses any import from the core into ee/ (D118, EN-09)", () => {
    // An ee/ package with its own code, as the first package that needs ee/ will add it.
    mkdirSync(join(repo.root, "ee/sso/src"), { recursive: true });
    repo.write("ee/sso/src/index.ts", "export const sso = 1;\n");
    repo.write(
      "packages/runtime/src/seed-ee.ts",
      'import { sso } from "../../../ee/sso/src/index.ts";\nexport const seeded = sso;\n',
    );
    const result = depcruise();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("core-never-imports-ee");

    // The same ee/ code with no core module importing it is fine.
    repo.reset();
    mkdirSync(join(repo.root, "ee/sso/src"), { recursive: true });
    repo.write("ee/sso/src/index.ts", "export const sso = 1;\n");
    const fixed = depcruise();
    expect(fixed.code, fixed.output).toBe(0);
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

describe("ee/ packing check (D118, EN-09)", () => {
  it("fails a core package whose tarball would carry ee/ code, and passes once it's gone", () => {
    const check = () =>
      repo.run("node", ["../../tools/bin/mostra-tools.ts", "pack-check"], { cwd: "packages/sdk" });
    const clean = check();
    expect(clean.code, clean.output).toBe(0);
    // An ee/ file under dist/, and a bundle whose sourcemap shows it inlined ee/ code.
    mkdirSync(join(repo.root, "packages/sdk/dist/ee"), { recursive: true });
    repo.write("packages/sdk/dist/ee/sso.js", "export const sso = 1;\n");
    repo.write(
      "packages/sdk/dist/inlined.js.map",
      JSON.stringify({ version: 3, sources: ["../../../ee/sso/src/index.ts"], mappings: "" }),
    );
    const result = check();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("packs dist/ee/sso.js, a file under ee/");
    expect(result.output).toContain("built from ee/sso/src/index.ts in ee/");
    // dist/ is git-ignored, so reset() wouldn't remove the seed: remove it by hand.
    rmSync(join(repo.root, "packages/sdk/dist/ee"), { recursive: true });
    rmSync(join(repo.root, "packages/sdk/dist/inlined.js.map"));
    const fixed = check();
    expect(fixed.code, fixed.output).toBe(0);
  });
});

describe("size budget", () => {
  it("size-limit fails when the entry exceeds its budget", () => {
    const size = () => repo.run("node_modules/.bin/size-limit", [], { cwd: "packages/protocol" });
    expect(repo.run("node_modules/.bin/tsdown", [], { cwd: "packages/protocol" }).code).toBe(0);
    expect(size().code).toBe(0);
    repo.edit("packages/protocol/package.json", (text) => {
      const seeded = text.replace(/"limit": "[^"]+"/g, '"limit": "100 B"');
      expect(seeded).not.toBe(text);
      return seeded;
    });
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

  it("fails when a published bundle is removed (review finding 2)", () => {
    repo.edit("packages/protocol/scripts/wire-schemas.ts", (t) =>
      t.replace(
        "export const bundles = [",
        "export const bundles = [] as const;\nexport const unused = [",
      ),
    );
    const check = schemas("check");
    expect(check.code).not.toBe(0);
    expect(check.output).toContain('bundle "protocol" was removed or renamed');
  });

  it("refuses a custom refinement JSON Schema can't express (review finding 7)", () => {
    repo.edit("packages/protocol/src/diagnostics/diagnostic.ts", (t) =>
      t.replace(
        "    message: z.string(),",
        "    message: z.string().refine((value) => value.length > 0),",
      ),
    );
    const write = schemas("write");
    expect(write.code).not.toBe(0);
    expect(write.output).toContain("uses a custom refinement");
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

  it("wires a new area into the catalog and the package entry point", () => {
    const generated = node(
      "tools/gen/cli.ts",
      "diagnostic",
      "MOSTRA_SHARE_SEEDED",
      "--severity",
      "error",
      "--phase",
      "host",
      "--title",
      "Seeded",
    );
    expect(generated.code).toBe(0);
    const entry = readFileSync(join(repo.root, "packages/protocol/src/index.ts"), "utf8");
    // Biome merges the generated line into the entry's export from the catalog.
    const fromCatalog = /export \{([^}]*)\} from "\.\/diagnostics\/codes\/index\.ts";/.exec(entry);
    expect(fromCatalog?.[1]).toMatch(/\btype ShareDiagnosticCode\b/);
    expect(fromCatalog?.[1]).toMatch(/\bshareDiagnosticCodes\b/);
    const codes = readFileSync(
      join(repo.root, "packages/protocol/src/diagnostics/codes/index.ts"),
      "utf8",
    );
    expect(codes).toContain("...shareDiagnostics,");
  });

  it("keeps the code union valid when two new areas are added in a row (WP-03 finding)", () => {
    for (const code of ["MOSTRA_SHARE_SEEDED", "MOSTRA_TERM_SEEDED"]) {
      const generated = node(
        "tools/gen/cli.ts",
        "diagnostic",
        code,
        "--severity",
        "error",
        "--phase",
        "host",
        "--title",
        "Seeded",
      );
      expect(generated.code).toBe(0);
    }
    const codes = readFileSync(
      join(repo.root, "packages/protocol/src/diagnostics/codes/index.ts"),
      "utf8",
    );
    const union = codes.slice(
      codes.indexOf("KnownDiagnosticCode ="),
      codes.indexOf(";", codes.indexOf("KnownDiagnosticCode =")),
    );
    expect(union).toMatch(/\bShareDiagnosticCode\b/);
    expect(union).toMatch(/\bTermDiagnosticCode\b/);
    expect(union).not.toMatch(/\|\s*\|/);
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

  it("rejects a published package bringing one that runs on fewer Node.js versions (#92)", () => {
    repo.edit("packages/protocol/package.json", (t) =>
      t.replace(/"node": "[^"]*"/, '"node": ">=24"'),
    );
    const result = lint();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain(
      '@mostra/sdk declares node ">=22.19" but brings @mostra/protocol@',
    );
    expect(result.output).toContain("create-mostra declares node");
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

describe("check runner", () => {
  const check = (...args: string[]) => node("tools/check/cli.ts", ...args);

  it("runs every job when the check machinery changes (review finding 10)", () => {
    repo.edit("tools/check/jobs.ts", (t) => `${t}\n// seeded change\n`);
    const plan = JSON.parse(check("--plan", "--json", "--affected").output) as { jobs: string[] };
    expect(plan.jobs).toEqual(
      expect.arrayContaining(["rust", "licenses", "docs", "api", "commits"]),
    );
  });

  it("fails on a base that doesn't resolve instead of falling back (review finding 11)", () => {
    const result = check("--plan", "--base", "no-such-ref");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('The base "no-such-ref" doesn\'t resolve');
  });

  it("fails a job whose prerequisite build failed (review finding 9)", () => {
    repo.edit("packages/protocol/src/index.ts", (t) => `${t}\nexport const broken: number = ;\n`);
    const result = check("--job", "api");
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/✗ api/);
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
