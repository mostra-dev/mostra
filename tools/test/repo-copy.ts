/**
 * A disposable copy of this repository for seeded-violation tests. Each gate test plants one
 * violation in the copy, runs the real gate command there, expects it to fail with the right
 * message, removes the violation and expects it to pass again. The copy shares node_modules with
 * the real checkout through symlinks and never touches it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lib/repo.ts";
import { listPackages } from "../lib/workspace.ts";

/** The output of one command run in the copy. */
export interface Ran {
  readonly code: number;
  readonly output: string;
}

/** A repository copy. */
export interface RepoCopy {
  readonly root: string;
  /** Runs a command from the copy's root (or `cwd` inside it). Never throws. */
  run(
    command: string,
    args: readonly string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Ran;
  /** Runs `git` in the copy, throwing on failure. */
  git(...args: string[]): string;
  /** Replaces a file's text; returns the original so the test can restore it. */
  edit(path: string, change: (text: string) => string): string;
  /** Writes a file. */
  write(path: string, text: string): void;
  /** Restores the copy to its last commit, dropping untracked files. */
  reset(): void;
  dispose(): void;
}

/**
 * The workspace packages' `node_modules`, copied as they are: pnpm fills them with relative
 * symlinks, so `@mostra/*` links resolve to the copy's own packages and third-party links reach the
 * shared root `node_modules` through the copy's link to it.
 */
function packageModuleDirs(): string[] {
  return listPackages()
    .map((pkg) => `${pkg.dir}/node_modules`)
    .filter((dir) => existsSync(join(ROOT, dir)));
}

/**
 * Copies the working tree (committed or not) into a temporary Git repository whose single commit
 * is the current state. That commit is also `origin/main`, so every gate compares against the
 * clean baseline and sees exactly the violation a test plants.
 */
export function copyRepository(): RepoCopy {
  const root = mkdtempSync(join(tmpdir(), "mostra-gates-"));
  const rsync = spawnSync(
    "rsync",
    [
      "-a",
      "--exclude",
      "node_modules",
      "--exclude",
      ".git",
      "--exclude",
      ".turbo",
      "--exclude",
      "target",
      `${ROOT}/`,
      `${root}/`,
    ],
    { encoding: "utf8" },
  );
  if (rsync.status !== 0) throw new Error(`rsync failed: ${rsync.stderr}`);
  // The root node_modules is shared through one symlink; it is never written.
  symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"));
  for (const dir of packageModuleDirs()) {
    const copied = spawnSync(
      "rsync",
      ["-a", "--exclude", ".vite*", `${join(ROOT, dir)}/`, `${join(root, dir)}/`],
      { encoding: "utf8" },
    );
    if (copied.status !== 0) throw new Error(`rsync of ${dir} failed: ${copied.stderr}`);
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Gate Test",
    GIT_AUTHOR_EMAIL: "gate@example.test",
    GIT_COMMITTER_NAME: "Gate Test",
    GIT_COMMITTER_EMAIL: "gate@example.test",
    LEFTHOOK: "0",
  };
  delete env["GITHUB_BASE_REF"];
  delete env["MOSTRA_BASE"];
  delete env["CI"];
  delete env["GITHUB_ACTIONS"];
  const run = (
    command: string,
    args: readonly string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Ran => {
    const result = spawnSync(command, args, {
      cwd: options.cwd ? join(root, options.cwd) : root,
      env: { ...env, ...options.env },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const git = (...args: string[]): string => {
    const result = run("git", args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.output}`);
    return result.output.trim();
  };
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git(
    "commit",
    "-q",
    "--no-verify",
    "-m",
    "chore: gate test baseline\n\nSigned-off-by: Gate Test <gate@example.test>",
  );
  // The baseline plays origin/main, so "changed since the base" means "changed in the test".
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return {
    root,
    run,
    git,
    edit(path, change) {
      const file = join(root, path);
      const original = readFileSync(file, "utf8");
      writeFileSync(file, change(original));
      return original;
    },
    write(path, text) {
      writeFileSync(join(root, path), text);
    },
    reset() {
      git("reset", "-q", "--hard", "HEAD");
      git("clean", "-q", "-fd", "-e", "node_modules");
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
