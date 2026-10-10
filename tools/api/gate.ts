/**
 * The public-surface gate for one package (REPO_STANDARDS §6 `api`, EN-04):
 *
 * 1. API Extractor writes (locally) or compares (CI) the committed report `etc/<name>.api.md` and
 *    fails on any warning, including undocumented public exports.
 * 2. A report that differs from the base needs a changeset naming the package.
 * 3. publint and are-the-types-wrong check the packed tarball.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles } from "../check/plan.ts";
import { fromRoot, mergeBase, readAtRevision, runSync } from "../lib/repo.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";

/** The committed API report's path, relative to the repository root. */
export function reportPath(pkg: WorkspacePackage): string {
  const unscoped = pkg.name.replace(/^@[^/]+\//, "");
  return `${pkg.dir}/etc/${unscoped}.api.md`;
}

/** Whether a changeset added or edited since `base` releases `packageName`. */
export function hasChangeset(packageName: string, files: readonly string[], root: string): boolean {
  for (const file of files) {
    if (!/^\.changeset\/[^/]+\.md$/.test(file) || file.endsWith("README.md")) continue;
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
    for (const line of frontmatter.split("\n")) {
      const key = /^\s*["']?([^"':]+)["']?\s*:/.exec(line)?.[1];
      if (key === packageName) return true;
    }
  }
  return false;
}

/**
 * The changeset rule: when the API report differs from the base, some changeset since the base
 * must name the package. Returns a problem, or `undefined` when the rule holds.
 */
export function changesetProblem(
  pkg: WorkspacePackage,
  base: string | undefined,
  root: string = fromRoot(),
): string | undefined {
  if (base === undefined) return undefined;
  const path = reportPath(pkg);
  const current = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined;
  const before = readAtRevision(base, path);
  if (current === before) return undefined;
  if (hasChangeset(pkg.name, changedFiles(base), root)) return undefined;
  return `${path} changed since ${base.slice(0, 10)} without a changeset for ${pkg.name}. Run \`pnpm changeset\` and describe the change.`;
}

/** Runs the whole gate for `pkg` and returns the problems found. */
export function apiGate(pkg: WorkspacePackage): string[] {
  const problems: string[] = [];
  const dir = fromRoot(pkg.dir);
  const ci = process.env["CI"] === "true" || process.env["GITHUB_ACTIONS"] === "true";

  const extractor = runSync("node", [
    fromRoot("tools/ts6/api-report.mjs"),
    dir,
    ci ? "ci" : "local",
  ]);
  process.stdout.write(extractor.stdout);
  process.stderr.write(extractor.stderr);
  if (extractor.code !== 0) problems.push(`API Extractor failed for ${pkg.name} (see above).`);

  const changeset = changesetProblem(pkg, mergeBase());
  if (changeset) problems.push(changeset);

  const publint = runSync(
    fromRoot("tools/node_modules/.bin/publint"),
    ["--strict", "--pack", "pnpm"],
    {
      cwd: dir,
    },
  );
  if (publint.code !== 0) problems.push(`publint: ${(publint.stdout + publint.stderr).trim()}`);
  else console.log("✓ publint");

  const attw = runSync(
    fromRoot("tools/node_modules/.bin/attw"),
    ["--pack", ".", "--profile", "esm-only", "--format", "table-flipped", "--no-emoji"],
    { cwd: dir },
  );
  if (attw.code !== 0) problems.push(`are-the-types-wrong: ${(attw.stdout + attw.stderr).trim()}`);
  else console.log("✓ are-the-types-wrong");

  for (const file of readdirSync(dir)) if (file.endsWith(".tgz")) runSync("rm", [join(dir, file)]);
  return problems;
}
