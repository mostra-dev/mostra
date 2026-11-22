import { defineConfig } from "vitest/config";

/**
 * `unit` runs in-process (baselines, the harness protocol, the viewer's cookie jar); `integration`
 * runs the kit against real hosts (the TypeScript reference host, standalone and with every port,
 * and the broken host with its baseline) on real instances of the runtime built beside this
 * package, in the `conformance` group (`MOSTRA_TEST_GROUP`, packages/runtime/vitest.config.ts). The
 * Rust reference host runs in the `conformance` job.
 */
const group = process.env["MOSTRA_TEST_GROUP"];
const integration =
  group === undefined ||
  group === "" ||
  // A group of its own, apart from the other clients' suites: on Windows arm64 the kit takes about
  // 11.5 of its 14 minutes (#225), on macOS about 460 s of its 10 minutes (WP-18).
  group === "conformance" ||
  group === "windows-conformance"
    ? ["test/integration/**/*.test.ts"]
    : [];

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
          testTimeout: 900_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
