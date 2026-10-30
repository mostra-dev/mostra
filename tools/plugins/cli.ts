/**
 * The harness-plugin generator (AX-10, D147, WP-14):
 *
 *   node tools/plugins/cli.ts build --out <dir> [--version <v>]
 *   node tools/plugins/cli.ts check [<dir>] [--version <v>]
 *
 * `build` writes the plugin's repository for a release (default: the release group's version)
 * into an empty directory; `check` holds a built plugin to every harness's and directory's rules,
 * building one into a scratch directory when none is given (CI's `docs` job). The telemetry
 * endpoint is the release's own (`MOSTRA_RELEASE_TELEMETRY_ENDPOINT`, as the CLI's build reads
 * it), so the README discloses what the release does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { current } from "../release/versions.ts";
import { buildPlugin, writeTree } from "./build.ts";
import { checkPlugin } from "./check.ts";
import { PLUGIN } from "./definition.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

function main(): void {
  const command = process.argv[2];
  const version = option("--version") ?? current(ROOT);
  const telemetryEndpoint = process.env["MOSTRA_RELEASE_TELEMETRY_ENDPOINT"] ?? "";
  const input = { root: ROOT, version, telemetryEndpoint };
  if (command === "build") {
    const out = option("--out");
    if (out === undefined) {
      console.error("usage: cli.ts build --out <dir> [--version <v>]");
      process.exitCode = 2;
      return;
    }
    writeTree(buildPlugin(PLUGIN, input), out);
    console.log(`✓ plugin ${PLUGIN.name} ${version} written to ${out}`);
    return;
  }
  if (command === "check") {
    const given = process.argv[3]?.startsWith("--") ? undefined : process.argv[3];
    const dir = given ?? mkdtempSync(join(tmpdir(), "mostra-plugin-"));
    try {
      if (given === undefined) writeTree(buildPlugin(PLUGIN, input), dir);
      const problems = checkPlugin(dir, PLUGIN, input);
      for (const problem of problems) console.error(`✗ ${problem}`);
      if (problems.length > 0) {
        process.exitCode = 1;
        return;
      }
      const features = Object.entries(PLUGIN.features)
        .map(
          ([name, feature]) => `${name} ${feature.enabled ? "on" : `off until ${feature.owner}`}`,
        )
        .join(", ");
      console.log(
        `✓ plugin ${PLUGIN.name} ${version}: every harness's manifest and rule hold (${features})`,
      );
    } finally {
      if (given === undefined) rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  console.error("usage: cli.ts build --out <dir> [--version <v>] | check [<dir>] [--version <v>]");
  process.exitCode = 2;
}

if (import.meta.main) main();
