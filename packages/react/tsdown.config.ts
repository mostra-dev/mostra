import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts", "src/router.ts"],
  format: "esm",
  platform: "browser",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  // React, React Router and react-hook-form are peer dependencies, never bundled: an artifact
  // has one copy of each, from the warm set (D91).
  tsconfig: "tsconfig.src.json",
});
