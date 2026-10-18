import { defineConfig } from "vitest/config";

/**
 * `unit` runs in-process; `integration` runs the built `mostra` binary against real daemons (the
 * `integration` CI job on macOS and Linux, D86). The CLI's suites join the runtime's `core` group
 * (`MOSTRA_TEST_GROUP`, packages/runtime/vitest.config.ts): any other group runs none of them.
 */
const group = process.env["MOSTRA_TEST_GROUP"];
const integration =
  group === undefined || group === "" || group === "core" ? ["test/integration/**/*.test.ts"] : [];

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: {
    // A CI group other than `core` runs none of the CLI's integration suites.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], testTimeout: 30_000 },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integration,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
