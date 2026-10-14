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
      { extends: true, test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
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
