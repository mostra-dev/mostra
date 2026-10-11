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
  const path = join(runtime, seed.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(seed.from)) {
    console.log(`${seed.requirement} | ${seed.name} | SEED NOT FOUND in ${seed.file}`);
    missed++;
    continue;
  }
  restore = () => writeFileSync(path, original);
  let red: { ok: boolean; summary: string };
  try {
    writeFileSync(path, original.replace(seed.from, seed.to));
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
