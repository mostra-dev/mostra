/**
 * The CI jobs of REPO_STANDARDS §6, defined once. `pnpm check` runs them locally and each CI job
 * runs exactly one of them (`pnpm check --job <name>`), so "green locally" means "green in CI"
 * apart from the cross-platform legs and GitHub's hosted scanners.
 */
import { existsSync } from "node:fs";
import { fromRoot } from "../lib/repo.ts";
import { affectsPackages, type Plan, touches } from "./plan.ts";

/** Packages whose suites run real Mostra processes: the runtime, its protocol and its clients. */
const INTEGRATION_PACKAGES: ReadonlySet<string> = new Set([
  "@mostra/runtime",
  "@mostra/protocol",
  "@mostra/cli",
  "@mostra/sdk",
  "@mostra/conformance",
  "create-mostra",
]);

/**
 * The packages whose suites run on Windows so far: WP-W1 brings the supervisor's core (WP-01 to
 * WP-04's suites); WP-W2 and WP-W3 add the rest (D146).
 */
export const WINDOWS_PACKAGES: readonly string[] = ["@mostra/protocol", "@mostra/runtime"];

/** The names of the jobs, in REPO_STANDARDS §6 order. */
export const JOB_NAMES = [
  "format-lint",
  "types",
  "unit",
  "integration",
  "hygiene",
  "e2e",
  "build",
  "boundaries",
  "api",
  "licenses",
  "rust",
  "conformance",
  "docs",
  "commits",
] as const;

/** One job's name. */
export type JobName = (typeof JOB_NAMES)[number];

/** One command a job runs, from the repository root unless `cwd` says otherwise. */
export interface Step {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** A job: when it applies to a plan, and either commands or workspace tasks to run. */
export interface Job {
  readonly name: JobName;
  readonly summary: string;
  /** Whether the job applies to this plan. Jobs that don't apply are skipped, not failed. */
  applies(plan: Plan): boolean;
  /** Workspace tasks run through Turborepo for the affected packages. */
  readonly tasks?: readonly string[];
  /** Repository-level commands, run in order. */
  steps?(plan: Plan): readonly Step[];
  /** Part of `--fast` (the pre-push hook). */
  readonly fast?: boolean;
  /**
   * Runs on its own after the other task jobs, in a local `pnpm check` only: CI gives every job a
   * machine of its own, and three browsers beside the real-process suites on one laptop time out
   * (WP-07's and WP-08's baselines). The job's own tests still run in parallel.
   */
  readonly alone?: boolean;
}

const BIN = "node_modules/.bin";
const TS6_BIN = "tools/ts6/node_modules/.bin";
const RUST = [
  /^crates\//,
  // The crate's wire types are generated from the protocol's schema (D143): a schema change runs
  // the snapshot test that finds them stale.
  /^packages\/protocol\/schemas\//,
  /^Cargo\.(toml|lock)$/,
  /^deny\.toml$/,
  /^rust-toolchain\.toml$/,
  /^rustfmt\.toml$/,
  /^clippy\.toml$/,
];

/** The packages whose changes reach the gateway's behavior. */
const GATEWAY = ["@mostra/runtime", "@mostra/protocol", "@mostra/shell"];

/** Whether the plan covers every package or one of `names`. */
function affects(plan: Plan, names: readonly string[]): boolean {
  return plan.packages === "all" || plan.packages.some((name) => names.includes(name));
}

/** Every job. */
export const JOBS: readonly Job[] = [
  {
    name: "format-lint",
    summary: "Biome, ESLint (React hooks), repository lint, cargo fmt and clippy",
    applies: () => true,
    steps: (plan) => [
      { label: "biome", command: `${BIN}/biome`, args: ["ci", "--colors=off", "."] },
      {
        label: "eslint",
        command: `${TS6_BIN}/eslint`,
        args: ["--config", "tools/ts6/eslint.config.mjs", "--max-warnings", "0", "."],
      },
      { label: "repo-lint", command: "node", args: ["tools/repo-lint/cli.ts"] },
      ...(touches(plan, RUST)
        ? [
            { label: "cargo fmt", command: "cargo", args: ["fmt", "--all", "--check"] },
            {
              label: "clippy",
              command: "cargo",
              args: ["clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"],
            },
          ]
        : []),
    ],
  },
  {
    name: "types",
    summary: "tsc -b for the affected packages",
    applies: affectsPackages,
    tasks: ["typecheck"],
    fast: true,
  },
  {
    name: "unit",
    summary: "Vitest for the affected packages",
    applies: affectsPackages,
    tasks: ["test"],
    fast: true,
  },
  {
    name: "integration",
    summary:
      "Suites through real Mostra processes (sockets, process groups), on macOS and Linux in CI",
    // D86: only when the runtime, the protocol it speaks or a client that spawns it is affected
    // (dependents included).
    applies: (plan) =>
      plan.packages === "all" || plan.packages.some((name) => INTEGRATION_PACKAGES.has(name)),
    tasks: ["test:integration"],
  },
  {
    name: "hygiene",
    summary:
      "The hygiene checklist as negative tests against a real gateway (bad Host, Origin, token, CSRF, revoked token)",
    applies: (plan) => affects(plan, GATEWAY),
    tasks: ["test:hygiene"],
  },
  {
    name: "e2e",
    summary:
      "Playwright through the real gateway in Chromium, Firefox and WebKit, on macOS and Linux in CI",
    applies: (plan) => affects(plan, [...GATEWAY, "@mostra/react", "@mostra/e2e"]),
    tasks: ["e2e"],
    alone: true,
  },
  {
    name: "build",
    summary: "tsdown builds and size budgets for the affected packages",
    applies: affectsPackages,
    tasks: ["build", "size"],
  },
  {
    name: "boundaries",
    summary:
      "dependency-cruiser package-map rules, knip, and every seeded violation still plantable",
    applies: () => true,
    fast: true,
    steps: () => [
      {
        label: "dependency-cruiser",
        command: `${TS6_BIN}/depcruise`,
        args: [
          "--config",
          "tools/ts6/dependency-cruiser.config.mjs",
          ...["packages", "plugins", "apps"].filter((dir) => existsSync(fromRoot(dir))),
        ],
      },
      { label: "knip", command: `${BIN}/knip`, args: ["--no-progress", "--no-config-hints"] },
      // No host-specific code in the core (HO-06, invariant 11).
      { label: "host-neutral core", command: "node", args: ["tools/audit/host-neutral.ts"] },
      // A seed (packages/runtime/scripts/prove-seeds.ts) whose anchor moved proves nothing and
      // fails no test, so the anchors are checked on every change (found in WP-11: ten had gone).
      {
        label: "seed anchors",
        command: "node",
        args: ["packages/runtime/scripts/prove-seeds.ts", "--anchors"],
      },
    ],
  },
  {
    name: "api",
    summary: "API reports with the changeset rule, publint, attw and wire-schema compatibility",
    applies: affectsPackages,
    tasks: ["api", "schemas"],
  },
  {
    name: "licenses",
    summary: "License audit: OSI-only core, no pnpm pnpr/",
    applies: (plan) =>
      touches(plan, [
        /^pnpm-lock\.yaml$/,
        /package\.json$/,
        /^tools\/license-audit\//,
        /^Cargo\.lock$/,
      ]),
    steps: () => [
      { label: "license audit", command: "node", args: ["tools/license-audit/cli.ts"] },
    ],
  },
  {
    name: "rust",
    summary: "cargo nextest (the crate against the built runtime) and cargo-deny",
    // The crate's suites run real instances of the runtime this checkout builds (D143), so a
    // runtime or protocol change runs them too.
    applies: (plan) =>
      touches(plan, RUST) || affects(plan, ["@mostra/runtime", "@mostra/protocol"]),
    steps: () => [
      {
        label: "build the runtime",
        command: `${BIN}/turbo`,
        args: ["run", "build", "--filter=@mostra/runtime...", "--output-logs=errors-only"],
      },
      {
        label: "nextest",
        command: "cargo",
        args: ["nextest", "run", "--workspace", "--locked", "--no-tests=pass"],
      },
      { label: "cargo-deny", command: "cargo", args: ["deny", "--locked", "check"] },
    ],
  },
  {
    name: "conformance",
    summary:
      "The host conformance kit against the Rust reference host: with every port, standalone, and broken with its baseline",
    // The TypeScript reference host runs in the integration job's `clients` group; this job runs
    // the Rust one, so a change to the kit, the crate, the runtime or the protocol runs it (HO-05).
    applies: (plan) =>
      touches(plan, RUST) ||
      affects(plan, [
        "@mostra/runtime",
        "@mostra/protocol",
        "@mostra/sdk",
        "@mostra/conformance",
        "@mostra/shell",
      ]),
    alone: true,
    steps: () => {
      const kit = ["packages/conformance/dist/cli.js", "--host"];
      const host = "target/debug/mostra-host-reference";
      return [
        {
          label: "build the runtime and the kit",
          command: `${BIN}/turbo`,
          args: [
            "run",
            "build",
            "--filter=@mostra/runtime...",
            "--filter=@mostra/conformance...",
            "--output-logs=errors-only",
          ],
        },
        {
          label: "build the Rust reference host",
          command: "cargo",
          args: ["build", "--locked", "-p", "mostra-host-reference"],
        },
        { label: "kit: Rust reference host", command: "node", args: [...kit, host] },
        {
          label: "kit: Rust reference host, standalone",
          command: "node",
          args: [...kit, `${host} --standalone`],
        },
        {
          label: "kit: Rust reference host, broken, with its baseline",
          command: "node",
          args: [
            ...kit,
            `${host} --break store-duplicates,drafts-as-submissions,ignore-policy`,
            "--baseline",
            "packages/conformance/baselines/reference-host-rust-broken.json",
          ],
        },
      ];
    },
  },
  {
    name: "docs",
    summary: "Generated references, the evidence matrix and WP specifications, links",
    applies: (plan) =>
      touches(plan, [
        /\.md$/,
        /^docs\//,
        /^tools\/design\//,
        /^tools\/docs\//,
        /^packages\/protocol\/src\/diagnostics\//,
        /^packages\/cli\/src\//,
      ]),
    steps: () => [
      {
        label: "diagnostic catalog",
        command: "node",
        args: ["tools/docs/diagnostics.ts", "check"],
      },
      {
        label: "CLI reference",
        command: "node",
        args: ["--conditions=@mostra/source", "tools/docs/cli.ts", "check"],
      },
      {
        label: "evidence matrix",
        command: "python3",
        args: ["tools/design/evidence_matrix.py", "--check"],
      },
      {
        label: "WP specifications",
        command: "python3",
        args: ["tools/design/wp_specs.py", "--check"],
      },
      { label: "links", command: "node", args: ["tools/docs/links.ts"] },
    ],
  },
  {
    name: "commits",
    summary: "Conventional Commits with a DCO sign-off on every commit since the base",
    applies: (plan) => plan.base !== undefined,
    steps: (plan) => [
      {
        label: "commit messages",
        command: "node",
        // CI sets MOSTRA_HEAD to the pull request's head, so GitHub's synthetic merge commit
        // stays out of the range while contributor merges stay in it.
        args: [
          "tools/commits/cli.ts",
          "range",
          `${plan.base}..${process.env["MOSTRA_HEAD"] || "HEAD"}`,
        ],
      },
    ],
  },
];
