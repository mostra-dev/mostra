import { defineConfig } from "vitest/config";

// Gate tests run real tools against a repository copy, so they get generous timeouts and run
// one file at a time.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
