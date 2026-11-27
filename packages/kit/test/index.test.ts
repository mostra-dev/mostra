import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("is shown to agents: the Skill's references name every module (WP-19)", () => {
    const references = new URL("../../../skills/mostra/references/", import.meta.url);
    const text = readdirSync(references)
      .filter((name) => name.endsWith(".md"))
      .map((name) => readFileSync(new URL(name, references), "utf8"))
      .join("\n");
    const unnamed = KIT_MODULES.filter((module) => !text.includes(`@mostra/kit/${module}`));
    // `tokens` is shown through the parts that re-export it (`useTokens` from `@mostra/kit/scene`).
    expect(unnamed.filter((module) => module !== "tokens")).toEqual([]);
  });
});
