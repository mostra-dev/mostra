import { defineConfig } from "vitest/config";

// Tests import the package by name, resolved to its source through the `@mostra/source` condition,
// so they exercise the public entry point without a build step.
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: { include: ["test/**/*.test.ts"] },
});
