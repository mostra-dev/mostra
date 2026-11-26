/**
 * Which spec files one part of an engine's end-to-end run takes, when CI splits an engine across
 * machines (`MOSTRA_E2E_SHARD`, `tools/check/matrix.ts`). Playwright's own sharding splits the
 * tests by count in file order, so the parts holding the long suites (the surfaces, the review
 * layer's, the client's recovery cases) ran far longer than the rest: on Windows arm64's emulated
 * Chromium the last of four took 915 s against 341 to 545 s for the others, and the last of three
 * passed the job's 25 minutes (WP-20's merge queue, run 45463515020). This deals whole files by
 * their measured length instead, longest first, each to the part with the least so far (the LPT
 * rule), so every part takes about the same time.
 */

/**
 * Each spec file's length, in seconds of one Chromium worker on a laptop (WP-20, 2026-11-24, run
 * one test at a time): only their ratios matter. A spec missing here counts as the median, and a
 * test fails until it is added (`tools/test/e2e-parts.test.ts`).
 */
export const SPEC_SECONDS: Readonly<Record<string, number>> = {
  "client.spec.ts": 336,
  "surfaces.spec.ts": 327,
  "controls.spec.ts": 106,
  "versions.spec.ts": 70,
  "mcp-apps.spec.ts": 62,
  "review.spec.ts": 59,
  "review-surfaces.spec.ts": 58,
  "hosted.spec.ts": 56,
  "gateway.spec.ts": 45,
  "kit.spec.ts": 44,
  "live-chart.spec.ts": 60,
  "kit-libraries.spec.ts": 420,
  "actions.spec.ts": 35,
  "worker-mode.spec.ts": 18,
  "team.spec.ts": 18,
  "pages.spec.ts": 14,
  "signout.spec.ts": 4,
  "interaction.spec.ts": 2,
  "open.spec.ts": 2,
  "harness.spec.ts": 1,
};

/** A spec file's weight: its measured length, or the median of the known ones. */
function weightOf(file: string): number {
  const known = SPEC_SECONDS[file];
  if (known !== undefined) return known;
  const values = Object.values(SPEC_SECONDS).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 1;
}

/**
 * Deals `files` into `total` parts, longest first, each to the part with the least so far (ties:
 * the file's name, then the lower part), and answers every part's files. Deterministic, so every
 * machine of a run agrees on its own part.
 */
export function dealSpecs(files: readonly string[], total: number): string[][] {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`A run has 1 or more parts, not ${total}.`);
  const parts = Array.from({ length: total }, () => ({ files: [] as string[], seconds: 0 }));
  const ordered = [...new Set(files)].sort(
    (a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const file of ordered) {
    let least = parts[0] as (typeof parts)[number];
    for (const part of parts) if (part.seconds < least.seconds) least = part;
    least.files.push(file);
    least.seconds += weightOf(file);
  }
  return parts.map((part) => part.files.sort());
}

/** The spec files part `current` of `total` runs (1-based). */
export function specsForPart(files: readonly string[], current: number, total: number): string[] {
  if (!Number.isInteger(current) || current < 1 || current > total) {
    throw new Error(`Part ${current} isn't one of ${total}.`);
  }
  return dealSpecs(files, total)[current - 1] as string[];
}
