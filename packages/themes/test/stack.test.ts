/**
 * Themes as layers and as an artifact's stylesheet (D181 items 2 and 3, KT-04): every token of the
 * contract reaches the stylesheet, a layer changes only what it names, a stack is checked as a
 * theme is, and nothing a theme writes outranks an artifact's own rule.
 */
import {
  ARTIFACT_THEMES,
  arcata,
  composeThemes,
  defineThemeLayer,
  type FontFile,
  isCompleteTheme,
  kitStylesheet,
  oklch,
  studio,
  THEME_REVISION,
  ThemeError,
  type ThemeLayer,
  TOKEN_NAMES,
  TOKENS,
  themeValues,
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

  it("reaches the stylesheet: every token once, at the theme's value or the format's default", () => {
    const css = kitStylesheet(studio);
    const root = css.slice(css.indexOf(":where(:root) {"), css.indexOf("@media"));
    for (const name of TOKEN_NAMES) {
      const value =
        studio.tokens?.base?.[name] ?? studio.tokens?.light?.[name] ?? TOKENS[name].default;
      expect(root.split(`--${name}: `).length - 1, name).toBe(1);
      expect(root).toContain(`--${name}: ${value};`);
    }
    expect(root).toContain("--card-shadow: inset 0 2px 0 var(--rule);");
    expect(root).toContain("--card-radius: 0px;");
    // What `mostra theme show` prints is what the stylesheet sets.
    const values = themeValues(studio);
    for (const [name, value] of Object.entries({ ...values.base, ...values.light })) {
      expect(root).toContain(`${name}: ${value};`);
    }
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

describe("a stack (D181 item 2)", () => {
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
      /no @import, no escapes/,
    );
  });

  it("refuses CSS, a face or a name that could add rules or fetch from elsewhere (Opus review 1)", () => {
    const loads = [
      'html { background: image-set("https://x.example/t.png" 1x); }',
      'html { background: -webkit-image-set("https://x.example/t.png" 1x); }',
      "html { background: \\75 rl(https://x.example/t.png); }",
      '@\\69mport "https://x.example/x.css";',
      'html { background: image("https://x.example/t.png"); }',
      "html { background: cross-fade(red, blue); }",
      'html { background: src("https://x.example/t.png"); }',
    ];
    for (const css of loads) {
      expect(() => defineThemeLayer(layer({ css })), css).toThrow(/no @import, no escapes/);
    }
    for (const field of ['image-set("https://x" 1x)', "a\\62", 'src("x")']) {
      expect(() => defineThemeLayer(layer({ tokens: { base: { field } } })), field).toThrow(
        /isn't a value a token can hold/,
      );
    }
    const file = studio.faces.sans.files[0] as FontFile;
    const face = (changes: Partial<FontFile>) =>
      layer({ faces: { sans: { ...studio.faces.sans, files: [{ ...file, ...changes }] } } });
    const breakout = 'U+0-FF;} html{background:image-set("https://x.example/t.png" 1x)} x{a:b';
    expect(() => defineThemeLayer(face({ unicodeRange: breakout }))).toThrow(/unicodeRange/);
    expect(() => defineThemeLayer(face({ weight: "400; } html { x" }))).toThrow(/weight/);
    expect(() => defineThemeLayer(face({ style: "normal; } x {" as never }))).toThrow(/style/);
    expect(() =>
      defineThemeLayer(face({ weight: "300 900", unicodeRange: "U+0000-00FF, U+0131" })),
    ).not.toThrow();
    expect(() => defineThemeLayer(layer({ name: "Brand */ html { x: y } /*" }))).toThrow(
      /name: no "\*\/"/,
    );
    expect(() => defineThemeLayer(layer({ description: "One\nline" }))).toThrow(/description/);
    // Written into a comment as it can stand there, should a theme's name reach one unchecked.
    expect(kitStylesheet({ ...studio, name: "A */ b" })).toContain("/* A * / b (studio)");
  });

  it("tells a complete theme from a layer", () => {
    expect(isCompleteTheme(studio)).toBe(true);
    expect(isCompleteTheme(layer({ modes: { light: { primary: oklch(0.5, 0.2, 150) } } }))).toBe(
      false,
    );
  });
});
