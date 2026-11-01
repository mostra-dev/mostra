/**
 * What to check for a change: the base it is compared against, the files that changed and the
 * workspace packages they affect (with their dependents). `pnpm check --affected` and the CI plan
 * job compute it the same way, so local and CI runs choose the same work.
 */
import { git, mergeBase } from "../lib/repo.ts";
import {
  listPackages,
  owningPackage,
  type WorkspacePackage,
  withDependents,
} from "../lib/workspace.ts";

/** The work a check run covers. */
export interface Plan {
  /** The merge base the change is compared against, when one is reachable. */
  readonly base: string | undefined;
  /** Changed repository-relative paths, or `"all"` for a full run. */
  readonly changed: readonly string[] | "all";
  /** Affected workspace package names, or `"all"`. */
  readonly packages: readonly string[] | "all";
}

/**
 * Files whose change can affect every job: shared configuration, the check machinery itself and
 * the CI setup. Any of them makes the run a full one.
 */
const GLOBAL_INPUTS: readonly RegExp[] = [
  /^package\.json$/,
  /^tools\/check\//,
  /^tools\/lib\//,
  /^tools\/package\.json$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/actions\//,
  /^lefthook\.yml$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^turbo\.json$/,
  /^biome\.json$/,
  /^\.node-version$/,
];

/**
 * Directories outside every workspace package that a package runs, so a change in them affects
 * that package's jobs (and its dependents'): the Windows helper is run by the runtime and is only
 * exercised by the runtime's Windows suites, since its code compiles on Windows alone (WP-W1); the
 * reference and the Agent Skill ship inside the CLI's build, which `mostra docs` reads, and the
 * Skill's examples are verified by the runtime's suite (WP-14).
 */
const RUN_BY: readonly { readonly dir: string; readonly pkg: string }[] = [
  { dir: "crates/mostra-win", pkg: "@mostra/runtime" },
  { dir: "docs/reference", pkg: "@mostra/cli" },
  { dir: "skills/mostra", pkg: "@mostra/cli" },
  // The Skill's checks in the CLI read the author API: every export of these must be documented.
  { dir: "packages/react/etc/react.api.md", pkg: "@mostra/cli" },
  { dir: "packages/server/etc/server.api.md", pkg: "@mostra/cli" },
  { dir: "packages/react/src/form.ts", pkg: "@mostra/cli" },
  { dir: "packages/react/src/router.ts", pkg: "@mostra/cli" },
  // The Skill's examples and its references' code samples pass verify in the runtime's
  // integration suite.
  { dir: "skills/mostra/assets/examples", pkg: "@mostra/runtime" },
  { dir: "skills/mostra/references", pkg: "@mostra/runtime" },
];

/**
 * Files a package owns that none of its dependents consume, so a change to them runs the owner's
 * jobs and never its dependents'. Every package lists `@mostra/tools` as a dependency for the check
 * machinery, and the dossier's generators (`tools/design/`) sit inside it: without this, a change to
 * a work-package specification's reading list ran every job of every package on every platform
 * (#102). The docs job runs the generators' checks, and `@mostra/tools`' own gate tests run them
 * against seeded drift.
 */
const OWN_ONLY: readonly RegExp[] = [/^tools\/design\//];

/** The packages a changed file affects directly: its owner, and the package that runs it. */
export function directOwners(packages: readonly WorkspacePackage[], file: string): string[] {
  const owners: string[] = [];
  const owner = owningPackage(packages, file);
  if (owner) owners.push(owner.name);
  for (const entry of RUN_BY) {
    if (file === entry.dir || file.startsWith(`${entry.dir}/`)) owners.push(entry.pkg);
  }
  return owners;
}

/** Builds the plan for a full run, or for the change since `base` when `affected` is set. */
export function makePlan(options: { affected: boolean; base?: string }): Plan {
  const base = mergeBase(options.base);
  if (!options.affected || base === undefined) {
    return { base, changed: "all", packages: "all" };
  }
  const changed = changedFiles(base);
  if (changed.some((file) => GLOBAL_INPUTS.some((pattern) => pattern.test(file)))) {
    return { base, changed: "all", packages: "all" };
  }
  return { base, changed, packages: affectedPackages(listPackages(), changed) };
}

/**
 * The packages a change to `changed` affects: each file's direct owners with their dependents,
 * except that a file only its owner uses ({@link OWN_ONLY}) affects its owner alone.
 */
export function affectedPackages(
  packages: readonly WorkspacePackage[],
  changed: readonly string[],
): string[] {
  const spreading = new Set<string>();
  const own = new Set<string>();
  for (const file of changed) {
    const target = OWN_ONLY.some((pattern) => pattern.test(file)) ? own : spreading;
    for (const name of directOwners(packages, file)) target.add(name);
  }
  return [...new Set([...withDependents(packages, spreading), ...own])].sort();
}

/** Files changed since `base`: committed, staged, unstaged and untracked. */
export function changedFiles(base: string): string[] {
  const lists = [
    git(["diff", "--name-only", base]),
    git(["ls-files", "--others", "--exclude-standard"]),
  ];
  const files = new Set<string>();
  for (const list of lists) {
    for (const line of (list ?? "").split("\n")) if (line.trim()) files.add(line.trim());
  }
  return [...files].sort();
}

/** Whether any changed file matches one of `patterns` (always true for a full run). */
export function touches(plan: Plan, patterns: readonly RegExp[]): boolean {
  if (plan.changed === "all") return true;
  return plan.changed.some((file) => patterns.some((pattern) => pattern.test(file)));
}

/** Whether the plan affects any workspace package. */
export function affectsPackages(plan: Plan): boolean {
  return plan.packages === "all" || plan.packages.length > 0;
}
