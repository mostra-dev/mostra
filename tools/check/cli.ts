#!/usr/bin/env node
/**
 * `pnpm check`: every CI gate, locally, in parallel.
 *
 *   pnpm check                     all jobs, all packages
 *   pnpm check --affected          only what the change since origin/main affects
 *   pnpm check --fast              types, unit tests and boundaries (the pre-push hook)
 *   pnpm check --job <name>        one job, as its CI job runs it (repeatable)
 *   pnpm check --base <ref>        compare against <ref> instead of origin/main
 *   pnpm check --plan [--json]     print which jobs and packages would run, then stop
 *   pnpm check --verbose           print the output of passing jobs too
 *   pnpm check --stream            print Turbo's output as it arrives, so a job a CI runner cancels
 *                                  for its time limit still shows where it was (the integration jobs)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fromRoot, runStreaming } from "../lib/repo.ts";
import { JOB_NAMES, JOBS, type Job, type JobName, WINDOWS_PACKAGES } from "./jobs.ts";
import { makePlan, type Plan } from "./plan.ts";

const { values } = parseArgs({
  options: {
    affected: { type: "boolean", default: false },
    fast: { type: "boolean", default: false },
    job: { type: "string", multiple: true },
    base: { type: "string" },
    plan: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    stream: { type: "boolean", default: false },
  },
  strict: true,
});

for (const name of values.job ?? []) {
  if (!(JOB_NAMES as readonly string[]).includes(name)) {
    console.error(`Unknown job "${name}". Jobs: ${JOB_NAMES.join(", ")}.`);
    process.exit(2);
  }
}

if (values.base) process.env["MOSTRA_BASE"] = values.base;
const plan = makePlan({
  affected: values.affected || values.fast,
  ...(values.base ? { base: values.base } : {}),
});
// Every gate compares against the same commit: Turbo hashes MOSTRA_BASE for the api and schemas
// tasks (turbo.json `env`),
// so a cached api or schemas result is never replayed against a different base.
if (plan.base) process.env["MOSTRA_BASE"] = plan.base;
const selected = JOBS.filter((job) => {
  if (values.job?.length) return values.job.includes(job.name);
  if (values.fast) return job.fast === true;
  return true;
});
const applicable = selected.filter((job) => job.applies(plan));
const skipped = selected.filter((job) => !job.applies(plan));

if (values.plan) {
  const report = {
    base: plan.base ?? null,
    packages: plan.packages,
    jobs: applicable.map((job) => job.name),
    skipped: skipped.map((job) => job.name),
  };
  if (values.json) console.log(JSON.stringify(report));
  else {
    console.log(`base: ${report.base ?? "(none: full run)"}`);
    console.log(
      `packages: ${plan.packages === "all" ? "all" : plan.packages.join(", ") || "none"}`,
    );
    console.log(`jobs: ${report.jobs.join(", ") || "none"}`);
    if (report.skipped.length) console.log(`skipped: ${report.skipped.join(", ")}`);
  }
  process.exit(0);
}

interface Outcome {
  readonly job: JobName;
  readonly ok: boolean;
  readonly ms: number;
  readonly output: string[];
}

/** Runs a job's repository-level steps in order, stopping at the first failure. */
async function runSteps(job: Job, current: Plan): Promise<Outcome> {
  const started = Date.now();
  const output: string[] = [];
  for (const step of job.steps?.(current) ?? []) {
    output.push(`$ ${step.label}: ${step.command} ${step.args.join(" ")}`);
    const code = await runStreaming(step.command, step.args, (line) => output.push(line), {
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    if (code !== 0) {
      output.push(`✗ ${step.label} exited with ${code}`);
      return { job: job.name, ok: false, ms: Date.now() - started, output };
    }
  }
  return { job: job.name, ok: true, ms: Date.now() - started, output };
}

interface TurboTask {
  taskId: string;
  task: string;
  package: string;
  command: string;
  dependencies?: string[];
  cache?: { status?: string };
  execution?: { exitCode?: number };
}

/** Runs every selected job's workspace tasks in one Turborepo invocation, then splits results. */
async function runTasks(jobs: readonly Job[], current: Plan): Promise<Outcome[]> {
  if (jobs.length === 0) return [];
  const started = Date.now();
  const tasks = [...new Set(jobs.flatMap((job) => job.tasks ?? []))];
  // Windows runs only the packages ported to it so far (WP-W1 to WP-W3, D146).
  const packages =
    process.platform !== "win32"
      ? current.packages
      : (current.packages === "all" ? [...WINDOWS_PACKAGES] : current.packages).filter((name) =>
          WINDOWS_PACKAGES.includes(name),
        );
  if (packages !== "all" && packages.length === 0) {
    return jobs.map((job) => ({
      job: job.name,
      ok: true,
      ms: 0,
      output: ["No package of this job runs on Windows yet."],
    }));
  }
  const filters = packages === "all" ? [] : packages.map((name) => `--filter=${name}`);
  const runsDir = fromRoot(".turbo", "runs");
  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  const output: string[] = [];
  // Turbo's own launcher through Node.js, which runs on every platform (the `.bin` shim is a
  // shell script on POSIX and a `.cmd` file on Windows).
  const code = await runStreaming(
    process.execPath,
    [
      fromRoot("node_modules/turbo/bin/turbo"),
      "run",
      ...tasks,
      ...filters,
      "--continue",
      "--summarize",
      // Streaming needs every task's lines as they come; otherwise only a failure's, at its end.
      values.stream ? "--output-logs=full" : "--output-logs=errors-only",
      // On GitHub Actions Turbo groups each task's lines and prints them when it ends, which is
      // what --stream is there to avoid (#55: a cancelled run showed every task but the hung one).
      ...(values.stream ? ["--log-order=stream"] : []),
      "--ui=stream",
    ],
    (line) => {
      output.push(line);
      if (values.stream) console.log(line);
    },
    { env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TURBO_TELEMETRY_DISABLED: "1" } },
  );
  const summaryFile = existsSync(runsDir)
    ? readdirSync(runsDir).find((file) => file.endsWith(".json"))
    : undefined;
  const summary = summaryFile
    ? (JSON.parse(readFileSync(join(runsDir, summaryFile), "utf8")) as { tasks: TurboTask[] })
    : undefined;
  const ms = Date.now() - started;
  const tasksById = new Map((summary?.tasks ?? []).map((task) => [task.taskId, task]));
  const failedTask = (task: TurboTask): boolean =>
    task.command !== "<NONEXISTENT>" &&
    task.cache?.status !== "HIT" &&
    (task.execution === undefined || task.execution.exitCode !== 0);
  const anyFailed = (summary?.tasks ?? []).some(failedTask);
  return jobs.map((job) => {
    const own = (summary?.tasks ?? []).filter(
      (task) => job.tasks?.includes(task.task) && task.command !== "<NONEXISTENT>",
    );
    // A job fails when one of its tasks failed or never ran, or when a task it depends on
    // failed. If Turbo itself failed without a failing task to blame, every task job fails.
    const blamed = own.filter(
      (task) =>
        failedTask(task) ||
        (task.dependencies ?? []).some((id) => {
          const dependency = tasksById.get(id);
          return dependency !== undefined && failedTask(dependency);
        }),
    );
    const ok = summary !== undefined && blamed.length === 0 && (code === 0 || anyFailed);
    const lines = [
      `tasks: ${own.map((task) => `${task.taskId} (${task.cache?.status === "HIT" ? "cached" : "ran"})`).join(", ") || "none"}`,
      ...(ok
        ? []
        : [
            `failed: ${blamed.map((task) => task.taskId).join(", ") || `turbo exited ${code}`}`,
            // Already printed as it arrived.
            ...(values.stream ? [] : output),
          ]),
    ];
    return { job: job.name, ok, ms, output: lines };
  });
}

const taskJobs = applicable.filter((job) => job.tasks);
const stepJobs = applicable.filter((job) => job.steps);
console.log(
  `pnpm check: ${applicable.map((job) => job.name).join(", ") || "nothing to run"}` +
    (plan.packages === "all" ? "" : ` (packages: ${plan.packages.join(", ") || "none"})`),
);
// Jobs that must run alone (the browsers) start once the other task jobs are done.
const together = taskJobs.filter((job) => !job.alone);
const alone = taskJobs.filter((job) => job.alone);
const outcomes = (
  await Promise.all([
    runTasks(together, plan).then(async (first) => [...first, ...(await runTasks(alone, plan))]),
    ...stepJobs.map((job) => runSteps(job, plan)),
  ])
).flat();

let failed = 0;
for (const outcome of outcomes) {
  if (!outcome.ok) failed++;
  if (!outcome.ok || values.verbose) {
    console.log(`\n── ${outcome.job} ${outcome.ok ? "passed" : "FAILED"} ──`);
    for (const line of outcome.output) console.log(line);
  }
}
console.log("");
for (const name of JOB_NAMES) {
  const outcome = outcomes.find((candidate) => candidate.job === name);
  if (outcome) {
    console.log(`${outcome.ok ? "✓" : "✗"} ${name.padEnd(12)} ${(outcome.ms / 1000).toFixed(1)}s`);
  } else if (skipped.some((job) => job.name === name)) {
    console.log(`- ${name.padEnd(12)} skipped (not affected)`);
  }
}
process.exit(failed > 0 ? 1 : 0);
