/**
 * The CI jobs of REPO_STANDARDS §6, defined once. `pnpm check` runs them locally and each CI job
 * runs exactly one of them (`pnpm check --job <name>`), so "green locally" means "green in CI"
 * apart from the cross-platform legs and GitHub's hosted scanners.
 */
import { existsSync } from "node:fs";
import { fromRoot } from "../lib/repo.ts";
import { affectsPackages, type Plan, touches } from "./plan.ts";

/** The names of the jobs, in REPO_STANDARDS §6 order. */
export const JOB_NAMES = [
  "format-lint",
  "types",
  "unit",
  "build",
  "boundaries",
  "api",
  "licenses",
  "rust",
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
}

const BIN = "node_modules/.bin";
const TS6_BIN = "tools/ts6/node_modules/.bin";
const RUST = [
  /^crates\//,
  /^Cargo\.(toml|lock)$/,
  /^deny\.toml$/,
  /^rust-toolchain\.toml$/,
  /^rustfmt\.toml$/,
  /^clippy\.toml$/,
];

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
    name: "build",
    summary: "tsdown builds and size budgets for the affected packages",
    applies: affectsPackages,
    tasks: ["build", "size"],
  },
  {
    name: "boundaries",
    summary: "dependency-cruiser package-map rules and knip",
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
    summary: "cargo nextest and cargo-deny",
    applies: (plan) => touches(plan, RUST),
    steps: () => [
      {
        label: "nextest",
        command: "cargo",
        args: ["nextest", "run", "--workspace", "--locked", "--no-tests=pass"],
      },
      { label: "cargo-deny", command: "cargo", args: ["deny", "--locked", "check"] },
    ],
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
      ]),
    steps: () => [
      {
        label: "diagnostic catalog",
        command: "node",
        args: ["tools/docs/diagnostics.ts", "check"],
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
