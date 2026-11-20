/**
 * Themes as layers and as an artifact's stylesheet (D178 items 2 and 3, KT-04): every token of the
 * contract reaches the stylesheet, a layer changes only what it names, a stack is checked as a
 * theme is, and nothing a theme writes outranks an artifact's own rule.
 */
import {
  ARTIFACT_THEMES,
  arcata,
  composeThemes,
  defineThemeLayer,
  isCompleteTheme,
  kitStylesheet,
  oklch,
  studio,
  THEME_REVISION,
  ThemeError,
  type ThemeLayer,
  TOKEN_NAMES,
  TOKENS,
} from "@mostra/themes";
import { describe, expect, it } from "vitest";

const layer = (changes: Partial<ThemeLayer>): ThemeLayer => ({
  revision: THEME_REVISION,
  id: "brand",
  name: "Brand",
  description: "A brand over a built-in theme.",
  ...changes,
});

describe("the token contract", () => {
  it("names every token once, each with a group, a description and a default", () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
    expect(Object.keys(TOKENS).sort()).toEqual([...TOKEN_NAMES].sort());
    for (const name of TOKEN_NAMES) {
      expect(TOKENS[name].description.length).toBeGreaterThan(5);
      expect(TOKENS[name].default.length).toBeGreaterThan(0);
    }
  });

  it("reaches the stylesheet: every token at its default, then the theme's value", () => {
    const css = kitStylesheet(studio);
    for (const name of TOKEN_NAMES) expect(css).toContain(`--${name}: ${TOKENS[name].default};`);
    expect(css).toContain("--card-shadow: inset 0 2px 0 var(--rule);");
    // The theme's value comes after the default, so it wins.
    expect(css.lastIndexOf("--card-radius: 0px;")).toBeGreaterThan(
      css.indexOf(`--card-radius: ${TOKENS["card-radius"].default};`),
    );
  });
});

describe("the built-in themes", () => {
  it("are Studio and Arcata, each complete and accessible (defineTheme ran on load)", () => {
    expect(Object.keys(ARTIFACT_THEMES)).toEqual(["studio", "arcata"]);
    for (const theme of Object.values(ARTIFACT_THEMES)) expect(isCompleteTheme(theme)).toBe(true);
  });

  it("differ in shape, depth and surfaces, not only in colour", () => {
    const set = (name: string, base: Record<string, string> | undefined) => base?.[name];
    for (const name of ["card-radius", "card-shadow", "choice-selected-bg", "menu-highlight"]) {
      expect(set(name, studio.tokens?.base)).not.toBe(set(name, arcata.tokens?.base));
    }
  });
});

describe("an artifact's stylesheet", () => {
  const css = kitStylesheet(arcata, { faceUrl: (file) => `/faces/${file}` });

  it("lets any rule of the artifact's own win: tokens of no specificity, element rules layered", () => {
    const [outside, base = ""] = css.split("@layer base {");
    const selectors = [...(outside ?? "").matchAll(/^\s*([^@/\s][^{\n]*?)\s*\{\s*$/gm)].map((m) =>
      (m[1] as string).trim(),
    );
    expect(selectors.length).toBeGreaterThan(3);
    for (const selector of selectors) expect(selector, selector).toMatch(/^:where\(/);
    // Everything else sits in Tailwind's base layer, which unlayered CSS always overrides.
    expect(base).toContain("h1 {");
    expect(base.trimEnd().endsWith("}")).toBe(true);
  });

  it("gives light and dark, the device's dark unless the page chose light, and a person's choice", () => {
    expect(css).toContain(':where(:root:not([data-appearance="light"]))');
    expect(css).toContain(':where(:root[data-appearance="dark"])');
    expect(css).toContain(':where(:root[data-appearance="light"])');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("maps the tokens to Tailwind utilities and serves the faces from where it is told", () => {
    expect(css).toContain("@theme inline {");
    for (const utility of [
      "--color-highlight",
      "--radius-choice",
      "--shadow-popover",
      "--font-heading",
    ]) {
      expect(css).toContain(utility);
    }
    expect(css).toContain('src: url("/faces/fonts/figtree-latin-wght-normal.woff2")');
  });

  it("is deterministic", () => {
    expect(kitStylesheet(arcata, { faceUrl: (file) => `/faces/${file}` })).toBe(css);
  });
});

describe("a stack (D178 item 2)", () => {
  it("lays each layer over the one before, later winning, the CSS of each in order", () => {
    const brand = defineThemeLayer(
      layer({
        modes: { light: { primary: oklch(0.5, 0.2, 150) } },
        tokens: { base: { "card-radius": "6px" } },
        css: ":where([data-slot=card]) { outline: 0; }",
      }),
    );
    const theme = composeThemes(studio, brand);
    expect(theme.id).toBe("brand");
    expect(theme.modes.light.primary.hex).toBe(brand.modes?.light?.primary?.hex);
    expect(theme.modes.light.background).toBe(studio.modes.light.background);
    expect(theme.modes.dark.primary).toBe(studio.modes.dark.primary);
    expect(theme.tokens?.base?.["card-radius"]).toBe("6px");
    expect(theme.tokens?.base?.["menu-highlight"]).toBe(studio.tokens?.base?.["menu-highlight"]);
    expect(theme.css?.indexOf(studio.css as string)).toBe(0);
    expect(theme.css).toContain("outline: 0");
  });

  it("is checked as a theme: a layer that breaks a text pair is named", () => {
    const pale = defineThemeLayer(
      layer({ modes: { light: { mutedForeground: oklch(0.85, 0, 0) } } }),
    );
    expect(() => composeThemes(studio, pale)).toThrow(/light: mutedForeground on background/);
  });

  it("refuses a layer naming a token that isn't one, a value a token can't hold, or CSS that loads", () => {
    expect(() =>
      defineThemeLayer(layer({ tokens: { base: { "no-such": "1" } as never } })),
    ).toThrow(/tokens\.base\.no-such: no such token/);
    expect(() =>
      defineThemeLayer(layer({ tokens: { base: { "card-radius": "0; } body { x" } } })),
    ).toThrow(ThemeError);
    expect(() =>
      defineThemeLayer(layer({ tokens: { base: { field: "url(https://x)" } } })),
    ).toThrow(ThemeError);
    expect(() => defineThemeLayer(layer({ css: '@import "https://example.com/x.css";' }))).toThrow(
      /no @import and no url/,
    );
  });

  it("tells a complete theme from a layer", () => {
    expect(isCompleteTheme(studio)).toBe(true);
    expect(isCompleteTheme(layer({ modes: { light: { primary: oklch(0.5, 0.2, 150) } } }))).toBe(
      false,
    );
  });
});
