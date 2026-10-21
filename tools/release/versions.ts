/**
 * One version for the release group and its crates (D142 item 7, D143), and the version a pull
 * request's release rehearsal uses.
 *
 *   node tools/release/versions.ts next       the version the pending changesets make
 *   node tools/release/versions.ts plan       `rehearse=` and, when rehearsing, `version=` lines
 *   node tools/release/versions.ts rehearse   sets that version in the working tree (CI only)
 *   node tools/release/versions.ts sync       sets the publishable crates to the group's version
 *   node tools/release/versions.ts check      fails when a crate's version isn't the group's
 *
 * A pull request (or `main` before its version pull request) carries changesets for a version
 * npm doesn't have yet, while its package.json files still name the last release, which npm
 * refuses to publish over even in a dry run. So the rehearsal packs, builds and dry-runs the next
 * version: `rehearse` writes it into the runner's checkout, never into a commit. `sync` runs
 * after `pnpm changeset version` in the version pull request (docs/agents/release.md), since
 * Changesets knows nothing of Cargo. Node.js built-ins only: the release jobs run it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A semver bump. */
type Bump = "major" | "minor" | "patch";

const RANK: Readonly<Record<Bump, number>> = { patch: 0, minor: 1, major: 2 };

/** The fixed release group (`.changeset/config.json`). */
export function group(root: string = ROOT): string[] {
  const config = JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8")) as {
    fixed: string[][];
  };
  return config.fixed[0] ?? [];
}

/** Each workspace package's manifest path, by name. */
function manifests(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of readdirSync(join(root, "packages"))) {
    const path = join(root, "packages", dir, "package.json");
    try {
      const name = (JSON.parse(readFileSync(path, "utf8")) as { name: string }).name;
      out.set(name, path);
    } catch {
      // not a package
    }
  }
  return out;
}

/** The group's current version: the SDK's (one version for the whole group). */
export function current(root: string = ROOT): string {
  const path = manifests(root).get("@mostra/sdk");
  if (path === undefined) throw new Error("no @mostra/sdk in packages/");
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

/** The highest bump the pending changesets ask of the group's packages, if any. */
export function pendingBump(root: string = ROOT): Bump | undefined {
  const members = new Set(group(root));
  let highest: Bump | undefined;
  const dir = join(root, ".changeset");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const text = readFileSync(join(dir, name), "utf8");
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    for (const line of front.split("\n")) {
      const match = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
      if (!match?.[1] || !members.has(match[1])) continue;
      const bump = match[2] as Bump;
      if (highest === undefined || RANK[bump] > RANK[highest]) highest = bump;
    }
  }
  return highest;
}

/** `version` bumped by `bump`, as Changesets bumps it. */
export function bumped(version: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`${version} isn't a release version`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The version the pending changesets make, or the current one without any. */
export function next(root: string = ROOT): string {
  const bump = pendingBump(root);
  return bump === undefined ? current(root) : bumped(current(root), bump);
}

/** The crates that publish (`publish` not `false`), and the ones that are reserved. */
export function crates(root: string = ROOT): { name: string; path: string; publish: boolean }[] {
  const out: { name: string; path: string; publish: boolean }[] = [];
  for (const dir of readdirSync(join(root, "crates"))) {
    const path = join(root, "crates", dir, "Cargo.toml");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const name = /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    if (!name) continue;
    out.push({ name, path, publish: !/^publish\s*=\s*false/m.test(text) });
  }
  return out;
}

/** The crates that follow the group's version: the host crate, published or not yet. */
const VERSIONED_CRATES = new Set(["mostra-host"]);

function setCrateVersion(root: string, name: string, path: string, version: string): void {
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`));
  const lock = join(root, "Cargo.lock");
  const locked = readFileSync(lock, "utf8");
  writeFileSync(
    lock,
    locked.replace(
      new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = )"[^"]*"`),
      `$1"${version}"`,
    ),
  );
}

/** Sets every group package and versioned crate to `version`. */
export function apply(version: string, root: string = ROOT): void {
  const members = new Set(group(root));
  for (const [name, path] of manifests(root)) {
    if (!members.has(name)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { version: string };
    manifest.version = version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const crate of crates(root)) {
    if (VERSIONED_CRATES.has(crate.name)) setCrateVersion(root, crate.name, crate.path, version);
  }
}

/** The versioned crates whose version isn't the group's. */
export function crateProblems(root: string = ROOT): string[] {
  const version = current(root);
  return crates(root)
    .filter((crate) => VERSIONED_CRATES.has(crate.name))
    .flatMap((crate) => {
      const own = /^version\s*=\s*"([^"]*)"/m.exec(readFileSync(crate.path, "utf8"))?.[1];
      return own === version
        ? []
        : [
            `${crate.name} is at ${own}, the release group at ${version}: run node tools/release/versions.ts sync.`,
          ];
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === "next") console.log(next());
  else if (command === "plan") {
    // For the release workflow's plan: with changesets pending, a run rehearses their version.
    const rehearse = pendingBump() !== undefined;
    console.log(`rehearse=${rehearse}`);
    if (rehearse) console.log(`version=${next()}`);
  } else if (command === "rehearse") {
    const version = next();
    apply(version);
    console.log(`rehearsing ${version}`);
  } else if (command === "sync") {
    apply(current());
    console.log(`crates at ${current()}`);
  } else if (command === "check") {
    const problems = crateProblems();
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } else {
    console.error("usage: versions.ts next | plan | rehearse | sync | check");
    process.exitCode = 2;
  }
}
