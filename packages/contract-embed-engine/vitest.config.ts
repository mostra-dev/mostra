import { defineConfig } from "vitest/config";

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
export default defineConfig({
  resolve: { conditions: ["@mostra/source"] },
  ssr: { resolve: { conditions: ["@mostra/source"] } },
  test: { include: ["test/**/*.test.ts"] },
});
