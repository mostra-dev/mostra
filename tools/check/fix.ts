#!/usr/bin/env node
/**
 * `pnpm fix`: applies every autofix the gates know: Biome formatting and safe lint fixes, ESLint
 * fixes, cargo fmt, and regenerated references (diagnostic pages, wire-schema snapshots).
 * Review the diff afterwards: generated files changing means a public surface changed.
 */
import { existsSync } from "node:fs";
import { fromRoot, runSync } from "../lib/repo.ts";
import { listPackages } from "../lib/workspace.ts";

const steps: [string, string, string[], string?][] = [
  ["biome", "node_modules/.bin/biome", ["check", "--write", "--colors=off", "."]],
  [
    "eslint",
    "tools/ts6/node_modules/.bin/eslint",
    ["--config", "tools/ts6/eslint.config.mjs", "--fix", "."],
  ],
  ["diagnostic references", "node", ["tools/docs/diagnostics.ts", "write"]],
  ["CLI reference", "node", ["--conditions=@mostra/source", "tools/docs/cli.ts", "write"]],
];
if (existsSync(fromRoot("Cargo.toml"))) steps.push(["cargo fmt", "cargo", ["fmt", "--all"]]);
for (const pkg of listPackages()) {
  if (pkg.scripts["gen:schemas"])
    steps.push([`${pkg.name} schemas`, "pnpm", ["run", "gen:schemas"], fromRoot(pkg.dir)]);
}

let failed = 0;
for (const [label, command, args, cwd] of steps) {
  const result = runSync(command, args, cwd ? { cwd } : {});
  console.log(`${result.code === 0 ? "✓" : "✗"} ${label}`);
  if (result.code !== 0) {
    failed++;
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
}
process.exit(failed > 0 ? 1 : 0);
