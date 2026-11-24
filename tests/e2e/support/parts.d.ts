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
export declare const SPEC_SECONDS: Readonly<Record<string, number>>;
/**
 * Deals `files` into `total` parts, longest first, each to the part with the least so far (ties:
 * the file's name, then the lower part), and answers every part's files. Deterministic, so every
 * machine of a run agrees on its own part.
 */
export declare function dealSpecs(files: readonly string[], total: number): string[][];
/** The spec files part `current` of `total` runs (1-based). */
export declare function specsForPart(
  files: readonly string[],
  current: number,
  total: number,
): string[];
