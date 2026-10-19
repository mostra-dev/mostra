#!/usr/bin/env node
/**
 * Publishes the release's npm packages (EN-05, D67): every package of the fixed release group, in
 * dependency order, each packed by pnpm (which writes real versions for `workspace:` and
 * `catalog:` specifiers) and published by npm, whose CLI exchanges the workflow's OIDC token for
 * a short-lived publish token (npm trusted publishing) and adds provenance.
 *
 *   node packages/bundle/scripts/publish-npm.ts pack --out <dir>
 *   node packages/bundle/scripts/publish-npm.ts publish --from <dir> [--dry-run]
 *
 * `pack` packs every member and checks every tarball: the fixed group's one version, nothing of
 * `ee/` (D118), `@mostra/sdk` carrying `dist/bundles.json` for that version, and no file a package
 * must never ship (`.env`, keys). `publish` publishes exactly those tarballs, the ones the smoke
 * tests installed, in dependency order; a version already on npm is skipped, so a release that
 * failed half-way finishes when the workflow runs again. `--dry-run` runs `npm publish --dry-run`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { values, positionals } = parseArgs({
  options: {
    out: { type: "string" },
    from: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});
const dryRun = values["dry-run"];
const mode = positionals[0];

function fail(message: string): never {
  console.error(`✗ npm ${mode ?? "publish"}: ${message}`);
  process.exit(1);
}

interface Member {
  readonly name: string;
  readonly dir: string;
  readonly version: string;
  readonly deps: readonly string[];
}

/** The fixed release group, from `.changeset/config.json`, with each package's manifest. */
function members(): Member[] {
  const config = JSON.parse(readFileSync(join(ROOT, ".changeset", "config.json"), "utf8")) as {
    fixed: string[][];
  };
  const names = config.fixed[0] ?? fail("no fixed release group.");
  return names.map((name) => {
    const dir = join(ROOT, "packages", name.startsWith("@mostra/") ? name.slice(8) : name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      private?: boolean;
      dependencies?: Record<string, string>;
    };
    if (manifest.name !== name) fail(`${dir} holds ${manifest.name}, not ${name}.`);
    if (manifest.private) fail(`${name} is private.`);
    return {
      name,
      dir,
      version: manifest.version,
      deps: Object.keys(manifest.dependencies ?? {}).filter((dep) => names.includes(dep)),
    };
  });
}

/** `group` ordered so every package comes after the group members it depends on. */
function dependencyOrder(group: readonly Member[]): Member[] {
  const ordered: Member[] = [];
  const placed = new Set<string>();
  while (ordered.length < group.length) {
    const next = group.find((m) => !placed.has(m.name) && m.deps.every((dep) => placed.has(dep)));
    if (!next) fail("the release group's dependencies form a cycle.");
    ordered.push(next);
    placed.add(next.name);
  }
  return ordered;
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} (in ${cwd}) exited ${result.status}:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/** Files a published package must never carry. */
const NEVER = /(^|\/)(\.env(\..*)?|\.npmrc|id_rsa|.*\.pem|.*\.key)$/;

/** The file `pnpm pack` writes for a package: `@mostra/cli` 0.1.0 is `mostra-cli-0.1.0.tgz`. */
const tarballName = (name: string, version: string): string =>
  `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;

const group = dependencyOrder(members());
const versions = new Set(group.map((member) => member.version));
if (versions.size !== 1)
  fail(`the release group has several versions: ${[...versions].join(", ")}.`);
const version = [...versions][0] as string;

if (mode === "pack") pack();
else if (mode === "publish") publish();
else fail("usage: publish-npm.ts pack --out <dir> | publish --from <dir> [--dry-run]");

function pack(): void {
  if (!values.out) fail("--out <dir> is required.");
  const out = resolve(values.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const member of group) {
    const packed = JSON.parse(
      run("pnpm", ["pack", "--json", "--pack-destination", out], member.dir),
    ) as {
      filename: string;
      files: { path: string }[];
    };
    const paths = packed.files.map((file) => file.path);
    for (const path of paths) if (NEVER.test(path)) fail(`${member.name} would publish ${path}.`);
    run("node", [join(ROOT, "tools", "bin", "mostra-tools.ts"), "pack-check"], member.dir);
    if (member.name === "@mostra/sdk") {
      if (!paths.includes("dist/bundles.json"))
        fail("@mostra/sdk would publish without dist/bundles.json (run pins.ts after its build).");
      const pins = JSON.parse(readFileSync(join(member.dir, "dist", "bundles.json"), "utf8")) as {
        version: string;
      };
      if (pins.version !== version) fail(`dist/bundles.json pins ${pins.version}, not ${version}.`);
    }
    const file = join(out, tarballName(member.name, version));
    if (!existsSync(file)) fail(`pnpm pack wrote no ${file}.`);
    console.log(`packed ${member.name}@${version}: ${paths.length} files`);
  }
  console.log(`✓ npm pack: ${group.length} packages at ${version} in ${out}`);
}

function publish(): void {
  if (!values.from) fail("--from <dir> is required.");
  const from = resolve(values.from);
  if (!dryRun && version === "0.0.0")
    fail("0.0.0 is the unreleased version; run changeset version first.");
  for (const member of group) {
    const file = join(from, tarballName(member.name, version));
    if (!existsSync(file)) fail(`${file} is missing: run pack first.`);
    const existing = spawnSync("npm", ["view", `${member.name}@${version}`, "version"], {
      encoding: "utf8",
    });
    if (existing.status === 0 && existing.stdout.trim() === version) {
      console.log(`skipped ${member.name}@${version}: already on npm`);
      continue;
    }
    // Provenance is made only inside a supported CI run (trusted publishing adds it there anyway);
    // a dry run elsewhere would refuse the flag.
    const args = [
      "publish",
      file,
      "--access",
      "public",
      ...(dryRun ? ["--dry-run"] : ["--provenance"]),
    ];
    run("npm", args, ROOT);
    console.log(`${dryRun ? "would publish" : "published"} ${member.name}@${version}`);
  }
  console.log(`✓ npm publish: ${group.length} packages at ${version}${dryRun ? " (dry run)" : ""}`);
}
