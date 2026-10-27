#!/usr/bin/env node
/**
 * The CI plan job's entry (D152): reads the event GitHub ran the workflow for, makes the plan for
 * the scope that event gets, lays it out on the machines `runners.ts` chose (matrix.ts), and
 * writes one `$GITHUB_OUTPUT` line per part, which every other job of `ci.yml` reads.
 *
 *   node tools/check/ci.ts            the layout as JSON on stdout, and the outputs in CI
 *
 * Inputs from the environment: `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` (GitHub's), the
 * chosen runners as JSON in `MOSTRA_CI_RUNNERS` (GitHub's own when unset), `MOSTRA_CI_PULL`, a
 * file holding the pull request as GitHub's API returns it now (its draft state and labels at a
 * re-run, which the event's payload keeps as they were), `GITHUB_REF`, `GITHUB_SHA`, and, for the
 * nightly run, `MOSTRA_CI_NIGHTLIES`, a file of the recent nightly runs ({@link Nightly}).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { type CiEvent, type CiMatrix, ciMatrix, ciScope } from "./matrix.ts";
import { makePlan } from "./plan.ts";
import { GITHUB_RUNNERS, type Runners } from "./runners.ts";

/** A pull request as the event's payload and GitHub's API both carry it. */
interface Pull {
  readonly draft?: boolean;
  readonly user?: { readonly type?: string };
  readonly labels?: readonly { readonly name?: string }[];
}

interface Payload {
  readonly pull_request?: Pull;
  readonly inputs?: { readonly full?: boolean | string };
}

/**
 * How long a nightly run that passed covers its commit: the next nightly runs everything again
 * past it, so the caches it saves are read within both stores' 7-day eviction (#86) even when
 * `main` doesn't move for a week.
 */
export const NIGHTLY_COVERS_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Whether the last nightly run that passed on this commit still covers it: `passedAt` is when it
 * ran (empty when none passed on this commit).
 */
export function nightlyCovers(passedAt: string | undefined, now: number): boolean {
  const at = passedAt ? Date.parse(passedAt) : Number.NaN;
  return Number.isFinite(at) && now - at < NIGHTLY_COVERS_MS;
}

/** One recent nightly run, as the plan job's step gathers them (newest first). */
export interface Nightly {
  readonly headSha: string;
  readonly createdAt: string;
  readonly conclusion: string;
  /** How many of its jobs besides the plan and `ci-ok` passed: 0 for a run that skipped. */
  readonly gates: number;
}

/**
 * When the newest nightly run on `sha` that ran its gates started, if it passed: a run that only
 * skipped (it found this commit covered) proves nothing and renews nothing, so a commit that
 * doesn't move still runs everything within {@link NIGHTLY_COVERS_MS} of the run that did; and a
 * newer nightly on `sha` that failed or was cancelled means nothing covers it (GPT review of
 * MT-02).
 */
export function coveringNightly(runs: readonly Nightly[], sha: string): string | undefined {
  for (const run of runs) {
    if (run.headSha !== sha) continue;
    if (run.conclusion !== "success") return undefined;
    if (run.gates > 0) return run.createdAt;
  }
  return undefined;
}

/** The nightly runs the plan job's step wrote to `file`, newest first; none when unreadable. */
function readNightlies(file: string | undefined): Nightly[] {
  if (!file || !existsSync(file)) return [];
  try {
    const runs = JSON.parse(readFileSync(file, "utf8")) as Nightly[];
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

/** The event, from GitHub's event name and payload; `ref` is the run's (`GITHUB_REF`). */
export function ciEvent(
  name: string,
  payload: Payload,
  nightlyPassed: boolean,
  ref?: string,
): CiEvent {
  switch (name) {
    case "pull_request": {
      const pr = payload.pull_request ?? {};
      return {
        name,
        draft: pr.draft === true,
        bot: pr.user?.type === "Bot",
        labels: (pr.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
      };
    }
    case "merge_group":
      return { name };
    case "schedule":
      return { name, alreadyPassed: nightlyPassed };
    case "workflow_dispatch": {
      const full = payload.inputs?.full;
      return {
        name,
        full: !(full === false || full === "false"),
        ...(ref === "refs/heads/main" ? { onMain: true } : {}),
      };
    }
    default:
      throw new Error(`ci.ts doesn't know the event "${name}"`);
  }
}

/** The `$GITHUB_OUTPUT` lines of a layout: one JSON value per part. */
export function outputLines(matrix: CiMatrix): string[] {
  return [
    `run=${matrix.run}`,
    `scope=${matrix.scopeFlag}`,
    ...(
      ["static", "unit", "hygiene", "integration", "windows", "e2e", "rust", "conformance"] as const
    ).map((part) => `${part}=${JSON.stringify(matrix[part])}`),
    `release=${JSON.stringify(matrix.release)}`,
  ];
}

/** A Markdown summary of the layout, for the run's page. */
export function summary(matrix: CiMatrix, runners: Runners): string {
  const count = (legs: readonly unknown[]): number => legs.length;
  const machines =
    count(matrix.static) +
    count(matrix.unit) +
    count(matrix.hygiene) +
    count(matrix.integration) +
    count(matrix.windows) +
    count(matrix.e2e) +
    count(matrix.rust) +
    count(matrix.conformance);
  return [
    "### Plan",
    "",
    `**${matrix.run ? "Runs" : "Runs nothing"}**: ${matrix.reason}.`,
    "",
    `- scope: ${matrix.scope}, legs: ${matrix.legs}; ${machines} machines`,
    `- jobs: ${matrix.jobs.join(", ") || "none"}`,
    `- Linux on ${runners.pool}: ${runners.reason}`,
    `- release rehearsal: ${matrix.release ? matrix.release.reason : "none (no package or distribution file changed)"}`,
    ...(matrix.deferred.length > 0
      ? [
          `- left to the merge queue (GitHub runs five macOS jobs at once): ${matrix.deferred.join(", ")}`,
        ]
      : []),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const name = process.env["GITHUB_EVENT_NAME"] ?? "workflow_dispatch";
  const path = process.env["GITHUB_EVENT_PATH"];
  const original = path ? (JSON.parse(readFileSync(path, "utf8")) as Payload) : {};
  const pullFile = process.env["MOSTRA_CI_PULL"];
  const payload: Payload =
    name === "pull_request" && pullFile && existsSync(pullFile)
      ? { ...original, pull_request: JSON.parse(readFileSync(pullFile, "utf8")) as Pull }
      : original;
  const event = ciEvent(
    name,
    payload,
    nightlyCovers(
      coveringNightly(
        readNightlies(process.env["MOSTRA_CI_NIGHTLIES"]),
        process.env["GITHUB_SHA"] ?? "",
      ),
      Date.now(),
    ),
    process.env["GITHUB_REF"],
  );
  const runnersJson = process.env["MOSTRA_CI_RUNNERS"];
  const runners: Runners = runnersJson
    ? (JSON.parse(runnersJson) as Runners)
    : { pool: "github", reason: "no runner choice given", ...GITHUB_RUNNERS };
  const scope = ciScope(event);
  const matrix = ciMatrix(scope, makePlan({ affected: scope.scope === "affected" }), runners);
  console.log(JSON.stringify(matrix, null, 2));
  const output = process.env["GITHUB_OUTPUT"];
  if (output) appendFileSync(output, `${outputLines(matrix).join("\n")}\n`);
  const step = process.env["GITHUB_STEP_SUMMARY"];
  if (step) appendFileSync(step, summary(matrix, runners));
}
