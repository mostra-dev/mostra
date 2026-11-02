/**
 * The harness-plugin generator (AX-10, D147, WP-14):
 *
 *   node tools/plugins/cli.ts build --out <dir> [--version <v>] [--prove localMcp]
 *   node tools/plugins/cli.ts check [<dir>] [--version <v>]
 *
 * `build` writes the plugin's repository for a release (default: the release group's version)
 * into an empty directory; `check` holds a built plugin to every harness's and directory's rules,
 * building one into a scratch directory when none is given (CI's `docs` job). The telemetry
 * endpoint is the release's own (`MOSTRA_RELEASE_TELEMETRY_ENDPOINT`, as the CLI's build reads
 * it), so the README discloses what the release does. `build --prove localMcp` builds the plugin
 * as if its local server were on, for the run that proves its launch on a system
 * (`.github/workflows/harness-plugins.yml`) before `verifiedOn` names that system; `check` still
 * judges the definition as it is.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { option as argOption } from "../lib/release-version.ts";
import { current } from "../release/versions.ts";
import { buildPlugin, writeTree } from "./build.ts";
import { checkPlugin } from "./check.ts";
import { PLUGIN } from "./definition.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const option = (name: string): string | undefined => argOption(process.argv, name);

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
    const prove = option("--prove");
    if (prove !== undefined && prove !== "localMcp") {
      console.error("--prove takes localMcp, the feature whose launch a run proves");
      process.exitCode = 2;
      return;
    }
    const definition =
      prove === undefined
        ? PLUGIN
        : {
            ...PLUGIN,
            features: {
              ...PLUGIN.features,
              localMcp: { ...PLUGIN.features.localMcp, enabled: true },
            },
          };
    writeTree(buildPlugin(definition, input), out);
    console.log(
      `✓ plugin ${PLUGIN.name} ${version} written to ${out}${prove ? ` (${prove} on, to prove it)` : ""}`,
    );
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
