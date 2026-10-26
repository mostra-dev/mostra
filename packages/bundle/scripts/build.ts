#!/usr/bin/env node
/**
 * The runtime bundle assembler (RT-01, D142): builds this platform's bundle from the workspace.
 *
 *   pnpm exec node packages/bundle/scripts/build.ts --out <dir> [--skip-build] [--node-archive <file>]
 *
 * 1. builds the packages the bundle carries (Turborepo);
 * 2. unpacks the official Node.js distribution, checked against `packages/bundle/node.json`;
 * 3. deploys `@mostra/bundle`'s production dependencies, hoisted, as `lib/node_modules`, and the
 *    warm set apart, isolated, as `lib/node_modules/@mostra/warm`;
 * 4. writes the launchers (POSIX scripts; on Windows the `.exe` launcher and the helpers,
 *    `mostra-win.exe` and `mostra-win-service.exe`, built by Cargo), `LICENSE` and `NOTICE`;
 * 5. fetches the verify browser once to pin its files (it never enters the archive);
 * 6. writes `files.json` (the SDK's own `describeTree`) and `bundle.json`;
 * 7. packs `mostra-<version>-<platform>.tar.gz` with sorted entries, no owners and one fixed time,
 *    and writes `mostra-<version>-<platform>.json`, its asset record (size, SHA-256, unpacked size).
 *    A Windows archive holds no links: `files.json` lists them, each to a directory, and setup
 *    makes each a junction, since an ordinary Windows user can't create symbolic links (D153).
 *
 * A bundle is built on the platform it is for: the native packages and the browser are this
 * machine's. Release CI runs it on one runner per platform (REPO_STANDARDS §9).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { c } from "tar";

/** Whether this build is for Windows, whose bundle differs in its launchers, Node.js and links. */
const WINDOWS = process.platform === "win32";

/** The Node.js executable inside a bundle: `node/bin/node`, or `node/node.exe` on Windows. */
const NODE_PATH = WINDOWS ? "node/node.exe" : "node/bin/node";

/** The repository root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fromRoot = (...parts: string[]): string => join(ROOT, ...parts);

function fail(problems: readonly string[], heading: string): never {
  console.error(`✗ ${heading}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

function git(args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * The program and arguments that run `command args`. pnpm is started as the program that runs
 * this script names itself (`npm_execpath`, under `pnpm exec`: on Windows `pnpm.exe`), never
 * through its `.cmd` shim, which Node.js starts only through `cmd.exe` (CVE-2024-27980) and whose
 * `%~dp0` names the wrong directory when `cmd.exe` gets it quoted (VERIFIED_FACTS, WP-W3).
 */
function commandFor(command: string, args: readonly string[]): [string, string[]] {
  if (command !== "pnpm") return [command, [...args]];
  const own = process.env["npm_execpath"];
  if (own && /pnpm/i.test(own)) {
    if (/\.[cm]?js$/.test(own)) return [process.execPath, [own, ...args]];
    return [own, [...args]];
  }
  if (WINDOWS) {
    fail(
      [
        "On Windows run the assembler through pnpm: pnpm exec node packages/bundle/scripts/build.ts",
      ],
      "bundle",
    );
  }
  return ["pnpm", [...args]];
}

/** Runs a command with its output passed through, resolving with its exit code. */
function runStreaming(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((done) => {
    const [program, argv] = commandFor(command, args);
    const child = spawn(program, argv, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (error) => {
      console.error(`${command}: ${error.message}`);
      done(127);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    "skip-build": { type: "boolean", default: false },
    "node-archive": { type: "string" },
  },
  strict: true,
});
if (!values.out) fail(["--out <dir> is required."], "bundle");
const out = resolve(values.out as string);

/** Every Mostra package a bundle carries; each must be at the release's version (one version). */
const MOSTRA_PACKAGES = [
  "@mostra/cli",
  "@mostra/protocol",
  "@mostra/react",
  "@mostra/runtime",
  "@mostra/sdk",
  "@mostra/server",
  "@mostra/shell",
  "@mostra/verify",
  "@mostra/worker",
];

/** Where each Mostra package lives in the workspace. */
const DIRS: Record<string, string> = Object.fromEntries(
  MOSTRA_PACKAGES.map((name) => [name, `packages/${name.slice("@mostra/".length)}`]),
);

function step(message: string): void {
  console.log(`bundle: ${message}`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function run(command: string, args: readonly string[], cwd = fromRoot()): Promise<void> {
  const code = await runStreaming(command, args, { cwd });
  if (code !== 0) fail([`${command} ${args.join(" ")} exited ${code}.`], "bundle");
}

/** The release version: every Mostra package's, which the fixed release group keeps equal. */
async function releaseVersion(): Promise<string> {
  const versions = new Map<string, string>();
  for (const name of MOSTRA_PACKAGES) {
    const manifest = JSON.parse(
      await readFile(fromRoot(DIRS[name] as string, "package.json"), "utf8"),
    );
    versions.set(name, manifest.version as string);
  }
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    fail(
      [...versions].map(([name, version]) => `${name} is ${version}`),
      "bundle: Mostra's packages must share one version (the fixed release group)",
    );
  }
  return [...distinct][0] as string;
}

/** The official Node.js archive for `platform`, downloaded once and checked against its pin. */
async function nodeArchive(platform: string): Promise<{ file: string; version: string }> {
  const pins = JSON.parse(await readFile(fromRoot("packages/bundle/node.json"), "utf8")) as {
    version: string;
    archives: Record<string, string>;
  };
  const expected = pins.archives[platform];
  if (!expected || !/^[0-9a-f]{64}$/.test(expected))
    fail([`packages/bundle/node.json pins no SHA-256 for ${platform}.`], "bundle");
  if (!/^\d+\.\d+\.\d+$/.test(pins.version) || !/^(darwin|linux|win32)-(arm64|x64)$/.test(platform))
    fail([`packages/bundle/node.json names no release ${pins.version} for ${platform}.`], "bundle");
  // Node.js names its Windows builds `win-<arch>` and ships them as zip archives.
  const name = platform.startsWith("win32-")
    ? `node-v${pins.version}-win-${platform.slice("win32-".length)}.zip`
    : `node-v${pins.version}-${platform}.tar.gz`;
  const file = values["node-archive"] ?? fromRoot(".cache", "bundle", name);
  // A cached archive is used only if it matches the pin; anything else is fetched again.
  const cached = await readFile(file).catch(() => undefined);
  if (cached !== undefined && digest(cached) === expected) return { file, version: pins.version };
  if (values["node-archive"]) fail([`${file} isn't the pinned ${name} (${expected}).`], "bundle");
  step(`downloading ${name}`);
  const bytes = await download(`https://nodejs.org/dist/v${pins.version}/${name}`, name);
  // Checked before anything is written: only the pinned bytes ever reach the disk.
  const actual = digest(bytes);
  if (actual !== expected)
    fail([`${name} has SHA-256 ${actual}, not the pinned ${expected}.`], "bundle");
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, file);
  return { file, version: pins.version };
}

/**
 * The bytes at `url`, in at most three attempts, as the SDK's installer makes them (D142 item 4):
 * a failed connection, a server error, 408 or 429 is tried again after 2 s, then 8 s; any other
 * answer fails at once. A release runner that couldn't reach nodejs.org once failed its bundle.
 */
async function download(url: string, name: string): Promise<Buffer> {
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((done) => setTimeout(done, attempt === 2 ? 2000 : 8000));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      problems.push(`attempt ${attempt}: nodejs.org answered ${response.status} for ${name}`);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause?.message;
      problems.push(`attempt ${attempt}: ${(error as Error).message}${cause ? ` (${cause})` : ""}`);
    }
  }
  fail(problems, `bundle: ${name} couldn't be downloaded`);
}

/** The SHA-256 of `bytes`, lowercase hex. */
function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Builds the Windows helpers and the launcher with Cargo (release, locked) and returns where they
 * are. The build machine's paths are mapped away (`--remap-path-prefix`), so a panic's location
 * names `crates/…` and `cargo/…`, never the checkout or the user's Cargo home.
 */
async function windowsBinaries(): Promise<string> {
  const cargoHome = process.env["CARGO_HOME"] ?? join(process.env["USERPROFILE"] ?? "", ".cargo");
  const remap = [`--remap-path-prefix=${ROOT}=.`, `--remap-path-prefix=${cargoHome}=cargo`];
  // Cargo's encoded form, one flag per \x1f-separated item: RUSTFLAGS is split on spaces, so a
  // checkout or Cargo home whose path holds one would break the flag (Opus review of WP-W3,
  // finding 10). Flags the environment already sets are kept, as Cargo itself reads them.
  const encoded = process.env["CARGO_ENCODED_RUSTFLAGS"];
  const given = encoded
    ? encoded.split("\x1f")
    : (process.env["RUSTFLAGS"] ?? "").split(/\s+/).filter(Boolean);
  const flags = [...given, ...remap].join("\x1f");
  const bins = ["mostra-win", "mostra-win-service", "mostra-launch"].flatMap((bin) => [
    "--bin",
    bin,
  ]);
  const code = await runStreaming(
    "cargo",
    ["build", "--release", "--locked", "-p", "mostra-win", ...bins],
    {
      env: { ...process.env, RUSTFLAGS: undefined, CARGO_ENCODED_RUSTFLAGS: flags },
    },
  );
  if (code !== 0) fail([`cargo build exited ${code}.`], "bundle");
  return fromRoot("target", "release");
}

/**
 * The license texts of every third-party crate compiled into the Windows programs (their MIT and
 * Apache-2.0 terms ask a binary to carry them): the crates `cargo tree` lists for `mostra-win` on
 * this machine, each with the license files of its own source. Fails on a crate without one.
 */
function rustLicenses(): string {
  const tree = spawnSync(
    "cargo",
    ["tree", "--locked", "-p", "mostra-win", "-e", "normal", "--prefix", "none", "--format", "{p}"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (tree.status !== 0) fail([`cargo tree: ${tree.stderr.trim()}`], "bundle");
  const wanted = new Set(
    tree.stdout
      .split("\n")
      .map((line) => /^(\S+) v(\S+)/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null && match[1] !== "mostra-win")
      .map((match) => `${match[1]}@${match[2]}`),
  );
  const metadata = spawnSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (metadata.status !== 0) fail([`cargo metadata: ${metadata.stderr.trim()}`], "bundle");
  const packages = (
    JSON.parse(metadata.stdout) as {
      packages: { name: string; version: string; license?: string; manifest_path: string }[];
    }
  ).packages.filter((pkg) => wanted.has(`${pkg.name}@${pkg.version}`));
  if (packages.length !== wanted.size)
    fail([`cargo metadata names ${packages.length} of ${wanted.size} crates.`], "bundle");
  const sections: string[] = [
    "Third-party crates compiled into mostra.exe, mostra-runtime.exe, mostra-setup.exe,",
    "mostra-win.exe and mostra-win-service.exe, with their license texts.",
    "",
  ];
  for (const pkg of packages.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = dirname(pkg.manifest_path);
    const files = readdirSync(dir)
      .filter((name) => /^(licen[cs]e|copying|notice)/i.test(name))
      .sort();
    if (files.length === 0) fail([`${pkg.name} ${pkg.version} has no license file.`], "bundle");
    sections.push(
      `${"=".repeat(78)}\n${pkg.name} ${pkg.version} (${pkg.license ?? "see below"})\n`,
    );
    for (const file of files)
      sections.push(`--- ${file}\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`);
  }
  return `${sections.join("\n")}\n`;
}

/** The launchers in `bin/`: each runs its entry with the bundle's own Node.js, from any path. */
function launcher(entry: string): string {
  return [
    "#!/bin/sh",
    "# Runs a Mostra entry point on the runtime bundle's own Node.js (RT-01).",
    'here=$(cd -P -- "$(dirname -- "$0")" && pwd -P) || exit 3',
    'root=$(dirname -- "$here")',
    `exec "$root/node/bin/node" "$root/${entry}" "$@"`,
    "",
  ].join("\n");
}

/** Every path under `dir`, relative to `base`, directories before their contents, sorted. */
async function entries(base: string, dir: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const children = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const child of children) {
      const path = join(current, child.name);
      // A Windows archive carries no links: `files.json` lists them, and setup makes them (D153).
      if (WINDOWS && child.isSymbolicLink()) continue;
      found.push(relative(base, path));
      if (child.isDirectory() && !child.isSymbolicLink()) await visit(path);
    }
  };
  found.push(relative(base, dir));
  await visit(dir);
  return found;
}

/**
 * What `pnpm deploy` leaves that nothing at run time reads (VERIFIED_FACTS, WP-11): its lockfiles,
 * workspace file and `.modules.yaml` (which name the build machine's store and paths), and the
 * global-virtual-store tree pnpm 12 writes beside the real one, which no link points into: all of
 * `.pnpm` in the hoisted layout, and the `@`/`@<scope>` entries (no `+`, no version) in the warm
 * set's isolated one, whose `<name>@<version>` entries are the links' targets. The deployed
 * manifests' `file:` specifiers for workspace packages become the release version. Whatever this
 * gets wrong, the link and path gates below catch.
 */
async function pruneDeploy(stage: string, version: string): Promise<void> {
  const lib = join(stage, "lib");
  const warm = join(lib, "node_modules", "@mostra", "warm");
  // Deploy copies the deployed package's whole directory (the assembler's own scripts, docs and
  // build caches) beside node_modules: only node_modules and the manifest belong in a bundle.
  for (const entry of await readdir(lib)) {
    if (entry !== "node_modules" && entry !== "package.json")
      await rm(join(lib, entry), { recursive: true, force: true });
  }
  for (const path of [
    join(lib, "pnpm-lock.yaml"),
    join(lib, "node_modules", ".modules.yaml"),
    join(lib, "node_modules", ".pnpm"),
    join(warm, "pnpm-lock.yaml"),
    join(warm, "pnpm-workspace.yaml"),
    join(warm, "node_modules", ".modules.yaml"),
    join(warm, "node_modules", ".pnpm", "lock.yaml"),
  ]) {
    await rm(path, { recursive: true, force: true });
  }
  // pnpm's own install state, which names the directory it deployed into, wherever deploy left it.
  await removeEverywhere(lib, (name) => /^\.pnpm-workspace-state(-v\d+)?\.json$/.test(name));
  // On Windows pnpm writes each `node_modules/.bin` entry as shim files (sh, `.cmd`, `.ps1`) whose
  // NODE_PATH names the build machine's store, where POSIX has relative links. Nothing in a bundle
  // runs them (its launchers are `bin/`, its programs run on its Node.js by path), so a Windows
  // bundle carries none.
  if (WINDOWS) await removeDirectoriesNamed(lib, ".bin");
  const store = join(warm, "node_modules", ".pnpm");
  for (const entry of await readdir(store)) {
    if (/^@[^+@]*$/.test(entry)) await rm(join(store, entry), { recursive: true, force: true });
  }
  for (const manifest of [join(lib, "package.json"), join(warm, "package.json")]) {
    const data = JSON.parse(await readFile(manifest, "utf8")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const deps = data[field] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (spec.includes("file:")) deps[name] = version;
      }
    }
    delete data["devDependencies"];
    await writeFile(manifest, `${JSON.stringify(data, null, 2)}\n`);
  }
}

/** Removes every directory under `dir` named `name`, without following links. */
async function removeDirectoriesNamed(dir: string, name: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.name === name) await rm(path, { recursive: true, force: true });
    else await removeDirectoriesNamed(path, name);
  }
}

/** Removes every file under `dir` whose name `match`es, without following links. */
async function removeEverywhere(dir: string, match: (name: string) => boolean): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && match(entry.name)) await rm(path, { force: true });
    else if (entry.isDirectory() && !entry.isSymbolicLink()) await removeEverywhere(path, match);
  }
}

/**
 * Fails on any regular file with more than one link: tar would write it as a hard-link entry,
 * which installers refuse, and it would share its bytes with something outside the bundle.
 */
async function checkNoHardLinks(root: string): Promise<void> {
  const { lstat } = await import("node:fs/promises");
  const linked: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (await lstat(path)).nlink > 1) linked.push(relative(root, path));
    }
  };
  await visit(root);
  if (linked.length > 0)
    fail(linked.slice(0, 50), `bundle: ${linked.length} files are hard links (deploy must copy)`);
}

/**
 * Fails when a link in the tree doesn't resolve to something inside it, and on Windows when one
 * names a file: setup makes each a junction, which can only name a directory (D153).
 */
async function checkLinks(root: string): Promise<void> {
  const { readlink, realpath } = await import("node:fs/promises");
  const broken: string[] = [];
  const realRoot = await realpath(root);
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path).catch(() => undefined);
        if (
          target === undefined ||
          !(target === realRoot || target.startsWith(`${realRoot}${sep}`))
        )
          broken.push(`${relative(root, path)} -> ${await readlink(path)}`);
        else if (WINDOWS && !(await stat(target)).isDirectory())
          broken.push(`${relative(root, path)} -> ${await readlink(path)} (a file)`);
      } else if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(root);
  if (broken.length > 0)
    fail(broken.slice(0, 50), `bundle: ${broken.length} links don't resolve inside it`);
}

/**
 * Fails when a text file in the tree names the build machine: its checkout, the build's output
 * directory, or pnpm's store or cache (each as given and as its real path). A third-party file
 * that is byte-identical to the same package's installed copy is upstream content (a source map or
 * workflow file a package's own CI wrote, `/home/runner/...` on GitHub's runners), not a leak of
 * this build, and passes; anything else that matches fails closed.
 */
function checkMachinePaths(root: string): void {
  const pnpmValue = (key: string): string => {
    const [program, argv] = commandFor(
      "pnpm",
      key === "store" ? ["store", "path"] : ["config", "get", key],
    );
    return spawnSync(program, argv, {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout.trim();
  };
  const candidates = [ROOT, out, pnpmValue("store"), pnpmValue("cache-dir")];
  const needles = [
    ...new Set(
      candidates
        .filter((path) => path.length > 1 && path !== "undefined")
        .flatMap((path) => [path, existsSync(path) ? realpathSync(path) : path])
        // Windows tools write a path with either separator.
        .flatMap((path) => (WINDOWS ? [path, path.replaceAll("\\", "/")] : [path])),
    ),
  ];
  const args = ["-rlIF", ...needles.flatMap((needle) => ["-e", needle]), root];
  const found = spawnSync("grep", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (found.status !== 0 && found.status !== 1)
    fail([`grep exited ${found.status}: ${found.stderr.trim()}`], "bundle");
  const flagged = found.status === 0 ? found.stdout.trim().split("\n") : [];
  const leaks = flagged.filter((path) => !upstreamCopy(root, path));
  if (leaks.length > 0) {
    fail(
      leaks.slice(0, 50),
      "bundle: files name the build machine's paths (checkout, output, pnpm store or cache)",
    );
  }
  if (flagged.length > 0)
    step(`${flagged.length} third-party files name a path only as their published copies do`);
  // Mostra's own Windows programs are binaries, which grep's -I skips: they are searched as bytes.
  if (WINDOWS) {
    const ours = ["mostra", "mostra-runtime", "mostra-setup", "mostra-win", "mostra-win-service"];
    const programs = ours.map((name) => join(root, "bin", `${name}.exe`));
    const patterns = needles.flatMap((needle) => ["-e", needle]);
    const binary = spawnSync("grep", ["-laF", ...patterns, ...programs], { encoding: "utf8" });
    if (binary.status === 0) {
      const named = binary.stdout.trim().split("\n");
      fail(named, "bundle: Mostra's Windows programs name the build machine's paths");
    }
    if (binary.status !== 1)
      fail([`grep exited ${binary.status}: ${binary.stderr.trim()}`], "bundle");
  }
}

/**
 * Whether `path` (a file in the staged tree) is byte-identical to the same file of the same
 * package version in the checkout's installed packages, found through pnpm's virtual store.
 */
function upstreamCopy(root: string, path: string): boolean {
  let dir = dirname(path);
  while (dir.startsWith(root) && dir !== root) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      let manifest: { name?: string; version?: string };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        return false;
      }
      if (!manifest.name || !manifest.version || manifest.name.startsWith("@mostra/")) return false;
      const inside = relative(dir, path);
      const store = join(ROOT, "node_modules", ".pnpm");
      const prefix = `${manifest.name.replace("/", "+")}@${manifest.version}`;
      const staged = readFileSync(path);
      for (const entry of existsSync(store) ? readdirSync(store) : []) {
        if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
        const original = join(store, entry, "node_modules", manifest.name, inside);
        if (existsSync(original) && readFileSync(original).equals(staged)) return true;
      }
      return false;
    }
    dir = dirname(dir);
  }
  return false;
}

async function main(): Promise<void> {
  const version = await releaseVersion();
  step(`Mostra ${version}`);
  if (!values["skip-build"]) {
    step("building the packages it carries");
    await run("pnpm", [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@mostra/bundle...",
      "--filter=@mostra/warm...",
    ]);
  }
  // Only now: on a fresh checkout the SDK and the protocol have no dist/ until the build above.
  const { bundlePlatform, describeTree } = await import("@mostra/sdk");
  const protocol = await import("@mostra/protocol");
  const platform = bundlePlatform();
  const top = protocol.bundleAssetName(version, platform).replace(/\.tar\.gz$/, "");
  step(`for ${platform}`);

  const stageParent = join(out, "stage");
  const stage = join(stageParent, top);
  await rm(stageParent, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const node = await nodeArchive(platform);
  step(`unpacking Node.js ${node.version}`);
  await mkdir(join(stage, "node"));
  // Windows' own tar (bsdtar) reads Node.js's zip; a Git or MSYS tar on the PATH can't.
  const tar = WINDOWS
    ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  const untar = spawnSync(
    tar,
    [WINDOWS ? "-xf" : "-xzf", node.file, "-C", join(stage, "node"), "--strip-components=1"],
    { encoding: "utf8" },
  );
  if (untar.status !== 0) fail([`tar: ${untar.stderr?.trim() || untar.error?.message}`], "bundle");
  if (!existsSync(join(stage, NODE_PATH)))
    fail([`${NODE_PATH} is missing from Node.js's archive.`], "bundle");

  step("deploying Mostra's packages (hoisted)");
  await run("pnpm", [
    "--filter",
    "@mostra/bundle",
    "deploy",
    "--prod",
    "--config.node-linker=hoisted",
    // Copies, never hard links into the store (pnpm's default on Linux): a bundle's files stand
    // alone, and an archive holds no hard-link entries, which installers refuse.
    "--config.package-import-method=copy",
    join(stage, "lib"),
  ]);
  step("deploying the warm set (isolated)");
  await run("pnpm", [
    "--filter",
    "@mostra/warm",
    "deploy",
    "--prod",
    "--config.package-import-method=copy",
    join(stage, "lib", "node_modules", "@mostra", "warm"),
  ]);

  // `@mostra/react` lives only in the warm set's own layout, which artifacts resolve.
  const warmModules = join(stage, "lib", "node_modules", "@mostra", "warm", "node_modules");
  step("removing what the deploys leave behind");
  await pruneDeploy(stage, version);
  for (const name of MOSTRA_PACKAGES) {
    const top = join(stage, "lib", "node_modules", name, "package.json");
    const inWarm = join(warmModules, name, "package.json");
    const file = existsSync(top) ? top : existsSync(inWarm) ? inWarm : undefined;
    if (file === undefined) fail([`${name} is missing from the bundle.`], "bundle");
    const manifest = JSON.parse(await readFile(file, "utf8")) as { version: string };
    if (manifest.version !== version)
      fail([`${name} in the bundle is ${manifest.version}, not ${version}.`], "bundle");
  }

  const entriesOf = {
    runtime: "lib/node_modules/@mostra/runtime/dist/bin.js",
    cli: "lib/node_modules/@mostra/cli/dist/bin.js",
    setup: "lib/node_modules/@mostra/sdk/dist/setup-main.js",
  };
  for (const entry of Object.values(entriesOf)) {
    if (!existsSync(join(stage, entry))) fail([`${entry} is missing from the bundle.`], "bundle");
  }
  await mkdir(join(stage, "bin"));
  if (WINDOWS) {
    // One launcher, three names: each runs the entry its name picks (crates/mostra-win,
    // src/win/launch.rs); beside them the helper and the login service's launcher (D150, D151).
    step("building the Windows launcher and helpers");
    const built = await windowsBinaries();
    for (const name of ["mostra", "mostra-runtime", "mostra-setup"])
      await copyFile(join(built, "mostra-launch.exe"), join(stage, "bin", `${name}.exe`));
    for (const name of ["mostra-win", "mostra-win-service"])
      await copyFile(join(built, `${name}.exe`), join(stage, "bin", `${name}.exe`));
    // Each runs as whoever starts it: without its embedded manifest's `asInvoker`, UAC's
    // installer detection refuses `mostra-setup.exe` to an ordinary user (D153).
    const unmanifested: string[] = [];
    for (const name of [
      "mostra",
      "mostra-runtime",
      "mostra-setup",
      "mostra-win",
      "mostra-win-service",
    ]) {
      const bytes = await readFile(join(stage, "bin", `${name}.exe`));
      if (!bytes.includes('requestedExecutionLevel level="asInvoker"')) unmanifested.push(name);
    }
    if (unmanifested.length > 0)
      fail(
        unmanifested.map(
          (name) => `bin/${name}.exe has no asInvoker manifest (crates/mostra-win/build.rs).`,
        ),
        "bundle",
      );
    await writeFile(join(stage, "bin", "THIRD-PARTY-LICENSES.txt"), rustLicenses());
  } else {
    for (const [name, entry] of [
      ["mostra", entriesOf.cli],
      ["mostra-runtime", entriesOf.runtime],
      ["mostra-setup", entriesOf.setup],
    ] as const) {
      await writeFile(join(stage, "bin", name), launcher(entry));
      await chmod(join(stage, "bin", name), 0o755);
    }
  }
  await copyFile(fromRoot("LICENSE"), join(stage, "LICENSE"));
  await copyFile(fromRoot("NOTICE"), join(stage, "NOTICE"));

  step("pinning the verify browser");
  const playwright = "lib/node_modules/playwright-core";
  const registry = JSON.parse(await readFile(join(stage, playwright, "browsers.json"), "utf8")) as {
    browsers: { name: string; revision: string; browserVersion: string }[];
  };
  const shell = registry.browsers.find((browser) => browser.name === "chromium-headless-shell");
  if (!shell) fail(["playwright-core names no chromium-headless-shell."], "bundle");
  const browsers = join(out, "browsers");
  await rm(browsers, { recursive: true, force: true });
  const install = await runStreaming(
    join(stage, NODE_PATH),
    [join(stage, playwright, "cli.js"), "install", "chromium-headless-shell"],
    { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } },
  );
  if (install !== 0) fail([`Playwright's browser install exited ${install}.`], "bundle");
  const shellDir = `chromium_headless_shell-${shell.revision}`;
  const pinned = await describeTree(
    browsers,
    (path) =>
      !(path === shellDir || path.startsWith(`${shellDir}/`)) ||
      path === `${shellDir}/INSTALLATION_COMPLETE` ||
      path === `${shellDir}/DEPENDENCIES_VALIDATED`,
  );
  if (pinned.links.length > 0 || pinned.files.length === 0)
    fail(["The browser's install isn't the plain files a pin can hold."], "bundle");

  step("checking links and paths");
  await checkLinks(stage);
  await checkNoHardLinks(stage);
  checkMachinePaths(stage);

  step("listing every file");
  const files = await describeTree(
    stage,
    (path) => path === "bundle.json" || path === "files.json",
  );
  await writeFile(join(stage, "files.json"), `${JSON.stringify(files)}\n`);
  const info = protocol.BundleInfo.parse({
    schemaVersion: 1,
    name: protocol.BUNDLE_NAME,
    version,
    platform,
    node: { version: node.version, path: NODE_PATH },
    entries: entriesOf,
    files: { path: "files.json", sha256: await sha256(join(stage, "files.json")) },
    browser: {
      name: "chromium-headless-shell",
      revision: shell.revision,
      browserVersion: shell.browserVersion,
      installer: `${playwright}/cli.js`,
      files: pinned.files,
    },
    source: {
      repository: "https://github.com/mostra-dev/mostra",
      commit: git(["rev-parse", "HEAD"]) ?? "unknown",
    },
  });
  await writeFile(join(stage, "bundle.json"), `${JSON.stringify(info, null, 2)}\n`);

  step("packing");
  const epoch = Number(process.env["SOURCE_DATE_EPOCH"] ?? git(["log", "-1", "--format=%ct"]) ?? 0);
  const archiveName = protocol.bundleAssetName(version, platform);
  const archive = join(out, archiveName);
  await c(
    {
      gzip: { level: 9 },
      file: archive,
      cwd: stageParent,
      portable: true,
      noDirRecurse: true,
      mtime: new Date(epoch * 1000),
    },
    await entries(stageParent, stage),
  );
  const unpackedSize = files.files.reduce((sum, file) => sum + file.size, 0);
  const asset = protocol.BundleAsset.parse({
    file: archiveName,
    sha256: await sha256(archive),
    size: (await stat(archive)).size,
    unpackedSize,
  });
  await writeFile(
    join(out, archiveName.replace(/\.tar\.gz$/, ".json")),
    `${JSON.stringify(asset, null, 2)}\n`,
  );
  const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(0)} MB`;
  step(
    `${archiveName}: ${mb(asset.size)} (${mb(unpackedSize)} unpacked, ${files.files.length} files, ${files.links.length} links), SHA-256 ${asset.sha256}`,
  );
}

await main();
