import { defineConfig } from "vitest/config";

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  // Real worker processes: generous, so a loaded machine never fails a test by time alone.
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
