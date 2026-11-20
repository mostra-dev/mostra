import { existsSync } from "node:fs";
import { KIT_BASES, KIT_MODULES } from "@mostra/kit";
import { describe, expect, it } from "vitest";

describe("@mostra/kit", () => {
  it("carries each of its modules as an export and as a registry item in every base", () => {
    for (const module of KIT_MODULES) {
      expect(existsSync(new URL(`../src/${module}.tsx`, import.meta.url)), module).toBe(true);
      for (const base of KIT_BASES) {
        const item = new URL(`../registry/${base}/mostra-${module}.json`, import.meta.url);
        expect(existsSync(item), `${base}/mostra-${module}`).toBe(true);
      }
    }
  });
});
