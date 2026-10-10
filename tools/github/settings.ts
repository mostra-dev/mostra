#!/usr/bin/env node
/**
 * GitHub repository settings as code (REPO_STANDARDS §6, §10; STANDARDS supply chain; D76, D79).
 * The desired settings live here and in `.github/rulesets/*.json`; this tool applies them through
 * `gh api` and verifies the live repository matches.
 *
 *   node tools/github/settings.ts verify   report every setting that differs (read-only)
 *   node tools/github/settings.ts apply    apply the settings, then verify
 *
 * Needs `gh` signed in with admin rights on the repository. Not part of CI: the default
 * workflow token can't read these settings, and CI never holds admin credentials.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, fromRoot, runSync } from "../lib/repo.ts";

const REPO = "mostra-dev/mostra";

/** Repository fields (PATCH /repos/{repo}). */
const REPOSITORY = {
  allow_merge_commit: true,
  allow_squash_merge: false,
  allow_rebase_merge: false,
  allow_auto_merge: true,
  delete_branch_on_merge: true,
  allow_update_branch: true,
  merge_commit_title: "PR_TITLE",
  merge_commit_message: "PR_BODY",
  has_wiki: false,
  web_commit_signoff_required: true,
} as const;

const SECURITY = {
  secret_scanning: "enabled",
  secret_scanning_push_protection: "enabled",
} as const;

interface Ruleset {
  readonly name: string;
  readonly [key: string]: unknown;
}

function gh(args: readonly string[], input?: string): unknown {
  const result = runSync("gh", ["api", ...args], input === undefined ? {} : { input });
  if (result.code !== 0) throw new Error(`gh api ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

function desiredRulesets(): Ruleset[] {
  const dir = fromRoot(".github/rulesets");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Ruleset);
}

/** The subset of `actual` that `desired` names, for comparison. */
function pick(desired: unknown, actual: unknown): unknown {
  if (Array.isArray(desired) && Array.isArray(actual))
    return desired.map((item, i) => pick(item, actual[i]));
  if (desired && typeof desired === "object" && actual && typeof actual === "object") {
    return Object.fromEntries(
      Object.keys(desired).map((key) => [
        key,
        pick((desired as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key]),
      ]),
    );
  }
  return actual;
}

const same = (desired: unknown, actual: unknown): boolean =>
  JSON.stringify(desired) === JSON.stringify(pick(desired, actual));

function verify(): string[] {
  const problems: string[] = [];
  const repo = gh([`repos/${REPO}`]) as Record<string, unknown> & {
    security_and_analysis: Record<string, { status: string }>;
  };
  for (const [key, value] of Object.entries(REPOSITORY)) {
    if (repo[key] !== value)
      problems.push(
        `repository ${key} is ${JSON.stringify(repo[key])}, want ${JSON.stringify(value)}`,
      );
  }
  for (const [key, value] of Object.entries(SECURITY)) {
    if (repo.security_and_analysis[key]?.status !== value) problems.push(`${key} is not ${value}`);
  }
  const reporting = gh([`repos/${REPO}/private-vulnerability-reporting`]) as { enabled: boolean };
  if (!reporting.enabled) problems.push("private vulnerability reporting is off");
  const actions = gh([`repos/${REPO}/actions/permissions`]) as { sha_pinning_required?: boolean };
  if (actions.sha_pinning_required !== true) problems.push("Actions SHA pinning is not required");
  const workflow = gh([`repos/${REPO}/actions/permissions/workflow`]) as {
    default_workflow_permissions: string;
    can_approve_pull_request_reviews: boolean;
  };
  if (workflow.default_workflow_permissions !== "read")
    problems.push("the default workflow token is not read-only");
  if (workflow.can_approve_pull_request_reviews)
    problems.push("workflows can approve pull requests");
  const live = gh([`repos/${REPO}/rulesets`]) as { id: number; name: string }[];
  for (const ruleset of desiredRulesets()) {
    const match = live.find((candidate) => candidate.name === ruleset.name);
    if (!match) {
      problems.push(`ruleset "${ruleset.name}" is missing`);
      continue;
    }
    const full = gh([`repos/${REPO}/rulesets/${match.id}`]);
    if (!same(ruleset, full))
      problems.push(`ruleset "${ruleset.name}" differs from .github/rulesets`);
  }
  return problems;
}

function apply(): void {
  const fields = Object.entries(REPOSITORY).flatMap(([key, value]) => [
    typeof value === "boolean" ? "-F" : "-f",
    `${key}=${value}`,
  ]);
  const security = Object.entries(SECURITY).flatMap(([key, value]) => [
    "-f",
    `security_and_analysis[${key}][status]=${value}`,
  ]);
  gh(["-X", "PATCH", `repos/${REPO}`, ...fields, ...security]);
  gh(["-X", "PUT", `repos/${REPO}/private-vulnerability-reporting`]);
  gh(["-X", "PUT", `repos/${REPO}/vulnerability-alerts`]);
  gh([
    "-X",
    "PUT",
    `repos/${REPO}/actions/permissions`,
    "-F",
    "enabled=true",
    "-f",
    "allowed_actions=all",
    "-F",
    "sha_pinning_required=true",
  ]);
  gh([
    "-X",
    "PUT",
    `repos/${REPO}/actions/permissions/workflow`,
    "-f",
    "default_workflow_permissions=read",
    "-F",
    "can_approve_pull_request_reviews=false",
  ]);
  const live = gh([`repos/${REPO}/rulesets`]) as { id: number; name: string }[];
  for (const ruleset of desiredRulesets()) {
    const match = live.find((candidate) => candidate.name === ruleset.name);
    const body = JSON.stringify(ruleset);
    if (match) gh(["-X", "PUT", `repos/${REPO}/rulesets/${match.id}`, "--input", "-"], body);
    else gh(["-X", "POST", `repos/${REPO}/rulesets`, "--input", "-"], body);
    console.log(`${match ? "updated" : "created"} ruleset "${ruleset.name}"`);
  }
}

const mode = process.argv[2];
if (mode === "apply") apply();
else if (mode !== "verify") {
  console.error("usage: settings.ts <verify|apply>");
  process.exit(2);
}
const problems = verify();
if (problems.length > 0) fail(problems, `GitHub settings of ${REPO}`);
console.log(`✓ GitHub settings of ${REPO} match tools/github/settings.ts and .github/rulesets`);
