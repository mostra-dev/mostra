/**
 * Writes `src/plugin/spdx.generated.ts` from the vendored SPDX License List data in `data/spdx/`
 * (WP-16). Run it after replacing those files with a newer release of
 * github.com/spdx/license-list-data (`json/licenses.json`, `json/exceptions.json`), and record the
 * release in VERIFIED_FACTS.
 *
 *   node packages/protocol/scripts/spdx.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spdxModule, spdxTables } from "../src/plugin/spdx-tables.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string): string => readFileSync(join(root, "data", "spdx", name), "utf8");
const tables = spdxTables(read("licenses.json"), read("exceptions.json"));
writeFileSync(join(root, "src", "plugin", "spdx.generated.ts"), spdxModule(tables));
process.stdout.write(
  `SPDX License List ${tables.version}: ${Object.keys(tables.licenses).length} licenses, ${tables.exceptions.length} exceptions\n`,
);
