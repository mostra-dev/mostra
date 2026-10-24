/**
 * `mostra dev`'s manifest-export plugin (D140 item 12): it blanks the entry's `export` of its
 * manifest so React Fast Refresh can update the entry in place. Vite names modules with `/` on
 * every platform, so on Windows the entry (`C:\…`) must be recognised in Vite's spelling (`C:/…`):
 * otherwise every edit reloaded the page (found on the Windows legs, WP-W2).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifestExportPlugin } from "../../src/builder/child/dev.ts";
import { WINDOWS } from "../../src/platform/index.ts";

const SOURCE = `export const artifact = defineArtifact({ title: "x" });\nexport default function Page() {\n  return null;\n}\n`;

function transform(entry: string, id: string): string | undefined {
  const plugin = manifestExportPlugin(entry);
  const hook = plugin.transform as (code: string, id: string) => { code: string } | null;
  return hook.call({}, SOURCE, id)?.code;
}

describe("the dev manifest-export plugin", () => {
  it("blanks the entry's manifest export, keeping every position, and leaves other modules alone", () => {
    const entry = join("/", "work", "artifact", "index.tsx");
    const code = transform(entry, `${entry}?t=1`);
    expect(code).toBeDefined();
    expect(code).not.toContain("export const artifact");
    expect(code).toHaveLength(SOURCE.length);
    expect(transform(entry, join("/", "work", "artifact", "other.tsx"))).toBeUndefined();
  });

  it.runIf(WINDOWS)("recognises the entry as Vite spells it on Windows", () => {
    const entry = "C:\\Users\\me\\artifact\\index.tsx";
    expect(transform(entry, "C:/Users/me/artifact/index.tsx")).toBeDefined();
    expect(transform(entry, "c:/users/me/artifact/index.tsx?v=2")).toBeDefined();
  });
});
