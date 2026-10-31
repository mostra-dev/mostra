/**
 * What a release version is, and the small argv helper the release's scripts share. It imports
 * nothing, not even Node.js: the release's privileged jobs run it with no installed package
 * (repo lint), and one definition keeps the workflow, the plugin tools and the version sync from
 * disagreeing on which versions are valid (WP-14's Opus review, finding 10).
 */

/** A release version's text, `<major>.<minor>.<patch>` with an optional prerelease, unanchored. */
export const RELEASE_VERSION_PATTERN = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?";

/** A whole release version. */
export const RELEASE_VERSION: RegExp = new RegExp(`^${RELEASE_VERSION_PATTERN}$`);

/** Whether `version` is a release version. */
export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version);
}

/**
 * Semantic Versioning precedence of two release versions: negative when `a` comes first, zero when
 * they are the same, positive when `a` comes after. A prerelease comes before its release;
 * prerelease parts compare numerically when both are numbers, else as text, numbers first.
 */
export function compareVersions(a: string, b: string): number {
  if (!isReleaseVersion(a) || !isReleaseVersion(b))
    throw new Error(`can't compare "${a}" and "${b}": not release versions`);
  const parse = (version: string): [number[], string[]] => {
    const dash = version.indexOf("-");
    const core = (dash < 0 ? version : version.slice(0, dash)).split(".").map(Number);
    return [core, dash < 0 ? [] : version.slice(dash + 1).split(".")];
  };
  const [coreA, preA] = parse(a);
  const [coreB, preB] = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (coreA[index] ?? 0) - (coreB[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (preA.length === 0 || preB.length === 0) return preB.length - preA.length;
  for (let index = 0; index < Math.max(preA.length, preB.length); index++) {
    const partA = preA[index];
    const partB = preB[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    const numericA = /^\d+$/.test(partA);
    const numericB = /^\d+$/.test(partB);
    if (numericA && numericB) {
      const difference = Number(partA) - Number(partB);
      if (difference !== 0) return difference;
    } else if (numericA !== numericB) return numericA ? -1 : 1;
    else if (partA !== partB) return partA < partB ? -1 : 1;
  }
  return 0;
}

/** The value after `--name` in `argv`, or `undefined`. */
export function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at > 0 ? argv[at + 1] : undefined;
}
