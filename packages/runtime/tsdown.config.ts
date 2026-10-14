import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/builder/child/main.ts", "src/deps/child/install.ts"],
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
  tsconfig: "tsconfig.src.json",
  // better-sqlite3 is a native dependency loaded at run time, never bundled.
  external: ["better-sqlite3"],
});
