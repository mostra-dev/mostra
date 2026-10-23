import { configDefaults, defineConfig } from "vitest/config";

/**
 * The integration suites in groups, each its own CI machine per platform (REPO_STANDARDS §6), so
 * the job stays inside its time while verify's real-browser suites grow. `MOSTRA_TEST_GROUP`
 * picks one; unset, every suite runs (`pnpm check --job integration` on a laptop). The groups
 * partition the files by name, so a new suite always lands in exactly one: `verify*` suites in
 * `verify` (but the failure suite, which has a group of its own), everything else in `core`.
 * `clients` is the CLI's, the SDK's and `create-mostra`'s suites (WP-11): none of the runtime's,
 * so their instances never compete with the runtime's suites for one machine's CPU.
 */
const VERIFY_SUITES = "test/integration/verify*.test.ts";
const VERIFY_FAILURES = "test/integration/verify-failures.test.ts";
const INTEGRATION_GROUPS: Record<string, { include: string[]; exclude: string[] }> = {
  core: { include: ["test/integration/**/*.test.ts"], exclude: [VERIFY_SUITES] },
  verify: { include: [VERIFY_SUITES], exclude: [VERIFY_FAILURES] },
  "verify-failures": { include: [VERIFY_FAILURES], exclude: [] },
  clients: { include: [], exclude: [] },
  // The Windows legs (WP-W1, D146): WP-01 to WP-04's real-process suites, the ones the platform
  // layer ports so far, in two groups, one machine each (Windows arm64 runs them about twice as
  // slowly as x64). Unlike the groups above they overlap them: they are what runs on Windows, and
  // WP-W2 and WP-W3 add the rest.
  windows: {
    include: [
      "test/integration/instance.test.ts",
      "test/integration/platform.test.ts",
      "test/integration/reaping.test.ts",
      "test/integration/processes.test.ts",
      "test/integration/deps.test.ts",
      "test/integration/windows.test.ts",
    ],
    exclude: [],
  },
  "windows-publish": {
    include: [
      "test/integration/protocol-suite.test.ts",
      "test/integration/publish.test.ts",
      "test/integration/publish-faults.test.ts",
      "test/integration/ancestors.test.ts",
      "test/integration/audit.test.ts",
      "test/integration/render.test.ts",
    ],
    exclude: [],
  },
};
const group = process.env["MOSTRA_TEST_GROUP"];
const integrationFiles = group
  ? INTEGRATION_GROUPS[group]
  : { include: ["test/integration/**/*.test.ts"], exclude: [] };
if (!integrationFiles) {
  throw new Error(
    `MOSTRA_TEST_GROUP is "${group}"; the integration groups are ${Object.keys(INTEGRATION_GROUPS).join(", ")}.`,
  );
}

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
// `unit` runs in-process; `integration` drives the built `mostra-runtime` binary as real
// processes (sockets, process groups, start times) and runs in the `integration` CI job on macOS
// and Linux (D86).
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: {
    // The `clients` integration group runs none of the runtime's suites (a root option: vitest
    // reads it only here).
    passWithNoTests: integrationFiles.include.length === 0,
    projects: [
      {
        extends: true,
        // A full local `pnpm check` runs every package's suites at once; 5 s starved a 0.3 s test
        // (WP-08's check), so time limits here bound hangs, never speed.
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], testTimeout: 30_000 },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integrationFiles.include,
          exclude: [...configDefaults.exclude, ...integrationFiles.exclude],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Real processes compete for the CPU; one file at a time keeps timings honest.
          fileParallelism: false,
        },
      },
      {
        // The hygiene checklist (HY-01) against a real daemon, run by the `hygiene` CI job.
        extends: true,
        test: {
          name: "hygiene",
          include: ["test/hygiene/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        // External evidence (STANDARDS, Verification layer 7): the real npm registry. Run by hand
        // with `pnpm --filter @mostra/runtime test:external`; never part of CI.
        extends: true,
        test: {
          name: "external",
          include: ["test/external/**/*.test.ts"],
          testTimeout: 600_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
