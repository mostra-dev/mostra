#!/usr/bin/env node
/**
 * Which machines CI's Linux jobs run on (D152): Blacksmith's while Blacksmith usage over the last
 * 31 days stays under the monthly budget, GitHub's otherwise. A rolling window holds whichever
 * day Blacksmith's billing month starts on, since every billing month lies inside some window. macOS and Windows jobs always run on GitHub's
 * runners, and so does every job that publishes (npm trusted publishing accepts only
 * GitHub-hosted runners).
 *
 *   node tools/check/runners.ts [--usage <file>] [--status <file>]
 *
 * `--usage` is the JSON `blacksmith usage` printed for the last 31 days, `--status` the JSON of
 * Blacksmith's status page; a missing or unreadable file means "unknown". The decision prints as
 * JSON on stdout, and as `runners=<json>` in `$GITHUB_OUTPUT` when that is set. Settings come from
 * the environment: `CI_RUNNERS` (`auto`, the default, `github` or `blacksmith`),
 * `BLACKSMITH_BUDGET` (billing minutes a month, default 6000: Blacksmith's free 3,000 2-vCPU
 * minutes, since its CLI counts a 2-vCPU minute as 2 billing minutes), `BLACKSMITH_THRESHOLD` (the share
 * of the budget after which jobs move to GitHub, default 0.9) and `MOSTRA_CI_TRUSTED` (`1` when
 * the run may use Blacksmith at all: not a fork's pull request, and the token is there).
 *
 * Every doubt chooses GitHub, whose runners are free for a public repository: a Blacksmith job
 * nobody picks up waits for a day before GitHub cancels it, so the selector never bets on one.
 * Node.js built-ins only: the plan job runs it before anything is installed.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

/** Where the Linux jobs of a run go. */
export type Pool = "blacksmith" | "github";

/** The runner labels a run's jobs use, by kind of machine. */
export interface Runners {
  readonly pool: Pool;
  /** Why this pool, for the run's summary. */
  readonly reason: string;
  /** Light Linux jobs (static checks) and heavy ones (tests that run real processes). */
  readonly linux: { readonly small: string; readonly large: string };
  readonly macos: string;
  readonly windows: { readonly x64: string; readonly arm64: string };
}

/** What the decision depends on. */
export interface RunnerInputs {
  /** `CI_RUNNERS`: `auto` (or unset), `github` or `blacksmith`. */
  readonly policy: string | undefined;
  /** Whether this run may use Blacksmith: a trusted event with the token available. */
  readonly trusted: boolean;
  /** Blacksmith's status page, as reported (`UP` when all is well), if it could be read. */
  readonly status: string | undefined;
  /** Blacksmith billing minutes used in the last 31 days, if they could be read. */
  readonly usage: number | undefined;
  /** Billing minutes a month the budget allows. */
  readonly budget: number;
  /** The share of the budget after which jobs move to GitHub. */
  readonly threshold: number;
}

/** GitHub's runners (D150 item 10 for Windows; every leg's runner before D152). */
export const GITHUB_RUNNERS = {
  linux: { small: "ubuntu-latest", large: "ubuntu-latest" },
  macos: "macos-latest",
  windows: { x64: "windows-latest", arm64: "windows-11-arm" },
} as const;

/**
 * Blacksmith's Linux runners, on the Ubuntu release `ubuntu-latest` names (26.04 since
 * 2026-10-19), so caches keyed by image and the e2e engines' system packages stay the same. A
 * public repository's `ubuntu-latest` has 4 vCPUs: the heavy jobs keep 4, the static checks take 2.
 */
export const BLACKSMITH_LINUX = {
  small: "blacksmith-2vcpu-ubuntu-2604",
  large: "blacksmith-4vcpu-ubuntu-2604",
} as const;

/** Chooses the pool. Every doubt chooses GitHub. */
export function chooseRunners(inputs: RunnerInputs): Runners {
  const github = (reason: string): Runners => ({ pool: "github", reason, ...GITHUB_RUNNERS });
  const blacksmith = (reason: string): Runners => ({
    pool: "blacksmith",
    reason,
    ...GITHUB_RUNNERS,
    linux: BLACKSMITH_LINUX,
  });
  const policy = (inputs.policy ?? "").trim() || "auto";
  if (policy === "github") return github("CI_RUNNERS is github");
  if (!["auto", "blacksmith"].includes(policy))
    return github(`CI_RUNNERS is "${policy}", which isn't auto, github or blacksmith`);
  if (!inputs.trusted)
    return github("this run can't use Blacksmith (a fork's pull request, or no token)");
  if (inputs.status !== undefined && inputs.status !== "UP")
    return github(`Blacksmith's status page reports ${inputs.status}`);
  if (policy === "blacksmith") return blacksmith("CI_RUNNERS is blacksmith");
  if (inputs.status === undefined) return github("Blacksmith's status page couldn't be read");
  if (inputs.usage === undefined) return github("Blacksmith's recent usage couldn't be read");
  if (!(inputs.budget > 0) || !(inputs.threshold > 0 && inputs.threshold <= 1))
    return github(
      `the Blacksmith budget (${inputs.budget}) or threshold (${inputs.threshold}) is invalid`,
    );
  const limit = inputs.budget * inputs.threshold;
  const used = `${Math.round(inputs.usage)} of ${inputs.budget} billing minutes in 31 days`;
  return inputs.usage < limit
    ? blacksmith(`${used}, under ${Math.round(limit)}`)
    : github(`${used}, at or past ${Math.round(limit)}`);
}

/** Billing minutes from `blacksmith usage --format json`, or undefined for anything else. */
export function usageMinutes(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  try {
    const minutes = (JSON.parse(text) as { summary?: { billing_minutes?: unknown } }).summary
      ?.billing_minutes;
    return typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0
      ? minutes
      : undefined;
  } catch {
    return undefined;
  }
}

/** The page status from Blacksmith's status summary (`{ page: { status } }`), if readable. */
export function pageStatus(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const status = (JSON.parse(text) as { page?: { status?: unknown } }).page?.status;
    return typeof status === "string" && status !== "" ? status : undefined;
  } catch {
    return undefined;
  }
}

function readOptional(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function numberFrom(value: string | undefined, fallback: number): number {
  return value === undefined || value.trim() === "" ? fallback : Number(value);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { usage: { type: "string" }, status: { type: "string" } },
    strict: true,
  });
  const runners = chooseRunners({
    policy: process.env["CI_RUNNERS"],
    trusted: process.env["MOSTRA_CI_TRUSTED"] === "1",
    status: pageStatus(readOptional(values.status)),
    usage: usageMinutes(readOptional(values.usage)),
    budget: numberFrom(process.env["BLACKSMITH_BUDGET"], 6000),
    threshold: numberFrom(process.env["BLACKSMITH_THRESHOLD"], 0.9),
  });
  const json = JSON.stringify(runners);
  console.log(json);
  const output = process.env["GITHUB_OUTPUT"];
  if (output) appendFileSync(output, `runners=${json}\n`);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary)
    appendFileSync(
      summary,
      `### Runners\n\nLinux jobs on **${runners.pool}**: ${runners.reason}.\n`,
    );
}
