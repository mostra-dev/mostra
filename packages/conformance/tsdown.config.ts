import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/reference-host.ts"],
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
  tsconfig: "tsconfig.src.json",
});
