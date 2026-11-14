/**
 * The test registry as a process of its own, for suites outside this package (the CLI's): it
 * serves `FIXTURE_PACKAGES` and the plugin fixtures, prints `{ "url": … }` on one line, and stops
 * when its stdin closes. Run with `node packages/runtime/test/registry-process.ts`.
 */
import { pluginFixtures } from "./plugin-fixtures.ts";
import { FIXTURE_PACKAGES, startRegistry } from "./registry.ts";

const registry = await startRegistry([...FIXTURE_PACKAGES, ...pluginFixtures()]);
process.stdout.write(`${JSON.stringify({ url: registry.url })}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  void registry.close().then(() => process.exit(0));
});
