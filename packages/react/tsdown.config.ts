import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts", "src/router.ts"],
  format: "esm",
  platform: "browser",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  // React and its routers are the artifact's single copies (D91), never bundled in.
  external: [
    "react",
    "react-dom",
    "react-dom/client",
    "react-router",
    "react-router/dom",
    "react-hook-form",
  ],
  tsconfig: "tsconfig.src.json",
});
