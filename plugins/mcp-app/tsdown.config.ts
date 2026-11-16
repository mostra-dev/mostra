import { defineConfig } from "tsdown";

// The exporter runs in a plugin child on Node.js (D172 item 5): its dependencies stay external,
// resolved from the plugin's own layout.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
  tsconfig: "tsconfig.src.json",
});
