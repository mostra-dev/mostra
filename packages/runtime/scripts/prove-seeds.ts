/**
 * Seeded-violation proofs for the runtime's owned requirements (README §3 of the work-package
 * protocol): each seed breaks the product in one place, rebuilds, runs the check that must catch
 * it (red), restores the file and runs the check again (green). Run from the repository root:
 *
 *   node packages/runtime/scripts/prove-seeds.ts [--only RT-09]
 *
 * It edits source files in place and restores them in `finally`, also on Ctrl-C. Don't run it
 * with uncommitted edits to the seeded files.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

interface Seed {
  readonly requirement: string;
  readonly name: string;
  /** Relative to packages/runtime. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Further edits planted with the first, for a violation that must defeat more than one guard. */
  readonly also?: readonly { readonly file: string; readonly from: string; readonly to: string }[];
  /** Vitest arguments, run in packages/runtime. */
  readonly check: readonly string[];
}

const integration = (file: string, ...filter: string[]): string[] => [
  "--project",
  "integration",
  `test/integration/${file}`,
  ...(filter.length > 0 ? ["-t", ...filter] : []),
];

const SEEDS: readonly Seed[] = [
  {
    requirement: "RT-06",
    name: "the ledger lock isn't exclusive",
    file: "src/ledger/index.ts",
    from: 'db.pragma("locking_mode = EXCLUSIVE");',
    to: "",
    check: integration("instance.test.ts", "16 daemons"),
  },
  {
    requirement: "RT-06",
    name: "a losing starter never reaches the owner",
    file: "src/home/acquire.ts",
    from: "await attach(record.socket, options.client, 2000);",
    to: 'await attach(record.socket + ".x", options.client, 2000);',
    check: integration("instance.test.ts", "16 daemons"),
  },
  {
    requirement: "RT-06",
    name: "a stale socket file isn't replaced",
    file: "src/protocol-server/server.ts",
    from: "unlinkSync(path);",
    to: "",
    check: integration("instance.test.ts", "recovers after a SIGKILL"),
  },
  {
    requirement: "RT-07",
    name: "the platform gate is skipped",
    file: "src/instance/index.ts",
    from: "if (gate) throw new RpcError(gate);",
    to: "",
    check: integration("platform.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "nothing is reaped on start",
    file: "src/processes/manager.ts",
    from: "if (rows.length === 0) return [];",
    to: "return [];",
    check: integration("reaping.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "a reused PID is signalled",
    file: "src/processes/manager.ts",
    from: 'if (leader && leader.startTime !== row.start_time) return "pid reused";',
    to: "",
    check: integration("reaping.test.ts"),
  },
  {
    requirement: "RT-09",
    name: "a child's group outlives it",
    file: "src/processes/manager.ts",
    from: "await endGroups([pid, ...adopted.values()], 2000);",
    to: "",
    check: integration("processes.test.ts", "take down their group"),
  },
  {
    requirement: "HO-02",
    name: "the oldest common revision is picked",
    file: "../protocol/src/revision.ts",
    from: "const newest = common.at(-1);",
    to: "const newest = common.at(0);",
    check: ["--project", "unit", "test/unit/protocol-server.test.ts"],
  },
  {
    requirement: "HO-02",
    name: "an unsupported revision is accepted",
    file: "../protocol/src/revision.ts",
    from: "if (newest !== undefined) return { ok: true, revision: newest };",
    to: "return { ok: true, revision: newest ?? (supported[0] as Revision) };",
    check: integration("protocol-suite.test.ts", "refuses an unsupported"),
  },
  // WP-03.
  {
    requirement: "AU-01",
    name: "builds drop the Tailwind baseline",
    file: "src/builder/child/spa.ts",
    from: "        tailwind(),\n",
    to: "",
    check: integration("render.test.ts", "single plain React page"),
  },
  {
    requirement: "AU-02",
    name: "server modules reach the browser unchanged",
    file: "src/builder/child/spa.ts",
    from: "serverClientStubPlugin(serverModules),",
    to: "",
    check: integration("publish.test.ts", "publishes a directory"),
  },
  {
    requirement: "AU-03",
    name: "publish writes into the artifact's directory",
    file: "src/publish/publisher.ts",
    from: "const source = await resolveSource(path);",
    to: 'const source = await resolveSource(path);\n    await writeFile(join(source.root, ".mostra-cache"), "");',
    check: integration("publish.test.ts", "writing nothing"),
  },
  {
    requirement: "AU-04",
    name: "the description is dropped",
    file: "src/registry/index.ts",
    from: "...(manifest?.description !== undefined ? { description: manifest.description } : {}),",
    to: "",
    check: integration("publish.test.ts", "metadata round-trips"),
  },
  {
    requirement: "AU-07",
    name: "a value that needs evaluation is accepted",
    file: "src/publish/manifest.ts",
    from: "    default:\n      return x.fail(",
    to: "    default:\n      return undefined as never;\n      return x.fail(",
    check: ["--project", "unit", "test/unit/manifest.test.ts"],
  },
  {
    requirement: "AU-07",
    name: "a copy claiming an ID takes it over",
    file: "src/registry/index.ts",
    from: "if (input.stillClaims(path, input.manifestId)) {",
    to: "if (false) {",
    check: integration("publish.test.ts", "refuses a copy"),
  },
  {
    requirement: "VR-01",
    name: "the version ID ignores the artifact (D89)",
    file: "src/publish/digest.ts",
    from: 'hash.update(Buffer.from(artifactId, "utf8"));',
    to: "",
    check: integration("publish.test.ts", "identical files two versions"),
  },
  {
    requirement: "VR-01",
    name: "node_modules is part of the source",
    file: "src/publish/source.ts",
    from: 'new Set(["node_modules", ".git", ".mostra"])',
    to: 'new Set([".git", ".mostra"])',
    check: integration("publish.test.ts", "ignores node_modules"),
  },
  {
    requirement: "VR-02",
    name: "a failed publish leaves its store files",
    file: "src/publish/publisher.ts",
    from: "for (const step of undo.reverse()) {",
    to: "for (const step of [] as typeof undo) {",
    check: integration("publish-faults.test.ts", "cleans up after a failure"),
  },
  {
    requirement: "VR-02",
    name: "nothing is recovered on start",
    file: "src/registry/index.ts",
    from: "return store.sweep(known);",
    to: "return { versions: [], snapshots: [] };",
    check: integration("publish-faults.test.ts", "recovers from a crash"),
  },
  {
    requirement: "VR-11",
    name: "no source snapshot is kept",
    file: "src/publish/publisher.ts",
    from: "if (existsSync(target)) return false;",
    to: "return false;",
    check: integration("publish.test.ts", "outlive their source"),
  },
  {
    requirement: "RT-02",
    name: "the supervisor imports an artifact module",
    file: "src/publish/publisher.ts",
    from: "const extracted = extractManifest(",
    to: 'await import(join(staging, "source", "live.ts")).catch(() => {});\n          const extracted = extractManifest(',
    check: integration("audit.test.ts"),
  },
  {
    requirement: "VR-02",
    name: "a publish's receipt isn't recorded with its commit",
    file: "src/registry/index.ts",
    from: "if (input.requestId !== undefined) {",
    to: "if (false) {",
    check: integration("publish-faults.test.ts", "replays the committed receipt"),
  },
  {
    requirement: "#7",
    name: "children run before they are recorded",
    file: "src/processes/manager.ts",
    from: `const GATE_SCRIPT = 'IFS= read -r go <&3 && [ "$go" = go ] || exit 125; exec 3<&-; exec "$@"';`,
    to: `const GATE_SCRIPT = 'exec 3<&-; exec "$@"';`,
    check: integration("reaping.test.ts", "recorded before it runs"),
  },
  // The D80 review's findings, each with the regression test that catches it.
  {
    requirement: "review-1",
    name: "an error reaches the host unredacted",
    file: "src/protocol-server/server.ts",
    from: "if (!redact || !(error instanceof RpcError)) throw error;",
    to: "throw error;",
    check: integration("publish.test.ts", "redacts capability material"),
  },
  {
    requirement: "review-2",
    name: "a file's failed sync is ignored",
    file: "src/registry/store.ts",
    from: 'if (!directory || !unsupported.includes(code ?? "")) throw error;',
    to: "if (false) throw error;",
    check: ["--project", "unit", "test/unit/store.test.ts"],
  },
  {
    requirement: "review-4",
    name: "a retried create doesn't finish the recorded one",
    file: "src/publish/publisher.ts",
    from: "await writeScaffold(result.dir, result.artifactId, params.title ?? basename(result.dir));",
    to: "",
    check: integration("publish-faults.test.ts", "completes the creation"),
  },
  {
    requirement: "review-5",
    name: "imports from outside the artifact are built",
    file: "src/builder/child/plugins.ts",
    from: 'if (file.startsWith("\\0") || inside(file) || !existsSync(file)) return resolved;',
    to: "return resolved;",
    check: integration("publish.test.ts", "refuses imports from outside"),
  },
  {
    requirement: "review-6",
    name: "output paths start with a slash",
    file: "src/publish/publisher.ts",
    from: 'for (const top of ["client", "server"]) {',
    to: 'for (const top of ["/client", "/server"]) {',
    check: integration("publish.test.ts", "reproduces"),
  },
  {
    requirement: "review-7",
    name: "the output digest lists execute bits the sealed tree lacks",
    file: "src/publish/publisher.ts",
    from: "files.push({ path, executable: false, sha256: await hashFile(absolute) });",
    to: "files.push({ path, executable: ((await stat(absolute)).mode & 0o111) !== 0, sha256: await hashFile(absolute) });",
    check: integration("publish.test.ts", "reproduces"),
  },
  {
    requirement: "review-8",
    name: "TypeScript wrappers hide async functions",
    file: "src/builder/child/scan.ts",
    from: "while (current !== undefined && ERASED_WRAPPERS.has(current.type)) {",
    to: "while (false) {",
    check: ["--project", "unit", "test/unit/scan.test.ts"],
  },
  {
    requirement: "review-10",
    name: "enums and namespaces pass as erased",
    file: "src/builder/child/scan.ts",
    from: 'node.type === "TSDeclareFunction";',
    to: 'node.type.startsWith("TS");',
    check: ["--project", "unit", "test/unit/scan.test.ts"],
  },
  // The Claude Opus review's findings (D80).
  {
    requirement: "claude-1",
    name: "any package that resolves is built, from wherever it lives",
    file: "src/builder/child/plugins.ts",
    from: "if (fromPackage && !packaged(from)) return null;",
    to: "if (fromPackage) return null;",
    check: integration("ancestors.test.ts", "undeclared dependency"),
  },
  {
    requirement: "claude-1",
    // Two independent guards stop the search: the inline config, and the staging root's own
    // package.json (PostCSS's search stops at a package root). Both are removed.
    name: "PostCSS config is searched for again",
    file: "src/builder/child/spa.ts",
    from: "css: { postcss: {} },",
    to: "",
    also: [
      {
        file: "src/builder/types.ts",
        from: '"package.json": `${JSON.stringify({ private: true, type: "module" }, null, 2)}\\n`,',
        to: "",
      },
    ],
    check: integration("ancestors.test.ts", "runs no PostCSS config"),
  },
  {
    requirement: "claude-1",
    name: "a tsconfig.json above the home sets the compile options",
    file: "src/builder/types.ts",
    from: '"tsconfig.json": `',
    to: '"tsconfig.unused.json": `',
    check: integration("ancestors.test.ts", "compiles with Mostra's settings"),
  },
  {
    requirement: "claude-2",
    name: "a server module without a stub reaches the client",
    file: "src/builder/child/scan.ts",
    from: '".cts",',
    to: "",
    check: integration("publish.test.ts", "cts server module"),
  },
  {
    requirement: "claude-3",
    name: "a damaged version is left as it is",
    file: "src/publish/publisher.ts",
    from: "if (!exists || damage !== undefined) {",
    to: "if (!exists) {",
    check: integration("publish.test.ts", "rebuilds a lost"),
  },
];

const runtime = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(runtime, "../..");
const { values } = parseArgs({ options: { only: { type: "string" } } });

function build(): void {
  for (const name of ["@mostra/protocol", "@mostra/runtime"]) {
    execFileSync("pnpm", ["--filter", name, "build"], { cwd: root, stdio: "ignore" });
  }
}

function check(args: readonly string[]): { ok: boolean; summary: string } {
  const result = spawnSync("npx", ["vitest", "run", ...args], { cwd: runtime, encoding: "utf8" });
  const text = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
  const summary = text.split("\n").find((line) => line.includes("Tests ")) ?? "no summary";
  return { ok: result.status === 0, summary: summary.trim() };
}

let restore: (() => void) | undefined;
process.on("SIGINT", () => {
  restore?.();
  process.exit(130);
});

let missed = 0;
for (const seed of SEEDS) {
  if (values.only && seed.requirement !== values.only) continue;
  const edits = [{ file: seed.file, from: seed.from, to: seed.to }, ...(seed.also ?? [])];
  const originals = edits.map((edit) => {
    const path = join(runtime, edit.file);
    return { path, edit, text: readFileSync(path, "utf8") };
  });
  const absent = originals.find(({ edit, text }) => !text.includes(edit.from));
  if (absent) {
    console.log(`${seed.requirement} | ${seed.name} | SEED NOT FOUND in ${absent.edit.file}`);
    missed++;
    continue;
  }
  restore = () => {
    for (const { path, text } of originals) writeFileSync(path, text);
  };
  let red: { ok: boolean; summary: string };
  try {
    for (const { path, edit } of originals) {
      writeFileSync(path, readFileSync(path, "utf8").replace(edit.from, edit.to));
    }
    build();
    red = check(seed.check);
  } finally {
    restore();
    restore = undefined;
  }
  build();
  const green = check(seed.check);
  if (red.ok || !green.ok) missed++;
  console.log(
    `${seed.requirement} | ${seed.name} | seeded: ${red.ok ? "GREEN (missed)" : "red"} (${red.summary}) | restored: ${green.ok ? "green" : "RED"} (${green.summary})`,
  );
}
process.exit(missed === 0 ? 0 : 1);
