import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "@mostra/conformance";
import { describe, expect, it } from "vitest";

/** JCODE_HOST.md's "How Mostra meets each need": each row's ID and the scenarios it names. */
function rows(): { id: string; scenarios: string[] }[] {
  const text = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "docs", "design", "JCODE_HOST.md"),
    "utf8",
  );
  const section = text.slice(text.indexOf("## How Mostra meets each need"));
  return [...section.matchAll(/^\| (H-\d\d) \| .* \| (.*) \|$/gm)].map((match) => ({
    id: match[1] as string,
    scenarios: [...(match[2] as string).matchAll(/`([a-z]+\.[a-z-]+)`/g)].map(
      (found) => found[1] as string,
    ),
  }));
}

describe("every host need is exercised by a scenario (HO-06, WP-12 acceptance)", () => {
  it("H-01 to H-16 each name scenarios that exist and cover them", () => {
    const table = rows();
    expect(table.map((row) => row.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `H-${String(i + 1).padStart(2, "0")}`),
    );
    for (const row of table) {
      expect(row.scenarios.length, row.id).toBeGreaterThan(0);
      for (const id of row.scenarios) {
        const scenario = SCENARIOS.find((candidate) => candidate.id === id);
        expect(scenario, `${row.id} names ${id}`).toBeDefined();
        expect(scenario?.covers, `${id} covers ${row.id}`).toContain(row.id);
      }
    }
  });

  it("every scenario that claims a host need is named on that need's row", () => {
    const table = new Map(rows().map((row) => [row.id, row.scenarios]));
    for (const scenario of SCENARIOS) {
      for (const need of scenario.covers.filter((id) => id.startsWith("H-"))) {
        expect(table.get(need), `${scenario.id} claims ${need}`).toContain(scenario.id);
      }
    }
  });
});
