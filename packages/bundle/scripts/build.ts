#!/usr/bin/env node
/**
 * The runtime bundle assembler (RT-01, D142): builds this platform's bundle from the workspace.
 *
 *   node packages/bundle/scripts/build.ts --out <dir> [--skip-build] [--node-archive <file>]
 *
 * 1. builds the packages the bundle carries (Turborepo);
 * 2. unpacks the official Node.js distribution, checked against `packages/bundle/node.json`;
 * 3. deploys `@mostra/bundle`'s production dependencies, hoisted, as `lib/node_modules`, and the
 *    warm set apart, isolated, as `lib/node_modules/@mostra/warm`;
 * 4. writes the launchers, `LICENSE` and `NOTICE`;
 * 5. fetches the verify browser once to pin its files (it never enters the archive);
 * 6. writes `files.json` (the SDK's own `describeTree`) and `bundle.json`;
 * 7. packs `mostra-<version>-<platform>.tar.gz` with sorted entries, no owners and one fixed time,
 *    and writes `mostra-<version>-<platform>.json`, its asset record (size, SHA-256, unpacked size).
 *
 * A bundle is built on the platform it is for: the native packages and the browser are this
 * machine's. Release CI runs it on one runner per platform (REPO_STANDARDS §9).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { c } from "tar";

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

/** Runs a command with its output passed through, resolving with its exit code. */
function runStreaming(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command, args, {
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
  if (!expected) fail([`packages/bundle/node.json pins no Node.js for ${platform}.`], "bundle");
  const name = `node-v${pins.version}-${platform}.tar.gz`;
  const file = values["node-archive"] ?? fromRoot(".cache", "bundle", name);
  if (!existsSync(file)) {
    step(`downloading ${name}`);
    await mkdir(fromRoot(".cache", "bundle"), { recursive: true });
    const response = await fetch(`https://nodejs.org/dist/v${pins.version}/${name}`);
    if (!response.ok || !response.body)
      fail([`nodejs.org answered ${response.status} for ${name}.`], "bundle");
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  const actual = await sha256(file);
  if (actual !== expected) {
    await rm(file, { force: true });
    fail([`${name} has SHA-256 ${actual}, not the pinned ${expected}.`], "bundle");
  }
  return { file, version: pins.version };
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
      found.push(relative(base, path));
      if (child.isDirectory()) await visit(path);
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

/** Fails when a link in the tree doesn't resolve to something inside it. */
async function checkLinks(root: string): Promise<void> {
  const { readlink, realpath } = await import("node:fs/promises");
  const broken: string[] = [];
  const realRoot = await realpath(root);
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path).catch(() => undefined);
        if (target === undefined || !(target === realRoot || target.startsWith(`${realRoot}/`)))
          broken.push(`${relative(root, path)} -> ${await readlink(path)}`);
      } else if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(root);
  if (broken.length > 0)
    fail(broken.slice(0, 50), `bundle: ${broken.length} links don't resolve inside it`);
}

/** Fails when a text file in the tree names the build machine's checkout, home or pnpm store. */
function checkMachinePaths(root: string): void {
  const store = spawnSync("pnpm", ["store", "path"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const home = process.env["HOME"] ?? "";
  const needles = [ROOT, store, home].filter((needle) => needle.length > 1);
  const args = ["-rlIF", ...needles.flatMap((needle) => ["-e", needle]), root];
  const found = spawnSync("grep", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (found.status === 0) {
    fail(
      found.stdout.trim().split("\n").slice(0, 50),
      "bundle: files name the build machine's paths (checkout, home or pnpm store)",
    );
  }
  if (found.status !== 1) fail([`grep exited ${found.status}: ${found.stderr.trim()}`], "bundle");
}

async function main(): Promise<void> {
  const { bundlePlatform, describeTree } = await import("@mostra/sdk");
  const protocol = await import("@mostra/protocol");
  const platform = bundlePlatform();
  const version = await releaseVersion();
  const top = protocol.bundleAssetName(version, platform).replace(/\.tar\.gz$/, "");
  step(`Mostra ${version} for ${platform}`);

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

  const stageParent = join(out, "stage");
  const stage = join(stageParent, top);
  await rm(stageParent, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const node = await nodeArchive(platform);
  step(`unpacking Node.js ${node.version}`);
  await mkdir(join(stage, "node"));
  const untar = spawnSync(
    "tar",
    ["-xzf", node.file, "-C", join(stage, "node"), "--strip-components=1"],
    {
      encoding: "utf8",
    },
  );
  if (untar.status !== 0) fail([`tar: ${untar.stderr.trim()}`], "bundle");

  step("deploying Mostra's packages (hoisted)");
  await run("pnpm", [
    "--filter",
    "@mostra/bundle",
    "deploy",
    "--prod",
    "--config.node-linker=hoisted",
    join(stage, "lib"),
  ]);
  step("deploying the warm set (isolated)");
  await run("pnpm", [
    "--filter",
    "@mostra/warm",
    "deploy",
    "--prod",
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
  for (const [name, entry] of [
    ["mostra", entriesOf.cli],
    ["mostra-runtime", entriesOf.runtime],
    ["mostra-setup", entriesOf.setup],
  ] as const) {
    await writeFile(join(stage, "bin", name), launcher(entry));
    await chmod(join(stage, "bin", name), 0o755);
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
    join(stage, "node", "bin", "node"),
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
    node: { version: node.version, path: "node/bin/node" },
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
