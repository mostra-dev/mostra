#!/usr/bin/env node
/**
 * The crates a release publishes to crates.io (D67, D143), and what each needs:
 *
 *   node tools/release/crates.ts plan --version <v>
 *
 * prints `publish=<names>` (crates whose version crates.io lacks and which exist there already,
 * so trusted publishing is configured) and `first=<names>` (crates crates.io doesn't have at all:
 * a crate's first release needs one token, `tools/release/crates-setup.sh`, before its trusted
 * publisher can be configured, VERIFIED_FACTS WP-11). A crate whose version crates.io already has
 * is skipped: crates.io never replaces a version, and a release publishes from its own tag.
 *
 * Node.js built-ins only: the release's publish job runs it (repo lint checks).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const USER_AGENT = "mostra-release (https://github.com/mostra-dev/mostra)";

/** A crate of the workspace that publishes, with its version. */
export interface PublishableCrate {
  readonly name: string;
  readonly version: string;
}

/** The workspace's publishable crates (`publish` not `false`), from `cargo metadata`. */
export function publishableCrates(root: string = ROOT): PublishableCrate[] {
  const result = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed: ${result.stderr}`);
  const metadata = JSON.parse(result.stdout) as {
    packages: { name: string; version: string; publish: string[] | null }[];
  };
  return metadata.packages
    .filter((pkg) => !(Array.isArray(pkg.publish) && pkg.publish.length === 0))
    .map((pkg) => ({ name: pkg.name, version: pkg.version }));
}

/** What crates.io holds of a crate: nothing, the crate without this version, or this version. */
export type RegistryState = "absent" | "without-version" | "has-version";

/** Asks crates.io for `name` and `version`. */
export async function registryState(name: string, version: string): Promise<RegistryState> {
  const crate = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (crate.status === 404) return "absent";
  if (!crate.ok) throw new Error(`crates.io answered ${crate.status} for ${name}`);
  const found = await fetch(
    `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { "user-agent": USER_AGENT } },
  );
  if (found.status === 404) return "without-version";
  if (!found.ok) throw new Error(`crates.io answered ${found.status} for ${name} ${version}`);
  return "has-version";
}

/** Splits the crates into those to publish now and those whose first release waits for a token. */
export function plan(
  crates: readonly PublishableCrate[],
  states: ReadonlyMap<string, RegistryState>,
): { publish: string[]; first: string[] } {
  return {
    publish: crates
      .filter((crate) => states.get(crate.name) === "without-version")
      .map((c) => c.name),
    first: crates.filter((crate) => states.get(crate.name) === "absent").map((c) => c.name),
  };
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { version: { type: "string" } },
  });
  if (positionals[0] !== "plan" || !values.version) {
    console.error("usage: crates.ts plan --version <version>");
    process.exit(2);
  }
  const crates = publishableCrates();
  for (const crate of crates) {
    if (crate.version !== values.version) {
      console.error(`✗ ${crate.name} is at ${crate.version}, the release at ${values.version}.`);
      process.exit(1);
    }
  }
  const states = new Map<string, RegistryState>();
  for (const crate of crates)
    states.set(crate.name, await registryState(crate.name, crate.version));
  const decided = plan(crates, states);
  console.log(`publish=${decided.publish.join(" ")}`);
  console.log(`first=${decided.first.join(" ")}`);
}
