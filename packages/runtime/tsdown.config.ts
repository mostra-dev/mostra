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
  // The remote MCP server's docs (`docs_search`, INTERFACES §18.8): the bundled reference and the
  // Agent Skill, as the CLI ships them (D162).
  copy: [
    { from: "../../docs/reference", to: "dist" },
    { from: "../../skills/mostra", to: "dist", rename: "skill" },
  ],
});
