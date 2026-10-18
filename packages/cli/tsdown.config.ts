import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/telemetry/flush-main.ts"],
  format: "esm",
  platform: "node",
  target: "es2024",
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
  tsconfig: "tsconfig.src.json",
  // `mostra docs` reads the reference that ships with the CLI (D140 item 17).
  copy: [{ from: "../../docs/reference", to: "dist" }],
  // The telemetry endpoint is set only by the release workflow (D140 item 7): empty here.
  define: {
    __MOSTRA_TELEMETRY_ENDPOINT__: JSON.stringify(
      process.env["MOSTRA_RELEASE_TELEMETRY_ENDPOINT"] ?? "",
    ),
  },
});
