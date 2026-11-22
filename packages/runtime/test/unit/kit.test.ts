/**
 * The theme stack (D181 items 2 to 6, KT-04, WP-18): what a manifest's `kit.theme` resolves to,
 * the themes a plugin contributes, and what `theme/list` and `theme/show` answer of them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { oklch, THEME_REVISION, type ThemeLayer } from "@mostra/themes";
import { describe, expect, it } from "vitest";
import {
  contributedThemes,
  resolveThemeStack,
  themeShown,
  themeSummaries,
} from "../../src/kit/index.ts";
import { tempDir } from "../support.ts";

const brand: ThemeLayer = {
  revision: THEME_REVISION,
  id: "acme",
  name: "Acme",
  description: "Acme's brand over a built-in theme.",
  modes: { light: { primary: oklch(0.42, 0.15, 150), ring: oklch(0.42, 0.15, 150) } },
  tokens: { base: { "card-radius": "1.5rem" } },
};

/** A build layout with one plugin that contributes `themes`, as `mostra plugin add` leaves it. */
function layout(themes: Record<string, unknown>): { nodeModules: string; names: string[] } {
  const nodeModules = tempDir("kit-layout");
  const dir = join(nodeModules, "@acme", "mostra-theme");
  mkdirSync(join(dir, "themes"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@acme/mostra-theme",
      version: "1.0.0",
      mostra: {
        name: "com.acme/theme",
        contributes: {
          themes: Object.keys(themes).map((file) => ({ theme: `./themes/${file}` })),
        },
      },
    }),
  );
  for (const [file, theme] of Object.entries(themes)) {
    writeFileSync(join(dir, "themes", file), JSON.stringify(theme));
  }
  return { nodeModules, names: ["@acme/mostra-theme"] };
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic.code;
    throw error;
  }
  return undefined;
};

describe("a manifest's theme stack (D181 item 2)", () => {
  const source = tempDir("kit-source");
  writeFileSync(join(source, "brand.css"), ":root { --primary: oklch(0.5 0.2 30); }\n");

  it("is Studio when the page names none, and says so", () => {
    const build = resolveThemeStack({ manifest: {}, sourceDir: source });
    expect(build).toMatchObject({ stack: ["studio"], default: true, id: "studio", files: [] });
    expect(build.css).toContain("Studio (studio)");
  });

  it("builds a named theme, then the artifact's own layers, in order", () => {
    const build = resolveThemeStack({
      manifest: { kit: { theme: ["arcata", "./brand.css"] } },
      sourceDir: source,
    });
    expect(build).toMatchObject({ stack: ["arcata", "./brand.css"], default: false, id: "arcata" });
    expect(build.files).toEqual(["brand.css"]);
  });

  it("builds no theme for none, and places the host's look over or under the files after it", () => {
    expect(
      resolveThemeStack({ manifest: { kit: { theme: "none" } }, sourceDir: source }),
    ).toMatchObject({ css: "", files: [] });
    expect(
      resolveThemeStack({ manifest: { kit: { theme: ["studio", "host"] } }, sourceDir: source })
        .host,
    ).toBe("over");
    expect(
      resolveThemeStack({
        manifest: { kit: { theme: ["studio", "host", "./brand.css"] } },
        sourceDir: source,
      }).host,
    ).toBe("under");
  });

  it("refuses an unknown theme, a missing file and a stack that doesn't start with a theme", () => {
    const resolve = (theme: string | string[]) => () =>
      resolveThemeStack({ manifest: { kit: { theme } }, sourceDir: source });
    expect(codeOf(resolve("nope"))).toBe("MOSTRA_KIT_THEME_UNKNOWN");
    expect(codeOf(resolve(["studio", "./missing.css"]))).toBe("MOSTRA_KIT_THEME_FILE_MISSING");
    expect(codeOf(resolve(["./brand.css", "studio"]))).toBe("MOSTRA_MANIFEST_INVALID");
    expect(codeOf(resolve(["none", "studio"]))).toBe("MOSTRA_MANIFEST_INVALID");
  });
});

describe("themes a plugin contributes (D181 item 4)", () => {
  it("join the themes a stack may name, as layers over a complete one", () => {
    const { nodeModules, names } = layout({ "acme.json": brand });
    const contributed = contributedThemes(nodeModules, names);
    expect(contributed.map((entry) => [entry.theme.id, entry.package])).toEqual([
      ["acme", "@acme/mostra-theme"],
    ]);
    const build = resolveThemeStack({
      manifest: { kit: { theme: ["studio", "acme"] } },
      sourceDir: tempDir("kit-plugin"),
      contributed,
    });
    // The theme a stack makes is named by its last theme, as a layer names what it makes.
    expect(build.id).toBe("acme");
    expect(build.css).toContain("--card-radius: 1.5rem;");
    expect(build.css).toContain("--primary: oklch(0.42 0.15 150);");
    // A layer that sets no face leaves Studio's, served from @mostra/themes (Opus review 5).
    expect(build.css).toContain(
      'url("@mostra:face/@mostra/themes/fonts/figtree-latin-wght-normal.woff2")',
    );
    expect(build.css).not.toContain("@acme/mostra-theme/fonts/");
    // A layer's own face is served from its own package, the rest still from @mostra/themes.
    const withFace: ThemeLayer = {
      ...brand,
      id: "acme-type",
      faces: {
        display: {
          family: "Acme Display",
          fallback: "ui-sans-serif, sans-serif",
          files: [
            {
              file: "fonts/acme-display.woff2",
              weight: "400 800",
              style: "normal",
              unicodeRange: "U+0000-00FF",
            },
          ],
        },
      },
    };
    const typed = layout({ "acme-type.json": withFace });
    const typedBuild = resolveThemeStack({
      manifest: { kit: { theme: ["studio", "acme-type"] } },
      sourceDir: tempDir("kit-plugin-face"),
      contributed: contributedThemes(typed.nodeModules, typed.names),
    });
    expect(typedBuild.css).toContain(
      'url("@mostra:face/@acme/mostra-theme/fonts/acme-display.woff2")',
    );
    expect(typedBuild.css).toContain(
      'url("@mostra:face/@mostra/themes/fonts/figtree-latin-wght-normal.woff2")',
    );
    expect(typedBuild.css).not.toContain("@acme/mostra-theme/fonts/figtree");
    // A layer can't start a stack: it isn't a complete theme.
    expect(
      codeOf(() =>
        resolveThemeStack({
          manifest: { kit: { theme: "acme" } },
          sourceDir: tempDir("kit-p"),
          contributed,
        }),
      ),
    ).toBe("MOSTRA_KIT_THEME_UNKNOWN");
    expect(themeSummaries(contributed)).toEqual([
      expect.objectContaining({ id: "studio", source: "built-in", complete: true, default: true }),
      expect.objectContaining({ id: "arcata", source: "built-in", complete: true, default: false }),
      expect.objectContaining({
        id: "acme",
        source: "plugin",
        package: "@acme/mostra-theme",
        complete: false,
      }),
    ]);
  });

  it("are refused when the file isn't a theme, or takes a built-in theme's id", () => {
    const broken = layout({ "broken.json": { ...brand, id: "Not An Id" } });
    expect(codeOf(() => contributedThemes(broken.nodeModules, broken.names))).toBe(
      "MOSTRA_KIT_THEME_UNKNOWN",
    );
    const taken = layout({ "studio.json": { ...brand, id: "studio" } });
    expect(
      codeOf(() =>
        resolveThemeStack({
          manifest: {},
          sourceDir: tempDir("kit-taken"),
          contributed: contributedThemes(taken.nodeModules, taken.names),
        }),
      ),
    ).toBe("MOSTRA_KIT_THEME_CONFLICT");
  });

  it("build, with a warning, when a layer breaks a text pair (D68: nothing is refused for its look)", () => {
    const pale = layout({
      "pale.json": { ...brand, id: "pale", modes: { light: { primary: oklch(0.95, 0.02, 150) } } },
    });
    const build = resolveThemeStack({
      manifest: { kit: { theme: ["studio", "pale"] } },
      sourceDir: tempDir("kit-pale"),
      contributed: contributedThemes(pale.nodeModules, pale.names),
    });
    expect(build.warnings.map((warning) => warning.code)).toEqual(["MOSTRA_KIT_THEME_CONTRAST"]);
    expect(build.css).toContain("--primary: oklch(0.95 0.02 150);");
  });
});

describe("what theme/show answers (D181 item 6)", () => {
  it("names the faces and every value by mode, and the stylesheet on request", () => {
    const build = resolveThemeStack({
      manifest: { kit: { theme: "arcata" } },
      sourceDir: tempDir("kit-show"),
    });
    const shown = themeShown(build, true);
    expect(shown).toMatchObject({
      stack: ["arcata"],
      id: "arcata",
      name: "Arcata",
      faces: { sans: "Figtree", display: "Jost", mono: "Spline Sans Mono" },
      files: [],
      warnings: [],
    });
    expect(shown.values?.light["--primary"]).toMatch(/^oklch\(/);
    expect(shown.values?.dark["--background"]).toMatch(/^oklch\(/);
    expect(shown.values?.base["--font-display"]).toContain("Jost");
    for (const [name, value] of Object.entries(shown.values?.base ?? {})) {
      expect(shown.css).toContain(`${name}: ${value};`);
    }
    expect(themeShown(build, false).css).toBeUndefined();
  });
});
