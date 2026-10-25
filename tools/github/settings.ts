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

/**
 * The environment the release workflow publishes from (D67, EN-05): only `main` may deploy to it,
 * so only a merged version pull request reaches npm, crates.io and the GitHub release.
 */
const RELEASE_ENVIRONMENT = "release";
const RELEASE_BRANCHES = ["main"];

/**
 * Who needs a maintainer's approval before Actions runs their pull request: everyone outside the
 * repository, not only first-time contributors (D152). A fork's run gets no secrets, but it still
 * spends runner time; nothing runs for a stranger until someone looks.
 */
const FORK_APPROVAL = "all_external_contributors";

/** Labels the workflow reads: `ci:full` runs a pull request as the merge queue does (D152). */
const LABELS = [
  {
    name: "ci:full",
    color: "1d76db",
    description: "Run every CI leg on this pull request, as the merge queue does (D152)",
  },
] as const;

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
  const environments = gh([`repos/${REPO}/environments`]) as {
    environments: {
      name: string;
      deployment_branch_policy: { custom_branch_policies: boolean } | null;
    }[];
  };
  const release = environments.environments.find((env) => env.name === RELEASE_ENVIRONMENT);
  if (!release) problems.push(`the "${RELEASE_ENVIRONMENT}" environment is missing`);
  else if (release.deployment_branch_policy?.custom_branch_policies !== true)
    problems.push(`the "${RELEASE_ENVIRONMENT}" environment lets any branch deploy`);
  else {
    const policies = gh([
      `repos/${REPO}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies`,
    ]) as { branch_policies: { name: string; type?: string }[] };
    const names = policies.branch_policies.map((policy) => policy.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(RELEASE_BRANCHES))
      problems.push(
        `the "${RELEASE_ENVIRONMENT}" environment deploys from ${names.join(", ") || "nothing"}, want ${RELEASE_BRANCHES.join(", ")}`,
      );
  }
  const immutable = gh([`repos/${REPO}/immutable-releases`]) as { enabled: boolean };
  if (!immutable.enabled) problems.push("immutable releases are off");
  const approval = gh([`repos/${REPO}/actions/permissions/fork-pr-contributor-approval`]) as {
    approval_policy: string;
  };
  if (approval.approval_policy !== FORK_APPROVAL)
    problems.push(
      `fork pull requests need approval for ${approval.approval_policy}, want ${FORK_APPROVAL}`,
    );
  const labels = gh([`repos/${REPO}/labels?per_page=100`]) as { name: string }[];
  for (const label of LABELS)
    if (!labels.some((candidate) => candidate.name === label.name))
      problems.push(`the label "${label.name}" is missing`);
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
  gh(
    ["-X", "PUT", `repos/${REPO}/environments/${RELEASE_ENVIRONMENT}`, "--input", "-"],
    JSON.stringify({
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    }),
  );
  const policies = gh([
    `repos/${REPO}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies`,
  ]) as { branch_policies: { id: number; name: string }[] };
  for (const policy of policies.branch_policies) {
    if (!RELEASE_BRANCHES.includes(policy.name))
      gh([
        "-X",
        "DELETE",
        `repos/${REPO}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies/${policy.id}`,
      ]);
  }
  for (const branch of RELEASE_BRANCHES) {
    if (policies.branch_policies.some((policy) => policy.name === branch)) continue;
    gh(
      [
        "-X",
        "POST",
        `repos/${REPO}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies`,
        "--input",
        "-",
      ],
      JSON.stringify({ name: branch, type: "branch" }),
    );
  }
  gh(["-X", "PUT", `repos/${REPO}/immutable-releases`]);
  gh([
    "-X",
    "PUT",
    `repos/${REPO}/actions/permissions/fork-pr-contributor-approval`,
    "-f",
    `approval_policy=${FORK_APPROVAL}`,
  ]);
  const labels = gh([`repos/${REPO}/labels?per_page=100`]) as { name: string }[];
  for (const label of LABELS) {
    const exists = labels.some((candidate) => candidate.name === label.name);
    gh([
      "-X",
      exists ? "PATCH" : "POST",
      exists ? `repos/${REPO}/labels/${encodeURIComponent(label.name)}` : `repos/${REPO}/labels`,
      ...(exists ? [] : ["-f", `name=${label.name}`]),
      "-f",
      `color=${label.color}`,
      "-f",
      `description=${label.description}`,
    ]);
  }
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
