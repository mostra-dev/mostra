import { defineConfig } from "vitest/config";

/**
 * `unit` runs in-process, with synthetic bundles and a local file server; `integration` spawns
 * real instances of the runtime built beside this package (the `integration` CI job on macOS and
 * Linux, D86), in the runtime's `core` group (`MOSTRA_TEST_GROUP`).
 */
const group = process.env["MOSTRA_TEST_GROUP"];
const integration =
  group === undefined || group === "" || group === "core" ? ["test/integration/**/*.test.ts"] : [];

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], testTimeout: 60_000 },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integration,
          testTimeout: 180_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
