#!/usr/bin/env node
/**
 * Legs GitHub never gave a runner (#210, D152 item 9). GitHub's hosted macOS arm64 pool sometimes
 * fails to assign a runner: the job waits, then GitHub cancels it with no runner, no step run and
 * the annotation "The job was not acquired by Runner of type hosted even after multiple attempts".
 * Its matrix then reports `abandoned`, which `ci-ok` rightly refuses, so one starved leg failed a
 * pull request's run and dropped it from the merge queue, whose decision is that one run's `ci-ok`
 * (a re-run after the run ends comes too late for the queue).
 *
 * So the run tries those legs once more itself. The `starved` job, after every gate, lists this
 * run's jobs through GitHub's API and picks exactly the legs GitHub starved; after a wait it hands
 * them to the gates' retry twins (`<job>-retry` in `ci.yml`, the same steps through YAML aliases),
 * and for the release rehearsal, what is left of it to `release-build.yml`'s `resume`. `ci-ok`
 * then accepts a gate that didn't pass only when this job named it and its retry passed.
 *
 *   node tools/check/starved.ts select    in the `starved` job: GITHUB_REPOSITORY, GITHUB_RUN_ID,
 *                                         GITHUB_RUN_ATTEMPT, GH_TOKEN, and PLAN (the plan job's
 *                                         outputs as JSON); writes the retry lists to
 *                                         $GITHUB_OUTPUT. `--jobs <file> --annotations <file>`
 *                                         replays a recorded run instead of asking the API, and
 *                                         `--no-wait` skips the wait.
 *   node tools/check/starved.ts verdict   in `ci-ok`: NEEDS (`toJSON(needs)`); exits 1 unless
 *                                         every gate passed, was skipped by the plan, or was
 *                                         starved and passed on its retry.
 *
 * It uses only Node.js's built-ins: `ci-ok` and `starved` run it without installing anything.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import type { Leg, Rehearsal } from "./matrix.ts";

/** The words of GitHub's annotation on a job it never gave a runner (VERIFIED_FACTS, #210). */
export const NOT_ACQUIRED = "was not acquired by Runner";

/**
 * How long after the last starved leg was cancelled the retry starts. On 2026-11-17 and 18 every
 * such leg run again 10 to 38 minutes later got a runner; on 2026-11-04, an outage, 11 of 13 run
 * again 2 to 17 minutes later starved again (fork 5's measurements, #210). Longer waits cost every
 * starved run more of the merge queue's 120 minutes.
 */
export const WAIT_MINUTES = 10;

/** The gates with legs on GitHub's macOS or Windows runners, each with a retry twin in ci.yml. */
export const RETRIED = ["rust", "conformance", "integration", "windows", "e2e"] as const;
export type Retried = (typeof RETRIED)[number];

/** A job as GitHub's API lists it (`/actions/runs/{id}/attempts/{n}/jobs`). */
export interface ApiJob {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly runner_name: string | null;
  readonly steps?: readonly unknown[] | null;
  readonly completed_at: string | null;
}

/** An annotation as GitHub's API lists it (`/check-runs/{id}/annotations`). */
export interface Annotation {
  readonly annotation_level?: string;
  readonly message?: string;
}

/** The plan job's outputs, as JSON strings (ci.ts's `outputLines`). */
export type PlanOutputs = Readonly<Record<string, string>>;

/** What the release rehearsal still has to do (`release-build.yml`'s `resume`). */
export interface Resume {
  readonly bundle: readonly Leg[];
  readonly smoke: readonly Leg[];
  readonly packages: boolean;
  readonly npmSmoke: readonly Leg[];
  readonly oldNode: boolean;
  readonly image: boolean;
}

export interface Selection {
  /** Each retried gate's starved legs, marked `retry` (empty when it has none). */
  readonly retry: Readonly<Record<Retried, readonly Leg[]>>;
  /** What the release rehearsal still has to do, or null. */
  readonly release: Resume | null;
  /** The gates (ci.yml's job ids) whose result a passing retry redeems. */
  readonly eligible: readonly string[];
  /** The jobs GitHub starved. */
  readonly starved: readonly ApiJob[];
  /**
   * Why nothing is retried: jobs that failed for another reason, or legs the plan listed that have
   * no job. `ci-ok` fails then whatever a retry does, so no runner is spent on one.
   */
  readonly blocked: readonly string[];
}

/** Whether GitHub cancelled `job` because it never got a runner. */
export function isStarved(job: ApiJob, annotations: readonly Annotation[]): boolean {
  return (
    job.status === "completed" &&
    job.conclusion === "cancelled" &&
    !job.runner_name &&
    (job.steps ?? []).length === 0 &&
    annotations.some((note) => (note.message ?? "").includes(NOT_ACQUIRED))
  );
}

/** Whether a job is worth asking for annotations: cancelled before it ran a step. */
export function cancelledUnstarted(job: ApiJob): boolean {
  return job.conclusion === "cancelled" && !job.runner_name && (job.steps ?? []).length === 0;
}

/** A leg's job name as ci.yml's `name:` renders it (a test holds the two together). */
export function legName(job: Retried, leg: Leg): string {
  switch (job) {
    case "rust":
    case "conformance":
      return `${job} (${leg["os"]})`;
    case "integration":
      return `integration (${leg["os"]}, ${leg["group"]})`;
    case "windows":
      return `${leg["job"]} (${leg["os"]}${leg["job"] === "integration" ? `, ${leg["group"]}` : ""})`;
    case "e2e":
      return `e2e (${leg["os"]}, ${leg["browser"]}${leg["shard"] ? `, ${leg["shard"]}` : ""})`;
  }
}

/** The release rehearsal's job names, as GitHub lists a called workflow's jobs. */
export const RELEASE_NAMES = {
  bundle: (platform: string) => `release / bundle (${platform})`,
  smoke: (platform: string) => `release / smoke (${platform}, no Node.js)`,
  packages: "release / packages (pins, pack, npm publish --dry-run)",
  npmSmoke: (platform: string) => `release / npm-smoke (${platform}, Node.js 22)`,
  oldNode: "release / npm-old-node (Node.js 20)",
  image: "release / image (linux/amd64)",
} as const;

const DONE = new Set(["success", "skipped"]);

/** The parts of the plan the retry needs; a part it can't read is treated as empty. */
function planLegs(plan: PlanOutputs, part: string): Leg[] {
  try {
    const legs = JSON.parse(plan[part] ?? "[]") as unknown;
    return Array.isArray(legs) ? (legs as Leg[]) : [];
  } catch {
    return [];
  }
}

function planRelease(plan: PlanOutputs): Rehearsal | null {
  try {
    return (JSON.parse(plan["release"] ?? "null") as Rehearsal | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Picks the legs to try again. `jobs` is this run attempt's jobs, `annotations` each cancelled,
 * unstarted job's annotations by job id. Nothing is retried when any job failed for another reason
 * or when a leg the plan listed has no job at all: `ci-ok` fails then whatever a retry does.
 */
export function select(
  plan: PlanOutputs,
  jobs: readonly ApiJob[],
  annotations: ReadonlyMap<number, readonly Annotation[]>,
): Selection {
  const completed = jobs.filter((job) => job.status === "completed");
  // The newest job of a name: a name repeats only when a later attempt ran it again.
  const byName = new Map<string, ApiJob>();
  for (const job of [...completed].sort((a, b) => a.id - b.id)) byName.set(job.name, job);
  const starvedIds = new Set(
    completed.filter((job) => isStarved(job, annotations.get(job.id) ?? [])).map((job) => job.id),
  );
  const failed = completed
    .filter((job) => !DONE.has(job.conclusion ?? "") && !starvedIds.has(job.id))
    .map((job) => `${job.name}: ${job.conclusion}`);

  const retry = Object.fromEntries(RETRIED.map((name) => [name, [] as Leg[]])) as Record<
    Retried,
    Leg[]
  >;
  const eligible: string[] = [];
  const missing: string[] = [];
  for (const name of RETRIED) {
    const legs = planLegs(plan, name);
    const starved: Leg[] = [];
    for (const leg of legs) {
      const job = byName.get(legName(name, leg));
      if (!job) missing.push(legName(name, leg));
      else if (starvedIds.has(job.id)) starved.push({ ...leg, retry: "1" });
    }
    if (starved.length > 0) {
      retry[name] = starved;
      eligible.push(name);
    }
  }

  let release: Resume | null = null;
  const rehearsal = planRelease(plan);
  if (rehearsal) {
    const state = (name: string): "done" | "starved" | "todo" => {
      const job = byName.get(name);
      if (!job) return "todo";
      if (starvedIds.has(job.id)) return "starved";
      return job.conclusion === "success" ? "done" : "todo";
    };
    const image = rehearsal.platforms.some((leg) => leg["platform"] === "linux-x64");
    const names = [
      ...rehearsal.platforms.flatMap((leg) => [
        RELEASE_NAMES.bundle(String(leg["platform"])),
        RELEASE_NAMES.smoke(String(leg["platform"])),
      ]),
      RELEASE_NAMES.packages,
      ...rehearsal.npmSmoke.map((leg) => RELEASE_NAMES.npmSmoke(String(leg["platform"]))),
      RELEASE_NAMES.oldNode,
      ...(image ? [RELEASE_NAMES.image] : []),
    ];
    if (names.some((name) => state(name) === "starved")) {
      const todo = (name: string): boolean => state(name) !== "done";
      release = {
        bundle: rehearsal.platforms.filter((leg) =>
          todo(RELEASE_NAMES.bundle(String(leg["platform"]))),
        ),
        smoke: rehearsal.platforms.filter((leg) =>
          todo(RELEASE_NAMES.smoke(String(leg["platform"]))),
        ),
        packages: todo(RELEASE_NAMES.packages),
        npmSmoke: rehearsal.npmSmoke.filter((leg) =>
          todo(RELEASE_NAMES.npmSmoke(String(leg["platform"]))),
        ),
        oldNode: todo(RELEASE_NAMES.oldNode),
        image: image && todo(RELEASE_NAMES.image),
      };
      eligible.push("release");
    }
  }

  const blocked = [...failed, ...missing.map((name) => `${name}: no job`)];
  const starved = completed.filter((job) => starvedIds.has(job.id));
  if (blocked.length > 0) return { ...nothing(), starved, blocked };
  return { retry, release, eligible, starved, blocked: [] };
}

/** A selection that retries nothing. */
function nothing(): Selection {
  return {
    retry: Object.fromEntries(RETRIED.map((name) => [name, []])) as unknown as Record<
      Retried,
      readonly Leg[]
    >,
    release: null,
    eligible: [],
    starved: [],
    blocked: [],
  };
}

/** How long to wait before the retry: until {@link WAIT_MINUTES} after the last cancellation. */
export function waitMs(starved: readonly ApiJob[], now: number): number {
  const last = Math.max(
    ...starved.map((job) => Date.parse(job.completed_at ?? "")).filter(Number.isFinite),
  );
  if (!Number.isFinite(last)) return WAIT_MINUTES * 60_000;
  return Math.min(WAIT_MINUTES * 60_000, Math.max(0, last + WAIT_MINUTES * 60_000 - now));
}

/** The `$GITHUB_OUTPUT` lines of a selection. */
export function outputLines(selection: Selection): string[] {
  return [
    ...RETRIED.map((name) => `${name}=${JSON.stringify(selection.retry[name])}`),
    `release=${selection.release ? JSON.stringify(selection.release) : ""}`,
    `eligible=${JSON.stringify(selection.eligible)}`,
  ];
}

/**
 * The run's summary of a selection, from the plan's legs and counts alone: a job's name as the
 * API lists it is never written to a file (the log has it).
 */
export function summaryText(selection: Selection): string {
  const legs = RETRIED.flatMap((name) => selection.retry[name].map((leg) => legName(name, leg)));
  const release = selection.release;
  const parts = release
    ? [
        ...release.bundle.map((leg) => `bundle (${leg["platform"]})`),
        ...release.smoke.map((leg) => `smoke (${leg["platform"]})`),
        ...(release.packages ? ["packages"] : []),
        ...release.npmSmoke.map((leg) => `npm-smoke (${leg["platform"]})`),
        ...(release.oldNode ? ["npm-old-node"] : []),
        ...(release.image ? ["image"] : []),
      ]
    : [];
  const lines = ["### Legs GitHub gave no runner (#210)", ""];
  if (selection.blocked.length > 0)
    lines.push(
      `Nothing retried: ${selection.blocked.length} other job(s) failed for their own reasons, so ci-ok fails anyway (the job's log names them).`,
    );
  else if (selection.eligible.length === 0) lines.push("None.");
  else
    lines.push(
      "Retried after a wait:",
      "",
      ...legs.map((name) => `- ${name}`),
      ...(parts.length > 0 ? [`- release rehearsal: ${parts.join(", ")}`] : []),
    );
  return `${lines.join("\n")}\n`;
}

/** A job's result in `toJSON(needs)`. */
export interface Need {
  readonly result: string;
  readonly outputs?: Readonly<Record<string, string>>;
}

/**
 * `ci-ok`'s decision over `toJSON(needs)`. A gate passes when it passed or the plan left it out
 * (`success` or `skipped`); any other result, `abandoned` included, fails it (D152 item 9), unless
 * the `starved` job named it and its retry twin passed. The plan must have passed, and `starved`
 * and every retry twin must have passed or been skipped.
 */
export function verdict(needs: Readonly<Record<string, Need>>): {
  readonly ok: boolean;
  readonly lines: readonly string[];
} {
  const names = Object.keys(needs).sort();
  if (names.length === 0) return { ok: false, lines: ["no job results"] };
  const starved = needs["starved"];
  let eligible: string[] = [];
  if (starved?.result === "success") {
    try {
      const parsed = JSON.parse(starved.outputs?.["eligible"] ?? "[]") as unknown;
      if (Array.isArray(parsed)) eligible = parsed.map(String);
    } catch {
      eligible = [];
    }
  }
  const lines: string[] = [];
  let ok = true;
  for (const name of names) {
    const result = needs[name]?.result ?? "";
    let good: boolean;
    let why = result;
    if (name === "plan") good = result === "success";
    else if (name === "starved" || name.endsWith("-retry")) good = DONE.has(result);
    else if (DONE.has(result)) good = true;
    else {
      good = eligible.includes(name) && needs[`${name}-retry`]?.result === "success";
      why = good
        ? `${result}, GitHub gave a leg no runner and its retry passed (#210)`
        : `${result}${eligible.includes(name) ? `, its retry ${needs[`${name}-retry`]?.result ?? "missing"}` : ""}`;
    }
    lines.push(`${good ? "ok  " : "FAIL"} ${name}: ${why}`);
    ok &&= good;
  }
  return { ok, lines };
}

/** Every page of a GitHub API list. */
async function list<T>(url: string, key: string | null, token: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const response = await request(
      `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      token,
    );
    const batch = (key ? (response as Record<string, unknown>)[key] : response) as T[];
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function request(url: string, token: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (response.ok) return response.json();
    // GitHub's API answers 5xx now and then (fork 5's job fetch met several 502s).
    if (response.status >= 500 && attempt < 4) {
      await sleep(attempt * 5000);
      continue;
    }
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      jobs: { type: "string" },
      annotations: { type: "string" },
      "no-wait": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (command === "verdict") {
    const { ok, lines } = verdict(JSON.parse(process.env["NEEDS"] ?? "{}") as Record<string, Need>);
    console.log(lines.join("\n"));
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (command !== "select") throw new Error("usage: starved.ts select|verdict");
  const plan = JSON.parse(process.env["PLAN"] ?? "{}") as PlanOutputs;
  let jobs: ApiJob[];
  let annotations: Map<number, Annotation[]>;
  if (values.jobs) {
    const recorded = JSON.parse(readFileSync(values.jobs, "utf8")) as
      | { jobs?: ApiJob[] }
      | ApiJob[];
    jobs = Array.isArray(recorded) ? recorded : (recorded.jobs ?? []);
    const notes = values.annotations
      ? (JSON.parse(readFileSync(values.annotations, "utf8")) as Record<string, Annotation[]>)
      : {};
    annotations = new Map(Object.entries(notes).map(([id, list]) => [Number(id), list]));
  } else {
    const repo = process.env["GITHUB_REPOSITORY"];
    const run = process.env["GITHUB_RUN_ID"];
    const attempt = process.env["GITHUB_RUN_ATTEMPT"] ?? "1";
    const token = process.env["GH_TOKEN"] ?? "";
    const api = `https://api.github.com/repos/${repo}`;
    jobs = await list<ApiJob>(`${api}/actions/runs/${run}/attempts/${attempt}/jobs`, "jobs", token);
    annotations = new Map();
    for (const job of jobs.filter(cancelledUnstarted))
      annotations.set(
        job.id,
        await list<Annotation>(`${api}/check-runs/${job.id}/annotations`, null, token),
      );
  }
  const selection = select(plan, jobs, annotations);
  // The log names what the API listed; the run's summary (a file) only what the plan named.
  console.log(
    [
      ...selection.starved.map((job) => `starved: ${job.name}, cancelled ${job.completed_at}`),
      ...selection.blocked.map((line) => `not retried, because of ${line}`),
    ].join("\n") || "No leg GitHub gave no runner.",
  );
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, summaryText(selection));
  if (selection.eligible.length > 0 && !values["no-wait"]) {
    const ms = waitMs(selection.starved, Date.now());
    console.log(`Waiting ${Math.round(ms / 1000)} s before the retry.`);
    await sleep(ms);
  }
  const output = process.env["GITHUB_OUTPUT"];
  const lines = outputLines(selection);
  if (output) appendFileSync(output, `${lines.join("\n")}\n`);
  else console.log(lines.join("\n"));
}

if (import.meta.main) await main();
