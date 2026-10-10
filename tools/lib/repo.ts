/**
 * Small helpers every repository tool shares: the repository root, running commands, and Git.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root (the directory holding `pnpm-workspace.yaml`). */
export const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Resolves a path relative to the repository root. */
export function fromRoot(...parts: string[]): string {
  return join(ROOT, ...parts);
}

/** The result of a finished command. */
export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to completion and captures its output. Never throws on a non-zero exit. */
export function runSync(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    return { code: 127, stdout: "", stderr: `${command}: ${result.error.message}` };
  }
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs a command with its output streamed through `onLine`, resolving with the exit code.
 */
export function runStreaming(
  command: string,
  args: readonly string[],
  onLine: (line: string) => void,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pending = "";
    const feed = (chunk: Buffer): void => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (error) => {
      onLine(`${command}: ${error.message}`);
      resolvePromise(127);
    });
    child.on("close", (code) => {
      if (pending) onLine(pending);
      resolvePromise(code ?? 1);
    });
  });
}

/** Runs `git` in the repository and returns trimmed stdout, or `undefined` when it fails. */
export function git(args: readonly string[], cwd: string = ROOT): string | undefined {
  const result = runSync("git", args, { cwd });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * The commit the current work is compared against: the merge base of `HEAD` with the explicit base
 * (`base`, or `MOSTRA_BASE`, which `pnpm check` sets for every step), else with the pull
 * request's base branch in CI, else with `origin/main`. An explicit base that doesn't resolve is
 * an error, never a silent fallback. Returns `undefined` only when no default base exists (a
 * fresh clone without `origin`).
 */
export function mergeBase(base?: string): string | undefined {
  const explicit = base ?? process.env["MOSTRA_BASE"];
  if (explicit) {
    const sha = git(["merge-base", "HEAD", explicit]);
    if (!sha)
      throw new Error(
        `The base "${explicit}" doesn't resolve to a commit that shares history with HEAD.`,
      );
    return sha;
  }
  const githubBase = process.env["GITHUB_BASE_REF"];
  const candidates = [githubBase ? `origin/${githubBase}` : undefined, "origin/main", "main"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const sha = git(["merge-base", "HEAD", candidate]);
    if (sha) return sha;
  }
  return undefined;
}

/** The file names directly inside `dir` at a Git revision (empty when the directory is absent). */
export function listAtRevision(revision: string, dir: string): string[] {
  const result = runSync("git", ["ls-tree", "--name-only", `${revision}:${dir}`]);
  return result.code === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

/** Reads a file's content at a Git revision, or `undefined` when it doesn't exist there. */
export function readAtRevision(revision: string, path: string): string | undefined {
  const result = runSync("git", ["show", `${revision}:${path}`]);
  return result.code === 0 ? result.stdout : undefined;
}

/** Reports a failure the way every tool does: one line per problem, then a non-zero exit. */
export function fail(problems: readonly string[], heading: string): never {
  console.error(`✗ ${heading}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
