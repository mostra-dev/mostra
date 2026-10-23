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
 * exercised by the runtime's Windows suites, since its code compiles on Windows alone (WP-W1).
 */
const RUN_BY: readonly { readonly dir: string; readonly pkg: string }[] = [
  { dir: "crates/mostra-win", pkg: "@mostra/runtime" },
];

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
  const packages = listPackages();
  const direct = new Set<string>();
  for (const file of changed) for (const name of directOwners(packages, file)) direct.add(name);
  return { base, changed, packages: [...withDependents(packages, direct)].sort() };
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
