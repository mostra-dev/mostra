#!/usr/bin/env node
/**
 * Commit-message rules (REPO_STANDARDS §7, EN-01): a Conventional Commits subject and a DCO
 * `Signed-off-by` trailer matching the author.
 *
 *   node tools/commits/cli.ts msg <file>       check a message file (lefthook commit-msg)
 *   node tools/commits/cli.ts range <a>..<b>   check every commit in a range, merges included (CI)
 */
import { readFileSync } from "node:fs";
import { git } from "../lib/repo.ts";

const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];
const SUBJECT = new RegExp(
  `^(${TYPES.join("|")})(\\([a-z0-9][a-z0-9-]*(,[a-z0-9][a-z0-9-]*)*\\))?!?: \\S`,
);
const MAX_SUBJECT = 100;

/** One commit to check. */
export interface CommitMessage {
  readonly id: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly message: string;
}

/** The problems with one commit message; empty when it follows the rules. */
export function checkMessage(commit: CommitMessage): string[] {
  const problems: string[] = [];
  const lines = commit.message.replace(/\r/g, "").split("\n");
  const subject = lines[0] ?? "";
  // Git's own merge subjects ("Merge branch 'main' into …") are fine; merges still need a
  // sign-off, because a merge can carry conflict resolutions (`git merge --signoff`).
  const merge = /^Merge (branch|remote-tracking branch|pull request|commit|tag) /.test(subject);
  if (!merge && !SUBJECT.test(subject)) {
    problems.push(
      `subject "${subject}" is not a Conventional Commit: <type>(<scope>): <summary>, type one of ${TYPES.join(", ")}`,
    );
  }
  if (subject.length > MAX_SUBJECT)
    problems.push(`subject is ${subject.length} characters (at most ${MAX_SUBJECT})`);
  if (lines.length > 1 && (lines[1] ?? "").trim() !== "")
    problems.push("the second line must be blank");
  const signoffs = lines
    .map((line) => /^Signed-off-by: (.+) <([^>]+)>\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (signoffs.length === 0) {
    problems.push(
      "missing the DCO sign-off: commit with `git commit -s` (Signed-off-by: Name <email>)",
    );
  } else if (
    !signoffs.some((match) => match[2]?.toLowerCase() === commit.authorEmail.toLowerCase())
  ) {
    problems.push(`no Signed-off-by trailer matches the author <${commit.authorEmail}>`);
  }
  return problems;
}

function commitsIn(range: string): CommitMessage[] {
  const log = git(["log", "--format=%H%x00%an%x00%ae%x00%B%x1e", range]);
  if (log === undefined) throw new Error(`git log ${range} failed`);
  return log
    .split("\x1e")
    .map((entry) => entry.replace(/^\n/, ""))
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const [id = "", authorName = "", authorEmail = "", message = ""] = entry.split("\x00");
      return { id, authorName, authorEmail, message: message.trim() };
    });
}

function main(): void {
  const [mode, argument] = process.argv.slice(2);
  let failures = 0;
  if (mode === "msg" && argument) {
    const ident = git(["var", "GIT_AUTHOR_IDENT"]) ?? "";
    const email = /<([^>]+)>/.exec(ident)?.[1] ?? "";
    const message = readFileSync(argument, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .trim();
    const problems = checkMessage({
      id: "new commit",
      authorName: "",
      authorEmail: email,
      message,
    });
    for (const problem of problems) console.error(`✗ ${problem}`);
    failures = problems.length;
  } else if (mode === "range" && argument) {
    const commits = commitsIn(argument);
    for (const commit of commits) {
      for (const problem of checkMessage(commit)) {
        console.error(`✗ ${commit.id.slice(0, 10)}: ${problem}`);
        failures++;
      }
    }
    if (failures === 0)
      console.log(`✓ ${commits.length} commits follow Conventional Commits with a DCO sign-off`);
  } else {
    console.error("usage: commits/cli.ts msg <file> | range <a>..<b>");
    process.exit(2);
  }
  process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) main();
