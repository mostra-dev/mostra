import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/questionnaire.tsx",
    "src/layout.tsx",
    "src/review.tsx",
    "src/demo.tsx",
  ],
  format: "esm",
  platform: "browser",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.src.json",
});
