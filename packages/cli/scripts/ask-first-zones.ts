/**
 * Writes `src/telemetry/zones.generated.ts` from the vendored tzdata files in `data/tzdata/`
 * (D140 item 10). Run it after replacing those files with a newer tzdata release, and record the
 * release in VERIFIED_FACTS.
 *
 *   node packages/cli/scripts/ask-first-zones.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildZoneSets, zonesModule } from "../src/telemetry/zone-sets.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string): string => readFileSync(join(root, "data", "tzdata", name), "utf8");
const sets = buildZoneSets({
  version: read("version"),
  zoneTab: read("zone.tab"),
  backward: read("backward"),
  etcetera: read("etcetera"),
  factory: read("factory"),
});
writeFileSync(join(root, "src", "telemetry", "zones.generated.ts"), zonesModule(sets));
process.stdout.write(
  `tzdata ${sets.version}: ${sets.askFirst.length} ask-first zones of ${sets.known.length}\n`,
);
