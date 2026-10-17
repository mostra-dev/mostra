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
  // The client runtime's modules carry "use client" (D19 seam 4). The bundler keeps it at the top
  // of each entry, which is what an RSC bundler reads; inside shared chunks it has no meaning.
  inputOptions: {
    onLog(level, log, handler) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE" && log.message.includes('"use client"')) return;
      handler(level, log);
    },
  },
});
