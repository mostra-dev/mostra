#!/usr/bin/env node
/**
 * The GitHub release of a Mostra version, and what the release workflow does about it (EN-05,
 * D142 item 9). The published release is the one source of truth for a version's runtime bundles:
 * npm's `@mostra/sdk` pins exactly its assets, and neither can be changed once published (GitHub's
 * immutable releases, npm's immutable versions). So the release is published, and checked from
 * outside, before anything goes to npm, and a run that finds the release already published only
 * finishes what npm lacks from the release's own assets (Opus review findings 1 and 2).
 *
 *   node packages/bundle/scripts/github-release.ts state --event <name> --ref <ref>
 *   node packages/bundle/scripts/github-release.ts fetch --platform <p> --out <dir>
 *   node packages/bundle/scripts/github-release.ts publish --assets <dir> --notes <file> --target <sha>
 *   node packages/bundle/scripts/github-release.ts verify --assets <dir>
 *
 * - `state` prints `version=`, `mode=` and `publish=` lines for `$GITHUB_OUTPUT`. The mode is
 *   `none` (a pull request, the unreleased 0.0.0, changesets pending, or released in full),
 *   `fresh` (no published release and nothing on npm: build, release, publish) or `finish` (the
 *   release is published and npm lacks part of the version: its assets, not a new build). A
 *   version on npm with no published release can't happen in this order and fails closed. Under
 *   `finish` the workflow packs from the release's own tag, so every package npm still lacks is
 *   packed from the very source the published ones were (pnpm's tarballs are reproducible: fixed
 *   times, no owners), and those already on npm compare equal.
 * - `fetch` downloads one platform's archive and asset record from the published release and
 *   checks the archive against both.
 * - `publish` makes the release: a draft (created at `--target` if missing) whose assets are made
 *   exactly the local ones, then published. A release already published must hold exactly these
 *   assets (a re-run of the same workflow run), else this fails.
 * - `verify` checks the published release holds every local asset with the same SHA-256 and that
 *   each archive downloads anonymously at its pinned URL with its size.
 *
 * Only `node:` imports: this runs in the job that holds the release's OIDC token.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO = "mostra-dev/mostra";
const { values, positionals } = parseArgs({
  options: {
    event: { type: "string" },
    ref: { type: "string" },
    platform: { type: "string" },
    out: { type: "string" },
    assets: { type: "string" },
    notes: { type: "string" },
    target: { type: "string" },
  },
  allowPositionals: true,
  strict: true,
});
const command = positionals[0];

function fail(message: string): never {
  console.error(`✗ github release ${command ?? ""}: ${message}`);
  process.exit(1);
}

/** Runs a command; its stdout, or `undefined` when it fails and `allowFailure` is set. */
function run(cmd: string, args: readonly string[], allowFailure = false): string | undefined {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status === 0) return result.stdout;
  if (allowFailure) return undefined;
  fail(`${cmd} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
}

const version = (
  JSON.parse(readFileSync(join(ROOT, "packages", "sdk", "package.json"), "utf8")) as {
    version: string;
  }
).version;
const tag = `v${version}`;
const group = (
  JSON.parse(readFileSync(join(ROOT, ".changeset", "config.json"), "utf8")) as {
    fixed: string[][];
  }
).fixed[0] as string[];

/** A release as GitHub's API reports it. */
interface Release {
  readonly id: number;
  readonly draft: boolean;
  readonly tag_name: string;
  readonly assets: readonly { id: number; name: string; digest?: string; size: number }[];
}

/** The release of `tag`, drafts included (they have no tag yet, so they're found by name). */
function release(): Release | undefined {
  const out = run("gh", ["api", "--paginate", "--slurp", `repos/${REPO}/releases?per_page=100`]);
  const pages = JSON.parse(out as string) as Release[][];
  return pages.flat().find((candidate) => candidate.tag_name === tag);
}

/** Whether the tag exists: GitHub creates it when the release is published, never for a draft. */
function tagged(): boolean {
  return (
    run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], true) !==
    undefined
  );
}

/** The group's packages npm already has at this version. */
function onNpm(): string[] {
  return group.filter((name) => {
    const out = run("npm", ["view", `${name}@${version}`, "version", "--json"], true);
    return out !== undefined && out.trim() !== "" && JSON.parse(out) === version;
  });
}

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** The release's files in `dir`: every archive and asset record of this version, and SHA256SUMS. */
function localAssets(dir: string): Map<string, string> {
  const files = readdirSync(dir).filter(
    (name) =>
      name === "SHA256SUMS" ||
      (name.startsWith(`mostra-${version}-`) && /\.(tar\.gz|json)$/.test(name)),
  );
  if (!files.includes("SHA256SUMS")) fail(`${dir} has no SHA256SUMS.`);
  if (files.filter((name) => name.endsWith(".tar.gz")).length === 0)
    fail(`${dir} has no archives.`);
  return new Map(files.map((name) => [name, sha256(join(dir, name))]));
}

/** Every difference between the release's assets and the local files. */
function assetProblems(published: Release, local: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, digest] of local) {
    const asset = published.assets.find((candidate) => candidate.name === name);
    if (!asset) problems.push(`${name} is missing`);
    else if (asset.digest !== `sha256:${digest}`)
      problems.push(`${name} is ${asset.digest ?? "without a digest"}, not sha256:${digest}`);
  }
  for (const asset of published.assets)
    if (!local.has(asset.name)) problems.push(`${asset.name} isn't one of this run's assets`);
  return problems;
}

function state(): void {
  const pending = readdirSync(join(ROOT, ".changeset")).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  ).length;
  const lines = (mode: string, why: string): void => {
    console.log(`version=${version}`);
    console.log(`mode=${mode}`);
    console.log(`publish=${mode === "none" ? "false" : "true"}`);
    console.error(`release state of ${version}: ${mode} (${why})`);
  };
  const mode = ((): [string, string] => {
    if (values.event !== "push" || values.ref !== "refs/heads/main")
      return ["none", "only a push to main publishes"];
    if (version === "0.0.0") return ["none", "0.0.0 is the unreleased version"];
    if (pending > 0) return ["none", `${pending} changesets pending`];
    const published = tagged();
    const have = onNpm();
    if (published && have.length === group.length) return ["none", "released in full"];
    if (published)
      return ["finish", `npm lacks ${group.filter((name) => !have.includes(name)).join(", ")}`];
    if (have.length > 0)
      fail(
        `npm has ${have.join(", ")} at ${version} but the GitHub release ${tag} isn't published; this workflow never publishes npm first, so look before anything else is published.`,
      );
    return ["fresh", "nothing published yet"];
  })();
  lines(...mode);
}

function fetchAssets(): void {
  if (!values.platform || !values.out) fail("--platform and --out are required.");
  const out = resolve(values.out);
  const base = `mostra-${version}-${values.platform}`;
  run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    REPO,
    "--dir",
    out,
    "--pattern",
    `${base}.tar.gz`,
    "--pattern",
    `${base}.json`,
  ]);
  const record = JSON.parse(readFileSync(join(out, `${base}.json`), "utf8")) as {
    sha256: string;
  };
  const digest = sha256(join(out, `${base}.tar.gz`));
  if (digest !== record.sha256)
    fail(`${base}.tar.gz is ${digest}, not ${record.sha256} as its record says.`);
  const published = release();
  const asset = published?.assets.find((candidate) => candidate.name === `${base}.tar.gz`);
  if (asset?.digest !== `sha256:${digest}`)
    fail(`${base}.tar.gz on the release is ${asset?.digest}, not sha256:${digest}.`);
  console.log(`✓ fetched ${base} from the published release ${tag}: ${digest}`);
}

function publish(): void {
  if (!values.assets || !values.notes || !values.target)
    fail("--assets, --notes and --target are required.");
  const dir = resolve(values.assets);
  const local = localAssets(dir);
  let current = release();
  if (current && !current.draft) {
    // A re-run of the run that published it: the same assets, or the pins would name others.
    const problems = assetProblems(current, local);
    if (problems.length > 0) fail(`${tag} is published with other assets: ${problems.join("; ")}.`);
    console.log(`✓ ${tag} is already published with exactly these assets`);
    return;
  }
  if (!current) {
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      REPO,
      "--draft",
      "--target",
      values.target,
      "--title",
      `Mostra ${version}`,
      "--notes-file",
      resolve(values.notes),
    ]);
  }
  // A draft has no tag and nothing published names its assets yet, so they may be replaced: a
  // run that failed while uploading left some behind.
  run("gh", [
    "release",
    "upload",
    tag,
    "--repo",
    REPO,
    "--clobber",
    ...[...local.keys()].map((name) => join(dir, name)),
  ]);
  current = release();
  for (const asset of current?.assets ?? [])
    if (!local.has(asset.name))
      run("gh", ["api", "-X", "DELETE", `repos/${REPO}/releases/assets/${asset.id}`]);
  current = release();
  if (!current) fail(`${tag} vanished while its assets were uploaded.`);
  const problems = assetProblems(current, local);
  if (problems.length > 0)
    fail(`the draft ${tag} doesn't hold this run's assets: ${problems.join("; ")}.`);
  run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false", "--latest"]);
  console.log(`✓ published ${tag} with ${local.size} assets`);
}

async function verify(): Promise<void> {
  if (!values.assets) fail("--assets is required.");
  const dir = resolve(values.assets);
  const local = localAssets(dir);
  if (!tagged()) fail(`${tag} isn't published (no tag).`);
  const current = release();
  if (!current || current.draft) fail(`${tag} isn't published.`);
  const problems = assetProblems(current, local);
  if (problems.length > 0) fail(`${tag} doesn't hold this run's assets: ${problems.join("; ")}.`);
  // What an installer does, without credentials: each pinned URL answers with the archive.
  for (const name of local.keys()) {
    if (!name.endsWith(".tar.gz")) continue;
    const url = `https://github.com/${REPO}/releases/download/${tag}/${name}`;
    const size = current.assets.find((asset) => asset.name === name)?.size;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 5; attempt++) {
      response = await fetch(url, { method: "HEAD", redirect: "follow" }).catch(() => undefined);
      if (response?.ok) break;
      await new Promise((done) => setTimeout(done, attempt * 2000));
    }
    if (!response?.ok) fail(`${url} doesn't download (${response?.status ?? "no answer"}).`);
    const length = Number(response.headers.get("content-length"));
    if (length !== size) fail(`${url} answers ${length} bytes, not ${size}.`);
    console.log(`✓ ${url}: ${length} bytes`);
  }
  console.log(`✓ ${tag} is published with exactly this run's ${local.size} assets`);
}

if (command === "state") state();
else if (command === "fetch") fetchAssets();
else if (command === "publish") publish();
else if (command === "verify") await verify();
else fail("usage: github-release.ts state|fetch|publish|verify …");
