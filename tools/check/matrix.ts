/**
 * What a CI run runs, and where (D152): the jobs of `pnpm check` (jobs.ts) laid out on machines
 * for one event. The plan job computes it once and every other job reads its part, so a job no
 * change needs never takes a runner, and the rules of what runs when live here, under test,
 * rather than in workflow expressions.
 *
 * - **Scope** is the packages a run checks: `affected` (the change since its base) or `all`.
 * - **Legs** are the machines: `pull-request` legs are Linux, macOS and Windows x64 (WebKit alone
 *   among macOS's browsers), with the release rehearsed on linux-x64 alone unless distribution
 *   files changed; `all` adds Windows arm64, Chromium and Firefox on macOS, and rehearses every
 *   platform.
 *
 * | Event | Scope | Legs |
 * |---|---|---|
 * | `pull_request` | affected | pull-request |
 * | `pull_request` labelled `ci:full` | all | all |
 * | `pull_request`, a bot's draft | nothing runs until it is ready for review |
 * | `merge_group` | affected | all |
 * | `schedule` (main, nightly) | all | all, unless the last nightly run passed on this commit |
 * | `workflow_dispatch` | all, or affected with `full: false` | all |
 */
import { JOBS, type JobName } from "./jobs.ts";
import { type Plan, touches } from "./plan.ts";
import type { Runners } from "./runners.ts";

/** The label that asks a pull request for the merge queue's full run on every push. */
export const FULL_LABEL = "ci:full";

/** The event a run is for. */
export interface CiEvent {
  readonly name: "pull_request" | "merge_group" | "schedule" | "workflow_dispatch";
  /** A pull request that is a draft. */
  readonly draft?: boolean;
  /** A pull request a bot opened (Renovate). */
  readonly bot?: boolean;
  /** A pull request's labels. */
  readonly labels?: readonly string[];
  /** `workflow_dispatch`'s `full` input (default true). */
  readonly full?: boolean;
  /** For `schedule`: the last nightly run on this commit passed. */
  readonly alreadyPassed?: boolean;
}

/** What the run checks, before the plan is made. */
export interface CiScope {
  /** The event the run is for. */
  readonly event: CiEvent["name"];
  /** False when the run checks nothing at all (a bot's draft, a nightly run already done). */
  readonly run: boolean;
  readonly reason: string;
  readonly scope: "affected" | "all";
  readonly legs: "pull-request" | "all";
}

/** Decides the scope from the event alone, so the plan is made with the right base. */
export function ciScope(event: CiEvent): CiScope {
  const of = (
    run: boolean,
    reason: string,
    scope: CiScope["scope"],
    legs: CiScope["legs"],
  ): CiScope => ({ event: event.name, run, reason, scope, legs });
  const none = (reason: string): CiScope => of(false, reason, "affected", "all");
  switch (event.name) {
    case "pull_request":
      if (event.draft && event.bot)
        return none(
          "a bot's draft pull request runs nothing; mark it ready for review (gh pr ready) to run CI",
        );
      return event.labels?.includes(FULL_LABEL)
        ? of(true, `labelled ${FULL_LABEL}`, "all", "all")
        : of(true, "a pull request", "affected", "pull-request");
    case "merge_group":
      return of(true, "the merge queue", "affected", "all");
    case "schedule":
      return event.alreadyPassed
        ? none("the last nightly run already passed on this commit")
        : of(true, "the nightly run on main", "all", "all");
    case "workflow_dispatch":
      return event.full === false
        ? of(true, "started by hand", "affected", "all")
        : of(true, "started by hand, full", "all", "all");
  }
}

/** One machine of a matrix. `runner` is its `runs-on` label. */
export interface Leg {
  readonly runner: string;
  readonly [key: string]: string;
}

/** The release rehearsal (`release-build.yml`): which bundles to build and smoke-test. */
export interface Rehearsal {
  /** The bundle and smoke legs: platform and runner. */
  readonly platforms: readonly Leg[];
  /** The npm path on an older Node.js. */
  readonly npmSmoke: readonly Leg[];
  /** The runner of the jobs that pack, dry-run and check the old-Node.js refusal. */
  readonly linux: string;
  /** Why every platform, or why linux-x64 alone. */
  readonly reason: string;
}

/** The whole layout of a run. Empty lists are jobs the run skips. */
export interface CiMatrix extends CiScope {
  /** The `pnpm check` jobs that apply (the plan's view, for the summary). */
  readonly jobs: readonly JobName[];
  /** `--affected`, or empty for a full run: every job passes it to `pnpm check`. */
  readonly scopeFlag: string;
  /** The cheap Linux checks, together on one machine: `jobs` is their `--job` arguments. */
  readonly static: readonly Leg[];
  readonly unit: readonly Leg[];
  readonly hygiene: readonly Leg[];
  readonly integration: readonly Leg[];
  readonly windows: readonly Leg[];
  readonly e2e: readonly Leg[];
  readonly rust: readonly Leg[];
  readonly conformance: readonly Leg[];
  /** Absent when no published package or distribution file changed. */
  readonly release: Rehearsal | null;
}

/** The checks that need no browser, real process or Rust toolchain: one machine runs them all. */
const STATIC_JOBS: readonly JobName[] = [
  "format-lint",
  "types",
  "build",
  "boundaries",
  "api",
  "licenses",
  "docs",
  "commits",
];

/** Integration groups per platform (packages/runtime/vitest.config.ts, D151 item 8). */
const POSIX_GROUPS = ["core", "verify", "verify-failures", "clients"] as const;
const WINDOWS_GROUPS = [
  "windows",
  "windows-publish",
  "windows-gateway",
  "windows-workers",
  "windows-verify",
  "windows-verify-failures",
  "windows-clients",
] as const;

/**
 * Files whose change the release rehearsal must see on every platform (D142 items 1, 6): what
 * builds, audits or smoke-tests a bundle, what the npm path runs, and every dependency's version.
 */
const DISTRIBUTION: readonly RegExp[] = [
  /^\.github\/workflows\/release(-build)?\.yml$/,
  /^\.github\/actions\//,
  /^\.changeset\/config\.json$/,
  /^\.node-version$/,
  /^packages\/bundle\//,
  /^packages\/[^/]+\/package\.json$/,
  /^packages\/sdk\/src\/(bundle\/|runtime\.ts$|setup-main\.ts$|platform\.ts$)/,
  /^packages\/cli\/src\/(bootstrap|node-gate|platform)\.ts$/,
  /^packages\/create-mostra\/src\//,
  /^tools\/release\//,
  /^tools\/license-audit\//,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
];

/** Files a release carries or checks: a change to any of them runs the rehearsal. */
const RELEASE_INPUTS: readonly RegExp[] = [
  ...DISTRIBUTION,
  /^packages\/(?!.*\.md$).+/,
  /^tools\/api\//,
];

/** Release platforms and the runners that build them (D142 item 1): always GitHub's. */
const BUNDLE_PLATFORMS = [
  { platform: "darwin-arm64", runner: "macos-15" },
  { platform: "darwin-x64", runner: "macos-15-intel" },
  { platform: "linux-x64", runner: "ubuntu-24.04" },
  { platform: "linux-arm64", runner: "ubuntu-24.04-arm" },
] as const;

/** Lays a plan out for a scope and the run's runners. */
export function ciMatrix(scope: CiScope, plan: Plan, runners: Runners): CiMatrix {
  const applies = new Set(
    scope.run ? JOBS.filter((job) => job.applies(plan)).map((job) => job.name) : [],
  );
  const all = scope.legs === "all";
  const has = (name: JobName): boolean => applies.has(name);
  // The merge queue's commits are GitHub's own merges; each pull request's commits were checked
  // in its own run, which the queue requires.
  const staticJobs = STATIC_JOBS.filter(
    (name) => has(name) && !(name === "commits" && scope.event === "merge_group"),
  );
  const posix = [
    { os: "linux", runner: runners.linux.large },
    { os: "macos", runner: runners.macos },
  ];
  const windowsOs = [
    { os: "windows-x64", runner: runners.windows.x64 },
    ...(all ? [{ os: "windows-arm64", runner: runners.windows.arm64 }] : []),
  ];
  const windows = windowsOs.flatMap(({ os, runner }) => [
    ...(has("unit") ? [{ os, runner, job: "unit", group: "windows" }] : []),
    ...(has("hygiene") ? [{ os, runner, job: "hygiene", group: "windows" }] : []),
    ...(has("integration")
      ? WINDOWS_GROUPS.map((group) => ({ os, runner, job: "integration", group }))
      : []),
  ]);
  // One engine per machine (WP-12). Windows: Chromium and Firefox on x64, Chromium on arm64
  // (Playwright's Windows browsers are x64 builds, emulated on arm64; WebKit stays off Windows,
  // D151 item 8, M38).
  const e2e = has("e2e")
    ? [
        ...posix.flatMap(({ os, runner }) =>
          // A pull request runs only WebKit on macOS, the engine closest to Safari; Chromium and
          // Firefox there are the engines Linux already runs, and wait for the merge queue, since
          // GitHub runs at most five macOS jobs at once.
          (os === "macos" && !all ? ["webkit"] : ["chromium", "firefox", "webkit"]).map(
            (browser) => ({ os, runner, browser }),
          ),
        ),
        ...["chromium", "firefox"].map((browser) => ({
          os: "windows-x64",
          runner: runners.windows.x64,
          browser,
        })),
        ...(all
          ? [{ os: "windows-arm64", runner: runners.windows.arm64, browser: "chromium" }]
          : []),
      ]
    : [];
  return {
    ...scope,
    jobs: [...applies],
    scopeFlag: scope.scope === "affected" ? "--affected" : "",
    static:
      staticJobs.length > 0
        ? [
            {
              runner: runners.linux.small,
              jobs: staticJobs.map((name) => `--job ${name}`).join(" "),
              names: staticJobs.join(", "),
            },
          ]
        : [],
    unit: has("unit") ? [{ os: "linux", runner: runners.linux.large }] : [],
    hygiene: has("hygiene") ? [{ os: "linux", runner: runners.linux.large }] : [],
    integration: has("integration")
      ? posix.flatMap(({ os, runner }) => POSIX_GROUPS.map((group) => ({ os, runner, group })))
      : [],
    windows,
    e2e,
    rust: has("rust") ? posix : [],
    conformance: has("conformance") ? posix : [],
    release: scope.run ? rehearsal(plan, all, runners) : null,
  };
}

function rehearsal(plan: Plan, all: boolean, runners: Runners): Rehearsal | null {
  if (!touches(plan, RELEASE_INPUTS)) return null;
  const every = all || touches(plan, DISTRIBUTION);
  const linuxX64 = BUNDLE_PLATFORMS.filter((leg) => leg.platform === "linux-x64");
  return {
    platforms: every ? BUNDLE_PLATFORMS : linuxX64,
    npmSmoke: every
      ? [
          { platform: "linux-x64", runner: "ubuntu-24.04" },
          { platform: "darwin-arm64", runner: "macos-15" },
        ]
      : [{ platform: "linux-x64", runner: "ubuntu-24.04" }],
    linux: runners.linux.large,
    reason: every
      ? all
        ? "every platform: this run checks everything"
        : "every platform: distribution files changed"
      : "linux-x64 only: no distribution file changed (the merge queue rehearses every platform)",
  };
}
