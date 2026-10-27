/**
 * What CI runs, and where (D152): the runner choice, the layout of a run, and the workflow's
 * shape. Each rule here has a seed in its comment's terms: the test goes red when the rule is
 * broken (MT-01's evidence).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ciEvent, NIGHTLY_COVERS_MS, nightlyCovers, outputLines } from "../check/ci.ts";
import { JOBS } from "../check/jobs.ts";
import { ciMatrix, ciScope, FULL_LABEL, MACOS_PULL_REQUEST_LEGS } from "../check/matrix.ts";
import type { Plan } from "../check/plan.ts";
import {
  BLACKSMITH_LINUX,
  chooseRunners,
  GITHUB_RUNNERS,
  pageStatus,
  type RunnerInputs,
  type Runners,
  usageMinutes,
} from "../check/runners.ts";
import { fromRoot } from "../lib/repo.ts";

const inputs = (over: Partial<RunnerInputs> = {}): RunnerInputs => ({
  policy: undefined,
  trusted: true,
  status: "UP",
  usage: 100,
  budget: 6000,
  threshold: 0.9,
  ...over,
});

describe("the runner choice (D152)", () => {
  it("uses Blacksmith for Linux while the month's usage is under its threshold", () => {
    const runners = chooseRunners(inputs({ usage: 5399 }));
    expect(runners.pool).toBe("blacksmith");
    expect(runners.linux).toEqual(BLACKSMITH_LINUX);
    // macOS and Windows never leave GitHub's runners.
    expect(runners.macos).toBe(GITHUB_RUNNERS.macos);
    expect(runners.windows).toEqual(GITHUB_RUNNERS.windows);
  });

  it("falls back to GitHub at the threshold, and on every doubt", () => {
    const github = (over: Partial<RunnerInputs>): string => {
      const runners = chooseRunners(inputs(over));
      expect(runners.linux).toEqual(GITHUB_RUNNERS.linux);
      return runners.pool;
    };
    expect(github({ usage: 5400 })).toBe("github");
    expect(github({ usage: 99999 })).toBe("github");
    expect(github({ usage: undefined })).toBe("github");
    expect(github({ status: undefined })).toBe("github");
    expect(github({ status: "HASISSUES" })).toBe("github");
    expect(github({ trusted: false })).toBe("github");
    expect(github({ policy: "github" })).toBe("github");
    expect(github({ policy: "blacksmiths" })).toBe("github");
    expect(github({ budget: Number.NaN })).toBe("github");
    expect(github({ threshold: 0 })).toBe("github");
    expect(github({ threshold: 1.5 })).toBe("github");
  });

  it("lets CI_RUNNERS=blacksmith pass the budget, never a fork's run or an outage", () => {
    expect(chooseRunners(inputs({ policy: "blacksmith", usage: 99999 })).pool).toBe("blacksmith");
    expect(chooseRunners(inputs({ policy: "blacksmith", usage: undefined })).pool).toBe(
      "blacksmith",
    );
    expect(chooseRunners(inputs({ policy: "blacksmith", trusted: false })).pool).toBe("github");
    expect(chooseRunners(inputs({ policy: "blacksmith", status: "DOWN" })).pool).toBe("github");
  });

  it("reads Blacksmith's usage and status, and nothing else", () => {
    expect(usageMinutes('{"summary":{"billing_minutes":12.5}}')).toBe(12.5);
    expect(usageMinutes('{"summary":{"billing_minutes":"12"}}')).toBeUndefined();
    expect(usageMinutes('{"summary":{"billing_minutes":-1}}')).toBeUndefined();
    expect(usageMinutes("not json")).toBeUndefined();
    expect(usageMinutes(undefined)).toBeUndefined();
    expect(pageStatus('{"page":{"status":"UP"}}')).toBe("UP");
    expect(pageStatus('{"page":{}}')).toBeUndefined();
    expect(pageStatus("<html>")).toBeUndefined();
  });
});

const github: Runners = { pool: "github", reason: "test", ...GITHUB_RUNNERS };
const blacksmith: Runners = { ...github, pool: "blacksmith", linux: BLACKSMITH_LINUX };

/** A plan for a change to `files`, affecting `packages`. */
const change = (files: string[], packages: string[]): Plan => ({
  base: "base",
  changed: files,
  packages,
});
const everything: Plan = { base: "base", changed: "all", packages: "all" };

const pr = ciScope({ name: "pull_request" });
const queue = ciScope({ name: "merge_group" });

describe("what runs when (D152)", () => {
  it("runs nothing for a bot's draft, and everything once it is ready", () => {
    const draft = ciScope({ name: "pull_request", draft: true, bot: true });
    expect(draft.run).toBe(false);
    const matrix = ciMatrix(draft, everything, github);
    expect([matrix.static, matrix.unit, matrix.windows, matrix.e2e].flat()).toEqual([]);
    expect(matrix.release).toBeNull();
    expect(ciScope({ name: "pull_request", draft: false, bot: true }).run).toBe(true);
    // A person's draft runs (D76: work-package drafts get CI while they are built).
    expect(ciScope({ name: "pull_request", draft: true, bot: false }).run).toBe(true);
  });

  it("gives a pull request its affected jobs on the pull-request legs", () => {
    expect(pr).toMatchObject({ run: true, scope: "affected", legs: "pull-request" });
    const matrix = ciMatrix(pr, everything, github);
    expect(matrix.windows.map((leg) => leg["os"])).not.toContain("windows-arm64");
    expect(matrix.e2e.map((leg) => leg["os"])).not.toContain("windows-arm64");
    expect(matrix.windows.length).toBe(9);
    expect(matrix.e2e.filter((leg) => leg["os"] === "macos").map((leg) => leg["browser"])).toEqual([
      "webkit",
    ]);
    expect(
      ciMatrix(queue, everything, github).e2e.filter((leg) => leg["os"] === "macos"),
    ).toHaveLength(3);
  });

  it("gives a pull request at most five macOS legs, and the queue the rest", () => {
    const onMacos = (matrix: ReturnType<typeof ciMatrix>) =>
      [matrix.integration, matrix.e2e, matrix.rust, matrix.conformance]
        .flat()
        .filter((leg) => leg["os"] === "macos");
    // A runtime change: four integration groups, WebKit, the crate and the kit would be seven.
    const runtime = change(["packages/runtime/src/a.ts"], ["@mostra/runtime"]);
    const ordinary = ciMatrix(pr, runtime, github);
    expect(onMacos(ordinary)).toHaveLength(MACOS_PULL_REQUEST_LEGS);
    expect(ordinary.integration.filter((leg) => leg["os"] === "macos")).toHaveLength(4);
    expect(ordinary.e2e.filter((leg) => leg["os"] === "macos")).toHaveLength(1);
    expect(ordinary.deferred).toEqual(["rust (macos)", "conformance (macos)"]);
    // Linux and Windows x64 keep every leg (WP-W3), and the queue runs them all on macOS and
    // Windows arm64 too.
    expect(ordinary.rust.map((leg) => leg["os"])).toEqual(["linux", "windows-x64"]);
    expect(ordinary.conformance.map((leg) => leg["os"])).toEqual(["linux", "windows-x64"]);
    const queued = ciMatrix(queue, runtime, github);
    expect(onMacos(queued).length).toBeGreaterThan(MACOS_PULL_REQUEST_LEGS);
    for (const legs of [queued.rust, queued.conformance])
      expect(legs.map((leg) => leg["os"])).toEqual([
        "linux",
        "macos",
        "windows-x64",
        "windows-arm64",
      ]);
    expect(queued.deferred).toEqual([]);
    // A crate-only change fits: its macOS legs all stay.
    const crate = ciMatrix(pr, change(["crates/mostra-host/src/lib.rs"], []), github);
    expect(crate.deferred).toEqual([]);
    expect(crate.rust.map((leg) => leg["os"])).toContain("macos");
    expect(crate.conformance.map((leg) => leg["os"])).toContain("macos");
  });

  it("names each leg's Turbo cache apart from every other leg's on its OS (Opus review 9)", () => {
    const matrix = ciMatrix(queue, everything, github);
    const lists = {
      static: matrix.static,
      unit: matrix.unit,
      hygiene: matrix.hygiene,
      integration: matrix.integration,
      windows: matrix.windows,
      e2e: matrix.e2e,
      rust: matrix.rust,
      conformance: matrix.conformance,
    };
    const seen = new Set<string>();
    for (const [list, legs] of Object.entries(lists)) {
      for (const leg of legs) {
        expect(leg["cache"], list).toBeTruthy();
        const key = `${leg["os"] ?? "linux"} ${leg["cache"]}`;
        expect(seen.has(key), `${list}: ${key} twice`).toBe(false);
        seen.add(key);
      }
    }
    expect(matrix.integration.map((leg) => leg["cache"])).toContain("integration-verify-failures");
    expect(matrix.e2e.map((leg) => leg["cache"])).toContain("e2e-firefox-2of2");
  });

  it("gives the merge queue, the nightly run and ci:full every leg", () => {
    for (const scope of [
      queue,
      ciScope({ name: "schedule" }),
      ciScope({ name: "pull_request", labels: [FULL_LABEL] }),
      ciScope({ name: "workflow_dispatch" }),
    ]) {
      const matrix = ciMatrix(scope, everything, github);
      expect(matrix.legs).toBe("all");
      expect(matrix.windows.filter((leg) => leg["os"] === "windows-arm64").length).toBe(9);
      // Windows' slowest engines run in two parts each, together every test once.
      const parts = (os: string, browser: string): (string | undefined)[] =>
        matrix.e2e
          .filter((leg) => leg["os"] === os && leg["browser"] === browser)
          .map((leg) => leg["shard"]);
      expect(parts("windows-arm64", "chromium")).toEqual(["1/2", "2/2"]);
      expect(parts("windows-x64", "firefox")).toEqual(["1/2", "2/2"]);
      expect(parts("windows-x64", "chromium")).toEqual([undefined]);
      expect(parts("linux", "firefox")).toEqual([undefined]);
      expect(matrix.release?.platforms.length).toBe(6);
    }
    expect(queue.scope).toBe("affected");
    expect(ciScope({ name: "schedule" }).scope).toBe("all");
    expect(ciScope({ name: "workflow_dispatch", full: false }).scope).toBe("affected");
  });

  it("skips a nightly run on a commit whose nightly run passed", () => {
    expect(ciScope({ name: "schedule", alreadyPassed: true }).run).toBe(false);
  });

  it("keeps both cache stores warm: a nightly run on Blacksmith runs its Linux legs on GitHub's runners too (#86)", () => {
    const nightly = ciScope({ name: "schedule" });
    const lists = (matrix: ReturnType<typeof ciMatrix>) => ({
      static: matrix.static,
      unit: matrix.unit,
      hygiene: matrix.hygiene,
      integration: matrix.integration,
      e2e: matrix.e2e,
      rust: matrix.rust,
      conformance: matrix.conformance,
    });
    const both = ciMatrix(nightly, everything, blacksmith);
    const alone = ciMatrix(nightly, everything, github);
    for (const [list, legs] of Object.entries(lists(both))) {
      const onBlacksmith = legs.filter((leg) => leg.runner.startsWith("blacksmith"));
      const twins = legs.filter(
        (leg) => leg["os"] === "linux-github" || /GitHub's/.test(leg["names"] ?? ""),
      );
      expect(onBlacksmith.length, list).toBeGreaterThan(0);
      // Every Blacksmith leg has its twin on GitHub's runners, under the same Turborepo cache
      // name: the same key, in the other store.
      expect(twins.map((leg) => leg["cache"]).sort(), list).toEqual(
        onBlacksmith.map((leg) => leg["cache"]).sort(),
      );
      for (const twin of twins) expect(twin.runner, list).toMatch(/^ubuntu-latest$/);
      // macOS and Windows legs are GitHub's already: they get no twin.
      expect(legs.filter((leg) => leg["os"] === "macos").length, list).toBe(
        lists(alone)[list as keyof ReturnType<typeof lists>].filter((leg) => leg["os"] === "macos")
          .length,
      );
    }
    expect(both.windows).toEqual(alone.windows);
    // Leg names, and so the logs and traces their jobs upload, stay unique.
    const names = both.integration.map((leg) => `${leg["os"]} ${leg["group"]}`);
    expect(new Set(names).size).toBe(names.length);
    // A nightly run already on GitHub's runners saves GitHub's store itself.
    expect(
      Object.values(lists(alone))
        .flat()
        .some((leg) => leg["os"] === "linux-github"),
    ).toBe(false);
    // Only runs on main save caches: a pull request or the queue on Blacksmith gets no twin.
    for (const scope of [
      pr,
      queue,
      ciScope({ name: "pull_request", labels: [FULL_LABEL] }),
      ciScope({ name: "workflow_dispatch" }),
    ])
      expect(
        Object.values(lists(ciMatrix(scope, everything, blacksmith)))
          .flat()
          .some((leg) => leg["os"] === "linux-github"),
        scope.reason,
      ).toBe(false);
    expect(
      ciMatrix(
        ciScope({ name: "workflow_dispatch", onMain: true }),
        everything,
        blacksmith,
      ).unit.map((leg) => leg["os"]),
    ).toEqual(["linux", "linux-github"]);
    expect(ciEvent("workflow_dispatch", {}, false, "refs/heads/main")).toMatchObject({
      onMain: true,
    });
    expect(ciEvent("workflow_dispatch", {}, false, "refs/heads/wp/13-share")).not.toHaveProperty(
      "onMain",
    );
  });

  it("repeats a passed nightly run once it is 6 days old, inside both stores' 7-day eviction (#86)", () => {
    const now = Date.parse("2026-10-27T03:23:00Z");
    expect(nightlyCovers("2026-10-26T03:23:00Z", now)).toBe(true);
    expect(nightlyCovers(new Date(now - NIGHTLY_COVERS_MS + 60_000).toISOString(), now)).toBe(true);
    expect(nightlyCovers(new Date(now - NIGHTLY_COVERS_MS).toISOString(), now)).toBe(false);
    expect(nightlyCovers("2026-10-19T03:23:00Z", now)).toBe(false);
    expect(nightlyCovers(undefined, now)).toBe(false);
    expect(nightlyCovers("-", now)).toBe(false);
    expect(NIGHTLY_COVERS_MS).toBeLessThan(7 * 24 * 60 * 60 * 1000);
  });

  it("checks no commit messages in the merge queue, whose merges are GitHub's", () => {
    expect(ciMatrix(queue, everything, github).static[0]?.["jobs"]).not.toContain("commits");
    expect(ciMatrix(pr, everything, github).static[0]?.["jobs"]).toContain("--job commits");
  });

  it("starts no machine for a job the change doesn't need", () => {
    const docs = ciMatrix(pr, change(["docs/design/README.md"], []), github);
    expect(docs.static).toHaveLength(1);
    expect(docs.static[0]?.["names"]).toBe("format-lint, boundaries, docs, commits");
    expect([docs.unit, docs.hygiene, docs.integration, docs.windows, docs.e2e].flat()).toEqual([]);
    expect(docs.release).toBeNull();
  });

  it("puts Linux jobs on the chosen pool and the rest on GitHub's runners", () => {
    const matrix = ciMatrix(pr, everything, blacksmith);
    expect(matrix.static[0]?.runner).toBe(BLACKSMITH_LINUX.small);
    expect(matrix.unit[0]?.runner).toBe(BLACKSMITH_LINUX.large);
    const integration = matrix.integration.map((leg) => [leg["os"], leg.runner]);
    expect(integration).toContainEqual(["linux", BLACKSMITH_LINUX.large]);
    expect(integration).toContainEqual(["macos", "macos-latest"]);
    expect(new Set(matrix.windows.map((leg) => leg.runner))).toEqual(new Set(["windows-latest"]));
    // A release's bundles build and smoke-test on GitHub's images, whatever the pool.
    expect(matrix.release?.platforms.map((leg) => leg.runner)).toEqual([
      "macos-15",
      "macos-15-intel",
      "ubuntu-24.04",
      "ubuntu-24.04-arm",
      "windows-2025",
      "windows-11-arm",
    ]);
    expect(matrix.release?.npmSmoke.every((leg) => !leg.runner.startsWith("blacksmith"))).toBe(
      true,
    );
  });

  it("rehearses the release on linux-x64 for a package change, on every platform for distribution", () => {
    const code = ciMatrix(pr, change(["packages/cli/src/help.ts"], ["@mostra/cli"]), github);
    expect(code.release?.platforms.map((leg) => leg["platform"])).toEqual(["linux-x64"]);
    for (const file of [
      "pnpm-lock.yaml",
      "packages/bundle/scripts/build.ts",
      "packages/sdk/package.json",
      "packages/sdk/src/bundle/download.ts",
      ".github/workflows/release-build.yml",
      "tools/release/versions.ts",
    ]) {
      const matrix = ciMatrix(pr, change([file], []), github);
      expect(matrix.release?.platforms.length, file).toBe(6);
    }
    expect(ciMatrix(pr, change(["packages/cli/README.md"], []), github).release).toBeNull();
    // The crate is packaged in the rehearsal: a change to it alone, or to Cargo's inputs, runs
    // it on Linux, where `cargo package` runs (Opus review of MT-01, 4).
    for (const file of ["crates/mostra-host/src/lib.rs", "Cargo.lock", "rust-toolchain.toml"]) {
      const matrix = ciMatrix(pr, change([file], []), github);
      expect(
        matrix.release?.platforms.map((leg) => leg["platform"]),
        file,
      ).toEqual(["linux-x64"]);
    }
  });
});

describe("the plan job's event and outputs", () => {
  it("reads a pull request's draft, author and labels", () => {
    expect(
      ciEvent(
        "pull_request",
        {
          pull_request: {
            draft: true,
            user: { type: "Bot" },
            labels: [{ name: "dependencies" }, { name: FULL_LABEL }],
          },
        },
        false,
      ),
    ).toEqual({
      name: "pull_request",
      draft: true,
      bot: true,
      labels: ["dependencies", FULL_LABEL],
    });
    expect(ciEvent("workflow_dispatch", { inputs: { full: "false" } }, false)).toEqual({
      name: "workflow_dispatch",
      full: false,
    });
    expect(() => ciEvent("push", {}, false)).toThrow(/doesn't know/);
  });

  it("writes one output per part the workflow reads", () => {
    const workflow = parse(readFileSync(fromRoot(".github/workflows/ci.yml"), "utf8")) as {
      jobs: { plan: { outputs: Record<string, string> } };
    };
    const written = outputLines(ciMatrix(pr, everything, github)).map(
      (line) => line.split("=")[0] ?? "",
    );
    for (const name of written)
      expect(workflow.jobs.plan.outputs[name], name).toBe(`\${{ steps.plan.outputs.${name} }}`);
  });
});

interface Job {
  needs?: string | string[];
  if?: string;
  "runs-on"?: string;
  uses?: string;
  "timeout-minutes"?: number | string;
  steps?: { name?: string; if?: string; run?: string; "timeout-minutes"?: number }[];
}

describe("the CI workflow's shape (D152)", () => {
  const workflow = parse(readFileSync(fromRoot(".github/workflows/ci.yml"), "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, Job>;
  };
  const jobs = workflow.jobs;

  it("makes ci-ok wait for every other job", () => {
    const needs = jobs["ci-ok"]?.needs;
    expect([...(Array.isArray(needs) ? needs : [needs])].sort()).toEqual(
      Object.keys(jobs)
        .filter((name) => name !== "ci-ok")
        .sort(),
    );
  });

  it("ends a hung test run before its job's limit, so the failure steps keep its logs (#55)", () => {
    // A job GitHub cancels for its own limit runs no `if: failure()` step; a step's limit kills
    // every process of the step before anything looks at them. So `--deadline` reports first,
    // then the step's limit, then the job's, each with room for the one before it to finish.
    for (const [name, room] of [
      ["integration", 3],
      ["windows", 9],
    ] as const) {
      const job = jobs[name] as Job;
      const steps = job.steps ?? [];
      const at = steps.findIndex((step) => step.run?.includes("tools/check/cli.ts") ?? false);
      const step = steps[at];
      const deadline = Number(/--deadline (\d+)/.exec(step?.run ?? "")?.[1]);
      const stepLimit = step?.["timeout-minutes"] ?? Number.POSITIVE_INFINITY;
      const jobLimit = Number(job["timeout-minutes"]);
      expect(deadline, name).toBeGreaterThan(0);
      expect(stepLimit - deadline, name).toBeGreaterThanOrEqual(2);
      expect(jobLimit - stepLimit, name).toBeGreaterThanOrEqual(room);
      // The logs the deadline keeps are uploaded after it.
      expect(
        steps
          .slice(at + 1)
          .some((later) => later.if === "failure()" && later.name?.includes("logs")),
        name,
      ).toBe(true);
    }
  });

  it("hands every Mostra variable a job sets to the tasks Turbo runs", () => {
    // Turbo passes a task only the variables turbo.json names; MOSTRA_E2E_LOG_DIR once never
    // reached the e2e suites, so a failed leg kept nothing (MT-02).
    const turbo = JSON.parse(readFileSync(fromRoot("turbo.json"), "utf8")) as {
      globalPassThroughEnv?: string[];
      globalEnv?: string[];
      tasks: Record<string, { env?: string[]; passThroughEnv?: string[] }>;
    };
    const known = new Set([
      ...(turbo.globalPassThroughEnv ?? []),
      ...(turbo.globalEnv ?? []),
      ...Object.values(turbo.tasks).flatMap((task) => [
        ...(task.env ?? []),
        ...(task.passThroughEnv ?? []),
      ]),
    ]);
    // A check job of plain steps (rust) runs with the whole environment; Turbo's tasks don't.
    const viaTurbo = (run: string): boolean => {
      const named = /--job "?\$?([A-Za-z0-9-]+)"?/.exec(run)?.[1];
      if (named === "JOB") return true; // the Windows legs' unit, hygiene and integration
      return JOBS.some((check) => check.name === named && check.tasks !== undefined);
    };
    const handed: string[] = [];
    for (const [name, job] of Object.entries(jobs)) {
      const steps = job.steps ?? [];
      const jobEnv = (job as { env?: Record<string, string> }).env ?? {};
      for (const step of steps) {
        if (!step.run?.includes("tools/check/cli.ts") || !viaTurbo(step.run)) continue;
        const env = { ...jobEnv, ...((step as { env?: Record<string, string> }).env ?? {}) };
        for (const key of Object.keys(env))
          if (key.startsWith("MOSTRA_")) handed.push(`${name}: ${key}`);
      }
    }
    // The e2e legs and the integration legs both hand their log directories over.
    expect(handed).toContain("e2e: MOSTRA_E2E_LOG_DIR");
    expect(handed).toContain("integration: MOSTRA_TEST_LOG_DIR");
    expect(handed.filter((entry) => !known.has(entry.split(": ")[1] as string))).toEqual([]);
  });

  it("keeps the e2e daemons' logs and ledgers from a failed run (#39)", () => {
    const steps = (jobs["e2e"] as Job).steps ?? [];
    const run = steps.find((step) => step.run?.includes("--job e2e"));
    expect((run as { env?: Record<string, string> } | undefined)?.env?.["MOSTRA_E2E_LOG_DIR"]).toBe(
      `\${{ runner.temp }}/mostra-e2e-logs`,
    );
    const kept = steps.find((step) => step.name?.includes("logs and ledgers"));
    expect(kept?.if).toBe("failure()");
    expect((kept as { with?: Record<string, string> } | undefined)?.with?.["path"]).toBe(
      `\${{ runner.temp }}/mostra-e2e-logs`,
    );
  });

  it("never lets ci-ok skip when the plan failed", () => {
    expect(jobs["ci-ok"]?.if).toBe(
      "always() && (needs.plan.result != 'success' || needs.plan.outputs.run == 'true')",
    );
  });

  it("runs every job but the plan on the machines the plan lists", () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (["plan", "ci-ok", "dependency-review"].includes(name)) continue;
      if (job.uses) {
        expect(job.if, name).toContain(`needs.plan.outputs.${name}`);
        continue;
      }
      expect(job["runs-on"], name).toBe(`\${{ matrix.leg.runner }}`);
      expect(job.if, name).toBe(`needs.plan.outputs.${name} != '[]'`);
    }
  });

  it("rehearses the release as a rehearsal; release.yml builds it as a release (every platform)", () => {
    const release = parse(readFileSync(fromRoot(".github/workflows/release.yml"), "utf8")) as {
      jobs: Record<string, Job & { with?: Record<string, unknown> }>;
    };
    const ciCall = jobs["release"] as Job & { with?: Record<string, unknown> };
    expect(ciCall.with?.["rehearsal"]).toBe(true);
    const releaseCall = release.jobs["build"];
    expect(releaseCall?.uses).toBe("./.github/workflows/release-build.yml");
    expect(releaseCall?.with?.["rehearsal"] ?? false).toBe(false);
    const platforms = JSON.parse(String(releaseCall?.with?.["platforms"])) as {
      platform: string;
    }[];
    // Every platform a bundle exists for (`BUNDLE_PLATFORMS`), Windows' since WP-W3 (D146): the
    // release needs each one's bundle, and CI's full rehearsal builds the same list.
    const every = [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ];
    expect(platforms.map((leg) => leg.platform).sort()).toEqual(every);
    const full = ciMatrix(queue, everything, github).release;
    expect(full?.platforms.map((leg) => leg["platform"]).sort()).toEqual(every);
    const npm = JSON.parse(String(releaseCall?.with?.["npm-smoke"])) as { platform: string }[];
    expect(npm.map((leg) => leg.platform).sort()).toEqual(
      [...(full?.npmSmoke ?? [])].map((leg) => leg["platform"]).sort(),
    );
    expect(npm.map((leg) => leg.platform)).toEqual(
      expect.arrayContaining(["win32-x64", "win32-arm64"]),
    );
  });

  it("saves caches only on main, and every job that restores Turbo's cache saves it there", () => {
    interface Step {
      uses?: string;
      if?: string;
      id?: string;
      with?: Record<string, unknown>;
    }
    // Saved only on main: the condition requires it, and nothing in it can lift the requirement.
    const onMain = (condition: string | undefined): boolean =>
      condition?.includes("github.ref == 'refs/heads/main'") === true && !condition.includes("||");
    const check = (where: string, list: Step[]): void => {
      for (const step of list) {
        const uses = step.uses ?? "";
        // `actions/cache` itself saves on every run, pull requests' included.
        expect(uses.startsWith("actions/cache@"), `${where}: ${uses}`).toBe(false);
        if (uses.startsWith("actions/cache/save@")) expect(onMain(step.if), where).toBe(true);
        if (uses.startsWith("Swatinem/rust-cache@"))
          expect(step.with?.["save-if"], where).toBe(`\${{ github.ref == 'refs/heads/main' }}`);
      }
    };
    for (const action of ["setup", "browsers"]) {
      const file = parse(
        readFileSync(fromRoot(`.github/actions/${action}/action.yml`), "utf8"),
      ) as {
        runs: { steps: Step[] };
      };
      check(action, file.runs.steps);
    }
    for (const [name, job] of Object.entries(jobs)) {
      const steps = ((job as { steps?: Step[] }).steps ?? []) as Step[];
      check(name, steps);
      const setup = steps.find((step) => step.uses === "./.github/actions/setup");
      if (!setup || name === "plan") continue;
      expect(setup.id, name).toBe("setup");
      // The leg's own cache name, from the plan (Opus review 9).
      expect(setup.with?.["job"], name).toBe(`\${{ matrix.leg.cache }}`);
      expect(
        steps.some(
          (step) =>
            step.uses?.startsWith("actions/cache/save@") &&
            step.with?.["key"] === `\${{ steps.setup.outputs.turbo-key }}`,
        ),
        `${name} restores Turbo's cache and never saves it`,
      ).toBe(true);
    }
  });

  it("bounds every network call the runner choice makes, so a hung vendor means GitHub (Opus review 3)", () => {
    const action = parse(readFileSync(fromRoot(".github/actions/runners/action.yml"), "utf8")) as {
      runs: { steps: { run?: string }[] };
    };
    const script = action.runs.steps.map((step) => step.run ?? "").join("\n");
    const curls = script.split("\n").filter((line) => /\bcurl\b/.test(line));
    expect(curls.length).toBeGreaterThan(0);
    for (const line of curls) expect(line, line.trim()).toMatch(/--max-time \d+/);
    const calls = [...script.matchAll(/(\S+\s+)?"\$dir\/blacksmith" (\w+)/g)];
    expect(calls.map((call) => call[2])).toEqual(["auth", "usage"]);
    for (const call of calls) expect(call[1]?.trim(), call[0]).toMatch(/^timeout$|^\d+$/);
    expect(script).toMatch(/timeout 30 "\$dir\/blacksmith" auth/);
    expect(script).toMatch(/timeout 30 "\$dir\/blacksmith" usage/);
  });

  it("is triggered by pull requests ready for review, the queue, the night and hand only", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(
      ["merge_group", "pull_request", "schedule", "workflow_dispatch"].sort(),
    );
    expect((workflow.on["pull_request"] as { types: string[] }).types).toContain(
      "ready_for_review",
    );
  });
});
