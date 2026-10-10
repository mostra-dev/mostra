/**
 * What to check for a change: the base it is compared against, the files that changed and the
 * workspace packages they affect (with their dependents). `pnpm check --affected` and the CI plan
 * job compute it the same way, so local and CI runs choose the same work.
 */
import { git, mergeBase } from "../lib/repo.ts";
import { listPackages, owningPackage, withDependents } from "../lib/workspace.ts";

/** The work a check run covers. */
export interface Plan {
  /** The merge base the change is compared against, when one is reachable. */
  readonly base: string | undefined;
  /** Changed repository-relative paths, or `"all"` for a full run. */
  readonly changed: readonly string[] | "all";
  /** Affected workspace package names, or `"all"`. */
  readonly packages: readonly string[] | "all";
}

/** Files whose change can affect every package, so any of them makes the run a full one. */
const GLOBAL_INPUTS: readonly RegExp[] = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^turbo\.json$/,
  /^biome\.json$/,
  /^\.node-version$/,
];

/** Builds the plan for a full run, or for the change since `base` when `affected` is set. */
export function makePlan(options: { affected: boolean; base?: string }): Plan {
  const base = mergeBase(options.base);
  if (!options.affected || base === undefined) {
    return { base, changed: "all", packages: "all" };
  }
  const changed = changedFiles(base);
  if (changed.some((file) => GLOBAL_INPUTS.some((pattern) => pattern.test(file)))) {
    return { base, changed, packages: "all" };
  }
  const packages = listPackages();
  const direct = new Set<string>();
  for (const file of changed) {
    const owner = owningPackage(packages, file);
    if (owner) direct.add(owner.name);
  }
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
