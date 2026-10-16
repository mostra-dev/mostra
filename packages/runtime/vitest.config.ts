import { defineConfig } from "vitest/config";

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
// `unit` runs in-process; `integration` drives the built `mostra-runtime` binary as real
// processes (sockets, process groups, start times) and runs in the `integration` CI job on macOS
// and Linux (D86).
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: {
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
          include: ["test/integration/**/*.test.ts"],
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
