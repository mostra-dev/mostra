/**
 * Publishes a built plugin to its own repository (D147, WP-14): the release's tree as one commit
 * on `main`, tagged `v<version>`, so every harness and directory installs a pinned release.
 *
 *   node tools/plugins/publish.ts --tree <dir> --version <v> --remote <git url>
 *
 * Idempotent, as a release run that is retried must be: a tag that already holds exactly this
 * tree is done; a tag that holds anything else fails, never moved (published plugins are pinned
 * by tag). `main` only moves forward: a version older than one already published (a retried
 * release after a newer one) gets its tag on a commit off `main`, which keeps the newest (WP-14's
 * Opus review, finding 2). The tree must be the one built for this version (its `plugin.json`
 * says so). The commit carries only the tree; `.git` of the build is never pushed. The release
 * job passes an SSH remote and a deploy key that can write to that one repository
 * (`GIT_SSH_COMMAND`); tests pass a local bare repository. It imports Node.js built-ins and the
 * release's version rules only: the job that runs it holds the key and installs nothing.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, isReleaseVersion, option } from "../lib/release-version.ts";

/** Runs git, failing loudly; returns its trimmed stdout. */
function git(cwd: string, args: readonly string[], allowFailure = false): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0 && !allowFailure)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.status === 0 ? result.stdout.trim() : "";
}

/**
 * What `publishPlugin` did: `published` moved `main` and tagged it; `tagged` tagged a commit off
 * `main`, which holds a newer version; `already-published` found the tag holding this tree.
 */
export type PublishOutcome = "published" | "tagged" | "already-published";

export function publishPlugin(options: {
  readonly tree: string;
  readonly version: string;
  readonly remote: string;
}): PublishOutcome {
  const { tree, version, remote } = options;
  if (!isReleaseVersion(version)) throw new Error(`"${version}" isn't a release version`);
  const built = (
    JSON.parse(readFileSync(join(tree, "plugin.json"), "utf8")) as { version?: unknown }
  ).version;
  if (built !== version)
    throw new Error(`the tree is the plugin of ${String(built)}, not of ${version}`);
  const tag = `v${version}`;
  const work = mkdtempSync(join(tmpdir(), "mostra-plugin-publish-"));
  try {
    git(work, ["init", "--quiet", "--initial-branch", "main"]);
    git(work, ["config", "user.name", "Mostra release"]);
    git(work, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    git(work, ["config", "commit.gpgsign", "false"]);
    git(work, ["remote", "add", "origin", remote]);
    // An empty repository has neither; each fetch may find nothing.
    git(work, ["fetch", "--quiet", "--tags", "origin"], true);
    git(work, ["fetch", "--quiet", "origin", "main:refs/remotes/origin/main"], true);
    const hasMain = git(
      work,
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"],
      true,
    );
    if (hasMain !== "") git(work, ["checkout", "--quiet", "-B", "main", "origin/main"]);
    // The commit holds exactly the built tree.
    for (const name of readdirSync(work))
      if (name !== ".git") rmSync(join(work, name), { recursive: true });
    for (const name of readdirSync(tree))
      if (name !== ".git") cpSync(join(tree, name), join(work, name), { recursive: true });
    git(work, ["add", "--all"]);
    const wanted = git(work, ["write-tree"]);
    const tagged = git(work, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{tree}`], true);
    if (tagged !== "") {
      if (tagged === wanted) return "already-published";
      throw new Error(`${tag} already holds another tree (${tagged}); a published tag never moves`);
    }
    // `main` holds the newest version published: an older one is tagged off it.
    const newest = git(work, ["tag", "--list", "v*"])
      .split("\n")
      .map((name) => name.slice(1))
      .filter(isReleaseVersion)
      .sort(compareVersions)
      .at(-1);
    const forward = newest === undefined || compareVersions(version, newest) > 0;
    const head = hasMain === "" ? "" : git(work, ["rev-parse", "HEAD^{tree}"]);
    if (head !== wanted || !forward)
      git(work, ["commit", "--quiet", "--allow-empty", "--message", `Mostra ${version}`]);
    git(work, ["tag", "--annotate", tag, "--message", `Mostra ${version}`]);
    if (!forward) {
      git(work, ["push", "--quiet", "origin", `refs/tags/${tag}`]);
      return "tagged";
    }
    git(work, ["push", "--quiet", "--atomic", "origin", "main", `refs/tags/${tag}`]);
    return "published";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const tree = option(process.argv, "--tree");
  const version = option(process.argv, "--version");
  const remote = option(process.argv, "--remote");
  if (tree === undefined || version === undefined || remote === undefined) {
    console.error("usage: publish.ts --tree <dir> --version <v> --remote <git url>");
    process.exitCode = 2;
  } else {
    const outcome = publishPlugin({ tree, version, remote });
    console.log(
      outcome === "published"
        ? `✓ plugin v${version} published to ${remote}`
        : outcome === "tagged"
          ? `✓ plugin v${version} tagged at ${remote}; its main keeps a newer version`
          : `✓ plugin v${version} was already published to ${remote}, with this tree`,
    );
  }
}
