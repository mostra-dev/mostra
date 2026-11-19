import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Leg } from "../check/matrix.ts";
import {
  type Annotation,
  type ApiJob,
  isStarved,
  legName,
  type Need,
  NOT_ACQUIRED,
  RELEASE_NAMES,
  RETRIED,
  select,
  verdict,
  WAIT_MINUTES,
  waitMs,
} from "../check/starved.ts";
import { fromRoot } from "../lib/repo.ts";

/**
 * Two runs of #185 (WP-17) that GitHub starved on 2026-11-18, as its API listed them (#210): a
 * pull request's full run, and a merge-group run that also failed for its own reasons.
 */
interface Recorded {
  readonly plan: Record<string, string>;
  readonly jobs: ApiJob[];
  readonly annotations: Record<string, Annotation[]>;
  /** A job the queue's own concurrency cancelled before it got a runner (run 41677550364). */
  readonly concurrencyCancel: Annotation[];
}

const recorded = (run: number): Recorded =>
  JSON.parse(
    readFileSync(fromRoot(`tools/test/fixtures/starved/run-${run}.json`), "utf8"),
  ) as Recorded;

/** The run as the `starved` job sees it: every gate done, `ci-ok` not yet started. */
const beforeCiOk = (run: Recorded): ApiJob[] => run.jobs.filter((job) => job.name !== "ci-ok");

const notes = (run: Recorded): Map<number, Annotation[]> =>
  new Map(Object.entries(run.annotations).map(([id, list]) => [Number(id), list]));

const names = (legs: readonly Leg[], job: (typeof RETRIED)[number]): string[] =>
  legs.map((leg) => legName(job, leg)).sort();

describe("the legs GitHub gave no runner (#210)", () => {
  const pull = recorded(44352487359);
  const queue = recorded(44352550866);

  it("picks exactly the starved legs of a pull request's run, and the rehearsal's starved smoke test", () => {
    const selection = select(pull.plan, beforeCiOk(pull), notes(pull));
    expect(selection.blocked).toEqual([]);
    expect(selection.starved.map((job) => job.name).sort()).toEqual([
      "conformance (macos)",
      "e2e (macos, chromium)",
      "integration (macos, remote)",
      "integration (macos, verify-failures)",
      "release / smoke (darwin-arm64, no Node.js)",
    ]);
    expect(names(selection.retry.conformance, "conformance")).toEqual(["conformance (macos)"]);
    expect(names(selection.retry.integration, "integration")).toEqual([
      "integration (macos, remote)",
      "integration (macos, verify-failures)",
    ]);
    expect(names(selection.retry.e2e, "e2e")).toEqual(["e2e (macos, chromium)"]);
    expect(selection.retry.rust).toEqual([]);
    expect(selection.retry.windows).toEqual([]);
    // The retried legs are the plan's own, marked so their artifacts get their own names.
    const plan = JSON.parse(pull.plan["integration"] ?? "[]") as Leg[];
    for (const leg of selection.retry.integration) {
      const { retry, ...original } = leg;
      expect(retry).toBe("1");
      expect(plan).toContainEqual(original);
    }
    // Only the smoke test is left of the rehearsal: everything else passed and is kept.
    expect(selection.release).toEqual({
      bundle: [],
      smoke: [{ platform: "darwin-arm64", runner: "macos-15" }],
      packages: false,
      npmSmoke: [],
      oldNode: false,
      image: false,
    });
    expect([...selection.eligible].sort()).toEqual([
      "conformance",
      "e2e",
      "integration",
      "release",
    ]);
  });

  it("retries nothing when another job failed for its own reasons: ci-ok fails anyway", () => {
    const selection = select(queue.plan, beforeCiOk(queue), notes(queue));
    expect(selection.starved).toHaveLength(5);
    expect(selection.blocked).toEqual([
      "integration (windows-x64, windows-remote): failure",
      "e2e (windows-x64, firefox, 2/2): failure",
    ]);
    expect(selection.eligible).toEqual([]);
    expect(selection.release).toBeNull();
    for (const name of RETRIED) expect(selection.retry[name], name).toEqual([]);
  });

  it("redoes a starved bundle and what waited on it, and only that", () => {
    // The merge-group run as it would have been without its own failures.
    const jobs = beforeCiOk(queue).map((job) =>
      job.conclusion === "failure" ? { ...job, conclusion: "success" } : job,
    );
    const selection = select(queue.plan, jobs, notes(queue));
    expect(selection.blocked).toEqual([]);
    expect(names(selection.retry.rust, "rust")).toEqual(["rust (macos)"]);
    expect(names(selection.retry.e2e, "e2e")).toEqual(["e2e (macos, webkit)"]);
    expect(names(selection.retry.integration, "integration")).toEqual([
      "integration (macos, verify)",
      "integration (macos, verify-failures)",
    ]);
    const rehearsal = JSON.parse(queue.plan["release"] ?? "null") as {
      platforms: Leg[];
      npmSmoke: Leg[];
    };
    // The darwin-arm64 bundle starved, so every smoke test, the packing and the npm path waited
    // on it and never ran; the other bundles passed and are reused.
    expect(selection.release).toEqual({
      bundle: [{ platform: "darwin-arm64", runner: "macos-15" }],
      smoke: rehearsal.platforms,
      packages: true,
      npmSmoke: rehearsal.npmSmoke,
      oldNode: true,
      image: true,
    });
  });

  it("never takes a concurrency cancel, a timeout or a failure for a starved leg", () => {
    const starved = pull.jobs.find((job) => job.name === "conformance (macos)") as ApiJob;
    const own = pull.annotations[String(starved.id)] ?? [];
    expect(isStarved(starved, own)).toBe(true);
    // Cancelled by a newer run of the same group before it got a runner: GitHub adds the same
    // capacity notice, but not the annotation that it never acquired a runner.
    expect(isStarved(starved, pull.concurrencyCancel)).toBe(false);
    // A job cancelled at its own limit, or by a newer run while it ran, had a runner and steps.
    expect(isStarved({ ...starved, runner_name: "GitHub Actions 1000020996" }, own)).toBe(false);
    expect(isStarved({ ...starved, steps: [{}] }, own)).toBe(false);
    expect(isStarved({ ...starved, conclusion: "failure" }, own)).toBe(false);
    expect(isStarved({ ...starved, conclusion: "timed_out" }, own)).toBe(false);
    // The whole run as a concurrency cancel would leave it: nothing is a starved leg, so nothing is
    // retried and the cancelled gates fail ci-ok as before.
    const cancelled = new Map(
      Object.keys(pull.annotations).map((id) => [Number(id), pull.concurrencyCancel]),
    );
    const selection = select(pull.plan, beforeCiOk(pull), cancelled);
    expect(selection.starved).toEqual([]);
    expect(selection.eligible).toEqual([]);
    expect(selection.blocked.length).toBeGreaterThan(0);
  });

  it("retries nothing when a leg the plan listed has no job of its name", () => {
    // A job renamed in ci.yml but not here would leave its legs unmatched: refuse, never guess.
    const jobs = beforeCiOk(pull).filter((job) => job.name !== "integration (linux, core)");
    const selection = select(pull.plan, jobs, notes(pull));
    expect(selection.blocked).toEqual(["integration (linux, core): no job"]);
    expect(selection.eligible).toEqual([]);
  });

  it("names every leg as GitHub listed it", () => {
    // Each plan leg of both runs has a job of exactly the name legName gives it.
    for (const run of [pull, queue]) {
      const listed = new Set(run.jobs.map((job) => job.name));
      for (const job of RETRIED)
        for (const leg of JSON.parse(run.plan[job] ?? "[]") as Leg[])
          expect(listed.has(legName(job, leg)), legName(job, leg)).toBe(true);
      const rehearsal = JSON.parse(run.plan["release"] ?? "null") as { platforms: Leg[] };
      for (const leg of rehearsal.platforms)
        expect(listed.has(RELEASE_NAMES.bundle(String(leg["platform"])))).toBe(true);
      expect(listed.has(RELEASE_NAMES.packages)).toBe(true);
      expect(listed.has(RELEASE_NAMES.oldNode)).toBe(true);
      expect(listed.has(RELEASE_NAMES.image)).toBe(true);
    }
    // The skipped jobs of a matrix that waited on a starved one keep their template's name, so
    // they never match a leg: the release's are redone from the plan, not from the list.
    expect(queue.jobs.map((job) => job.name)).toContain(
      `release / smoke (\${{ matrix.platform }}, no Node.js)`,
    );
    for (const name of ["smoke", "npmSmoke"] as const)
      expect(RELEASE_NAMES[name]("darwin-arm64")).toMatch(/darwin-arm64/);
  });

  it("waits until 10 minutes after the last starved leg was cancelled, no longer", () => {
    const at = (iso: string): ApiJob => ({
      id: 1,
      name: "x",
      status: "completed",
      conclusion: "cancelled",
      runner_name: "",
      steps: [],
      completed_at: iso,
    });
    const now = Date.parse("2026-11-18T18:00:00Z");
    expect(waitMs([at("2026-11-18T17:57:00Z"), at("2026-11-18T17:30:00Z")], now)).toBe(7 * 60_000);
    expect(waitMs([at("2026-11-18T17:30:00Z")], now)).toBe(0);
    expect(waitMs([at("2026-11-18T18:00:00Z")], now)).toBe(WAIT_MINUTES * 60_000);
  });

  it("matches GitHub's own words", () => {
    const messages = Object.values(pull.annotations)
      .flat()
      .map((note) => note.message ?? "");
    expect(messages.filter((message) => message.includes(NOT_ACQUIRED))).toHaveLength(5);
  });
});

describe("ci-ok's verdict (D152 item 9, #210)", () => {
  const gates = (overrides: Record<string, Need> = {}): Record<string, Need> => ({
    plan: { result: "success" },
    static: { result: "success" },
    unit: { result: "success" },
    integration: { result: "success" },
    release: { result: "skipped" },
    "dependency-review": { result: "skipped" },
    starved: { result: "skipped" },
    "integration-retry": { result: "skipped" },
    "release-retry": { result: "skipped" },
    ...overrides,
  });
  const starved = (eligible: string[]): Need => ({
    result: "success",
    outputs: { eligible: JSON.stringify(eligible) },
  });

  it("passes when every gate passed or the plan left it out", () => {
    expect(verdict(gates()).ok).toBe(true);
  });

  it("passes a starved gate only when the starved job named it and its retry passed", () => {
    const redeemed = verdict(
      gates({
        integration: { result: "abandoned" },
        starved: starved(["integration"]),
        "integration-retry": { result: "success" },
      }),
    );
    expect(redeemed.ok).toBe(true);
    expect(redeemed.lines.join("\n")).toMatch(
      /integration: abandoned, GitHub gave a leg no runner/,
    );
    // The retry failed, or never ran.
    for (const retry of ["failure", "cancelled", "skipped", "abandoned"])
      expect(
        verdict(
          gates({
            integration: { result: "abandoned" },
            starved: starved(["integration"]),
            "integration-retry": { result: retry },
          }),
        ).ok,
        retry,
      ).toBe(false);
    // Not named: a gate that didn't pass for any other reason still fails.
    expect(
      verdict(
        gates({
          integration: { result: "abandoned" },
          starved: starved([]),
          "integration-retry": { result: "skipped" },
        }),
      ).ok,
    ).toBe(false);
    // The starved job itself failed: its list can't be trusted.
    expect(
      verdict(
        gates({
          integration: { result: "abandoned" },
          starved: { result: "failure", outputs: { eligible: '["integration"]' } },
          "integration-retry": { result: "success" },
        }),
      ).ok,
    ).toBe(false);
  });

  it("fails on a failure, a cancelled gate, any result GitHub adds, a failed plan or nothing at all", () => {
    for (const result of ["failure", "cancelled", "abandoned", "neutral", ""])
      expect(verdict(gates({ unit: { result } })).ok, result).toBe(false);
    expect(verdict(gates({ plan: { result: "failure" } })).ok).toBe(false);
    expect(verdict(gates({ "integration-retry": { result: "failure" } })).ok).toBe(false);
    expect(verdict({}).ok).toBe(false);
  });
});

describe("the retry twins in ci.yml (#210)", () => {
  interface Job {
    name?: string;
    needs?: string | string[];
    if?: string;
    "runs-on"?: string;
    "timeout-minutes"?: number | string;
    env?: unknown;
    defaults?: unknown;
    steps?: unknown[];
    strategy?: { matrix?: { leg?: string } };
    uses?: string;
    with?: Record<string, unknown>;
    outputs?: Record<string, string>;
  }
  const workflow = parse(readFileSync(fromRoot(".github/workflows/ci.yml"), "utf8")) as {
    jobs: Record<string, Job>;
  };
  const jobs = workflow.jobs;

  it("runs each starved leg with its gate's own steps, limits and machine", () => {
    for (const name of RETRIED) {
      const gate = jobs[name] as Job;
      const twin = jobs[`${name}-retry`] as Job;
      expect(twin, name).toBeDefined();
      expect(twin.steps, name).toEqual(gate.steps);
      expect(twin["runs-on"], name).toBe(gate["runs-on"]);
      expect(twin["timeout-minutes"], name).toEqual(gate["timeout-minutes"]);
      expect(twin.env, name).toEqual(gate.env);
      expect(twin.defaults, name).toEqual(gate.defaults);
      expect(twin.name, name).toBe(`retry · ${gate.name}`);
      expect(twin.strategy?.matrix?.leg, name).toBe(
        `\${{ fromJSON(needs.starved.outputs.${name}) }}`,
      );
      expect(twin.needs, name).toEqual(["plan", "starved"]);
      expect(jobs["starved"]?.outputs?.[name], name).toBe(`\${{ steps.select.outputs.${name} }}`);
    }
  });

  it("renders each gate's legs under the names the starved job looks for", () => {
    expect(jobs["rust"]?.name).toBe(`rust (\${{ matrix.leg.os }})`);
    expect(jobs["conformance"]?.name).toBe(`conformance (\${{ matrix.leg.os }})`);
    expect(jobs["integration"]?.name).toBe(
      `integration (\${{ matrix.leg.os }}, \${{ matrix.leg.group }})`,
    );
    expect(jobs["windows"]?.name).toBe(
      `\${{ matrix.leg.job }} (\${{ matrix.leg.os }}\${{ matrix.leg.job == 'integration' && format(', {0}', matrix.leg.group) || '' }})`,
    );
    expect(jobs["e2e"]?.name).toBe(
      `e2e (\${{ matrix.leg.os }}, \${{ matrix.leg.browser }}\${{ matrix.leg.shard && format(', {0}', matrix.leg.shard) || '' }})`,
    );
    expect(jobs["release"]?.name).toBe("release");
  });

  it("re-calls the rehearsal with what is left of it, otherwise as the gate calls it", () => {
    const gate = jobs["release"] as Job;
    const twin = jobs["release-retry"] as Job;
    expect(twin.uses).toBe(gate.uses);
    const { resume, ...rest } = twin.with ?? {};
    expect(rest).toEqual(gate.with);
    expect(resume).toBe(`\${{ needs.starved.outputs.release }}`);
  });

  it("runs the starved job after every gate, and only when one didn't pass", () => {
    const starved = jobs["starved"] as Job;
    const gates = Object.keys(jobs).filter(
      (name) => !["starved", "ci-ok"].includes(name) && !name.endsWith("-retry"),
    );
    expect([...(starved.needs as string[])].sort()).toEqual(gates.sort());
    expect(starved.if).toContain("!cancelled()");
    for (const result of ["abandoned", "cancelled", "failure"])
      expect(starved.if).toContain(`contains(needs.*.result, '${result}')`);
  });
});
