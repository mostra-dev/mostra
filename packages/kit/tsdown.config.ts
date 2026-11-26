import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/questionnaire.tsx",
    "src/layout.tsx",
    "src/review.tsx",
    "src/tokens.tsx",
    "src/live-chart.tsx",
  ],
  // A kit module imports another by its name (`@mostra/kit/tokens`), as an artifact resolves it.
  deps: { neverBundle: [/^@mostra\/kit\//] },
  format: "esm",
  platform: "browser",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.src.json",
});
