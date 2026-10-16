import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Tests import the package by name, resolved to source through the `@mostra/source` condition.
// `unit` runs the store and the protocol logic in Node; `browser` renders the hooks with React in
// a real Chromium, with IndexedDB, BroadcastChannel and `window.storage` as artifacts get them
// (AU-08). The cross-engine behavior is the end-to-end suites' (tests/e2e).
const resolve = { conditions: ["@mostra/source"] };

export default defineConfig({
  resolve,
  ssr: { resolve },
  test: {
    projects: [
      {
        resolve,
        ssr: { resolve },
        test: { name: "unit", include: ["test/**/*.test.ts"] },
      },
      {
        resolve,
        optimizeDeps: { include: ["react", "react-dom/client", "react-hook-form", "react-router"] },
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
