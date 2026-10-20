#!/usr/bin/env node
/**
 * The release's bundle pins (RT-01): from the four platforms' asset records, writes
 *
 * - `packages/sdk/dist/bundles.json`, the `BundlePins` the published `@mostra/sdk` ships, which
 *   the SDK, the CLI's bootstrap and `create-mostra` install from (hash-pinned: an archive whose
 *   size or SHA-256 differs is refused);
 * - `<assets>/SHA256SUMS`, the same digests in `sha256sum`'s format, for people and hosts that
 *   download an archive by hand (`sha256sum -c` / `shasum -a 256 -c`).
 *
 *   node packages/bundle/scripts/pins.ts --assets <dir> [--release <base URL>]
 *
 * Every supported platform must have exactly one record at the release's version. The release
 * base defaults to the GitHub release of tag `v<version>`. Run after the SDK's build, which clears
 * `dist/`.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BUNDLE_PLATFORMS,
  BundleAsset,
  BundlePins,
  type BundlePlatform,
  bundleAssetName,
} from "@mostra/protocol";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { values } = parseArgs({
  options: { assets: { type: "string" }, release: { type: "string" } },
  strict: true,
});

function fail(message: string): never {
  console.error(`✗ bundle pins: ${message}`);
  process.exit(1);
}

if (!values.assets) fail("--assets <dir> is required.");
const assets = resolve(values.assets);
const version = (
  JSON.parse(readFileSync(join(ROOT, "packages", "sdk", "package.json"), "utf8")) as {
    version: string;
  }
).version;
const release =
  values.release ?? `https://github.com/mostra-dev/mostra/releases/download/v${version}`;

const records = new Map<BundlePlatform, BundleAsset>();
for (const file of readdirSync(assets).filter((name) => /^mostra-.+\.json$/.test(name))) {
  const asset = BundleAsset.parse(JSON.parse(readFileSync(join(assets, file), "utf8")));
  const platform = BUNDLE_PLATFORMS.find(
    (candidate) => asset.file === bundleAssetName(version, candidate),
  );
  if (platform === undefined)
    fail(`${file} names ${asset.file}, not a ${version} bundle of a supported platform.`);
  if (records.has(platform)) fail(`two records for ${platform}.`);
  records.set(platform, asset);
}
const missing = BUNDLE_PLATFORMS.filter((platform) => !records.has(platform));
if (missing.length > 0) fail(`no bundle for ${missing.join(", ")}.`);

const pins = BundlePins.parse({
  schemaVersion: 1,
  version,
  release,
  assets: Object.fromEntries(BUNDLE_PLATFORMS.map((platform) => [platform, records.get(platform)])),
});
const out = join(ROOT, "packages", "sdk", "dist", "bundles.json");
writeFileSync(out, `${JSON.stringify(pins, null, 2)}\n`);
const sums = BUNDLE_PLATFORMS.map((platform) => {
  const asset = records.get(platform) as BundleAsset;
  return `${asset.sha256}  ${asset.file}`;
});
writeFileSync(join(assets, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`✓ bundle pins for Mostra ${version}: ${out}, ${join(assets, "SHA256SUMS")}`);
for (const line of sums) console.log(`  ${line}`);
