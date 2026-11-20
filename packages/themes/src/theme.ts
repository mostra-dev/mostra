/**
 * A theme: every colour a surface uses, in light and dark, its faces, its shape and its motion, as
 * data. Mostra's own themes are values of this type, and so is any theme someone else writes:
 * `defineTheme` checks one the way Mostra's are checked (every colour in gamut and agreeing with
 * its hex, every text pair at WCAG 2.2 AA), so a theme from anywhere renders accessibly or is
 * refused with the reason.
 */
import { type Color, contrast, isHex, oklchToHex } from "./color.ts";
import { isTokenName, isTokenValue, type TokenValues } from "./tokens.ts";

/**
 * The revision of the theme format. Fields are only ever added within a revision (invariant 10); a
 * theme names the revision it was written for, and a renderer refuses one newer than it knows.
 */
export const THEME_REVISION = "2026-11-20";

/** The revisions this renderer reads: each older one is a subset of the newest (invariant 10). */
export const THEME_REVISIONS: readonly string[] = ["2026-11-13", "2026-11-20"];

/** Light or dark: the two sets of colours every theme has. */
export type Mode = "light" | "dark";

/**
 * A person's choice of appearance: follow the device, or always light, or always dark. Every
 * surface starts at `system` unless its operator configured otherwise, and a person can switch.
 */
export type Appearance = "system" | Mode;

/** The appearances, in the order a switch offers them. */
export const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

/**
 * The colours of one mode, by role. The names are shadcn's (so a component library themes with no
 * mapping) plus `success`, `warning`, `answer` (what a person answered or chose: never text) and
 * six chart colours in a fixed order (D141).
 */
export interface Palette {
  /** The page's ground. */
  readonly background: Color;
  /** Text on the ground. */
  readonly foreground: Color;
  /** A raised surface on the ground: cards, panels, dialogs. */
  readonly card: Color;
  /** Text on cards. */
  readonly cardForeground: Color;
  /** A floating surface: menus, popovers. */
  readonly popover: Color;
  /** Text on popovers. */
  readonly popoverForeground: Color;
  /** A quiet fill: hovered rows, code, the second ground. */
  readonly muted: Color;
  /** Secondary text, on the ground, on cards and on `muted`. */
  readonly mutedForeground: Color;
  /** Lines that divide; decorative, so free of a contrast floor. */
  readonly border: Color;
  /** The edge of a control a person types in or chooses: 3:1 on cards (WCAG 1.4.11). */
  readonly input: Color;
  /** The focus ring: 3:1 on the ground and on cards. */
  readonly ring: Color;
  /** The one main action. */
  readonly primary: Color;
  /** Text on the main action. */
  readonly primaryForeground: Color;
  /** A second action's fill. */
  readonly secondary: Color;
  /** Text on a second action. */
  readonly secondaryForeground: Color;
  /** A tint for what is selected or current. */
  readonly accent: Color;
  /** Text on the accent tint. */
  readonly accentForeground: Color;
  /** Errors and what can't be undone, as text on the ground and as a fill. */
  readonly destructive: Color;
  /** Text on a destructive fill. */
  readonly destructiveForeground: Color;
  /** Done and well, as text. */
  readonly success: Color;
  /** Needs attention, as text. */
  readonly warning: Color;
  /** What a person answered or chose: a dot or a field, never text (D141). */
  readonly answer: Color;
  /** Six series colours in a fixed order. */
  readonly chart: readonly [Color, Color, Color, Color, Color, Color];
  /**
   * The theme's accent for one thing at a time, such as the recommended choice: text and a dot,
   * 4.5:1 on cards (revision 2026-11-20). A theme without one uses `primary`.
   */
  readonly highlight?: Color;
}

/** One font file of a face: a path inside this package, its weights and the characters it covers. */
export interface FontFile {
  /** Package-relative path, such as `fonts/figtree-latin-wght-normal.woff2`. */
  readonly file: string;
  /** A single weight or a variable range, as CSS writes it: `400` or `300 900`. */
  readonly weight: string;
  /** Upright or italic. */
  readonly style: "normal" | "italic";
  /** The CSS `unicode-range` the file covers. */
  readonly unicodeRange: string;
}

/** A typeface and where it falls back to while it loads, or where it can't load. */
export interface Face {
  /** The family's name in CSS. */
  readonly family: string;
  /** The CSS generic stack after the family, such as `ui-sans-serif, system-ui, sans-serif`. */
  readonly fallback: string;
  /** Its files, by the characters they cover. */
  readonly files: readonly FontFile[];
}

/**
 * The brand's stage, for a theme that has one: the ground of the panel beside a sign-in form, its
 * text, and the colours its shapes are drawn in. A page draws it only where the operator chose this
 * theme for its own pages.
 */
export interface Stage {
  /** The stage's ground. */
  readonly background: Color;
  /** Text on the stage. */
  readonly foreground: Color;
  /** The shapes' colours, front to back. */
  readonly shapes: readonly [Color, Color, Color];
}

/** A theme. */
export interface Theme {
  /** The theme format's revision it was written for (`THEME_REVISION`). */
  readonly revision: string;
  /** Lower case, `a-z`, digits and hyphens, at most 32 characters. */
  readonly id: string;
  /** Its name, as a person reads it. */
  readonly name: string;
  /** One sentence: what it is for. */
  readonly description: string;
  /** Its colours in light and in dark. */
  readonly modes: { readonly light: Palette; readonly dark: Palette };
  /** Its faces: interfaces and body text, headings, code. */
  readonly faces: { readonly sans: Face; readonly display: Face; readonly mono: Face };
  /** The base radius of cards and fields, a CSS length; main buttons are pills. */
  readonly radius: string;
  /** How its controls move. */
  readonly motion: {
    /** A pressed control scales to this. */
    readonly pressScale: number;
    readonly pressMs: number;
    /** Hover and state changes, colour only. */
    readonly stateMs: number;
  };
  /** The brand's stage, for a theme that has one. */
  readonly stage?: { readonly light: Stage; readonly dark: Stage };
  /**
   * The kit's other tokens (D178 item 3): shape, space, depth, surfaces and motion, by name
   * (`TOKENS`), for both modes and for each (revision 2026-11-20). A token no layer sets takes
   * the format's default.
   */
  readonly tokens?: TokenValues;
  /**
   * Rules beyond tokens, for what a token can't say: the kit's parts by `data-slot`, under
   * `:root[data-theme]` (revision 2026-11-20). No `@import` and no `url()`: a theme's only files
   * are its faces.
   */
  readonly css?: string;
}

/**
 * A theme layer (D178 items 2 and 3): what a theme stacked over another changes, and nothing
 * else. A complete theme is a layer too, and a stack's first entry must be one.
 */
export interface ThemeLayer {
  /** The theme format's revision it was written for (`THEME_REVISION`). */
  readonly revision: string;
  /** Lower case, `a-z`, digits and hyphens, at most 32 characters. */
  readonly id: string;
  /** Its name, as a person reads it. */
  readonly name: string;
  /** One sentence: what it is for. */
  readonly description: string;
  /** The colours it changes, in either mode. */
  readonly modes?: { readonly light?: Partial<Palette>; readonly dark?: Partial<Palette> };
  /** The faces it changes. */
  readonly faces?: Partial<Theme["faces"]>;
  /** The base radius, if it changes it. */
  readonly radius?: string;
  /** The motion it changes. */
  readonly motion?: Partial<Theme["motion"]>;
  /** The tokens it sets (`Theme.tokens`). */
  readonly tokens?: TokenValues;
  /** Its own rules, after the layers before it (`Theme.css`). */
  readonly css?: string;
}

/** Why a theme was refused: every problem found, each naming its place. */
export class ThemeError extends Error {
  /** Each problem, naming its place: `light: mutedForeground on card is 3.10:1, …`. */
  readonly problems: readonly string[];
  /** @param id - the refused theme's id. @param problems - every problem found. */
  constructor(id: string, problems: readonly string[]) {
    super(`The theme "${id}" can't be used:\n- ${problems.join("\n- ")}`);
    this.name = "ThemeError";
    this.problems = problems;
  }
}

/** WCAG 2.2 AA: text 4.5:1, a control's edge and a focus ring 3:1. */
const TEXT = 4.5;
const UI = 3;

/** The pairs a theme must hold in every mode: [foreground role, background role, minimum]. */
const PAIRS: readonly (readonly [keyof Palette, keyof Palette, number])[] = [
  ["foreground", "background", TEXT],
  ["foreground", "muted", TEXT],
  ["cardForeground", "card", TEXT],
  ["popoverForeground", "popover", TEXT],
  ["mutedForeground", "background", TEXT],
  ["mutedForeground", "card", TEXT],
  ["mutedForeground", "muted", TEXT],
  ["primaryForeground", "primary", TEXT],
  ["primary", "background", TEXT],
  ["primary", "card", TEXT],
  ["secondaryForeground", "secondary", TEXT],
  ["accentForeground", "accent", TEXT],
  ["destructive", "background", TEXT],
  ["destructive", "card", TEXT],
  ["destructiveForeground", "destructive", TEXT],
  ["success", "card", TEXT],
  ["warning", "card", TEXT],
  ["highlight", "card", TEXT],
  ["input", "card", UI],
  ["ring", "background", UI],
  ["ring", "card", UI],
];

/** Hex and OKLCH may differ by rounding: at most this much in any channel. */
const HEX_TOLERANCE = 2;

function checkColor(where: string, color: Color, problems: string[]): void {
  const [l, c, h] = color.oklch;
  if (!isHex(color.hex)) {
    problems.push(`${where}: hex "${color.hex}" isn't #rrggbb in lower case`);
    return;
  }
  if (!(l >= 0 && l <= 1 && c >= 0 && c <= 0.5 && h >= 0 && h < 360)) {
    problems.push(`${where}: oklch(${l} ${c} ${h}) is out of range`);
    return;
  }
  const computed = oklchToHex(l, c, h);
  for (const at of [1, 3, 5]) {
    const a = Number.parseInt(color.hex.slice(at, at + 2), 16);
    const b = Number.parseInt(computed.slice(at, at + 2), 16);
    if (Math.abs(a - b) > HEX_TOLERANCE) {
      problems.push(`${where}: hex ${color.hex} isn't oklch(${l} ${c} ${h}), which is ${computed}`);
      return;
    }
  }
}

function checkPalette(mode: string, palette: Palette, problems: string[]): void {
  checkPaletteColors(mode, palette, problems);
  for (const [text, ground, minimum] of PAIRS) {
    const foreground = palette[text] as Color | undefined;
    if (foreground === undefined) continue; // an optional role the theme doesn't have
    const ratio = contrast(foreground, palette[ground] as Color);
    if (ratio < minimum) {
      problems.push(
        `${mode}: ${text} on ${ground} is ${ratio.toFixed(2)}:1, below WCAG 2.2 AA's ${minimum}:1`,
      );
    }
  }
}

/** The roles a palette may have. */
const PALETTE_ROLES = new Set<string>([
  ...PAIRS.flatMap(([text, ground]) => [text, ground]),
  "border",
  "answer",
  "chart",
]);

/** Every colour a (possibly partial) palette has: in gamut, and agreeing with its hex. */
function checkPaletteColors(mode: string, palette: Partial<Palette>, problems: string[]): void {
  for (const [role, value] of Object.entries(palette)) {
    if (value === undefined) continue;
    if (role === "chart") {
      const chart = value as readonly Color[];
      if (chart.length !== 6) problems.push(`${mode}.chart: six colours, not ${chart.length}`);
      chart.forEach((color, index) => {
        checkColor(`${mode}.chart[${index}]`, color, problems);
      });
    } else if (!PALETTE_ROLES.has(role)) problems.push(`${mode}.${role}: no such role`);
    else checkColor(`${mode}.${role}`, value as Color, problems);
  }
}

/** The parts every layer is checked for, complete or not. */
function checkLayer(layer: ThemeLayer, problems: string[]): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(layer.id)) problems.push(`id "${layer.id}" isn't a theme id`);
  if (!THEME_REVISIONS.includes(layer.revision)) {
    problems.push(
      layer.revision > THEME_REVISION
        ? `revision ${layer.revision} is newer than this renderer's ${THEME_REVISION}`
        : `revision ${layer.revision} isn't one this renderer knows`,
    );
  }
  if (layer.name.trim() === "" || layer.name.length > 64) problems.push("name: 1 to 64 characters");
  if (layer.description.length > 280) problems.push("description: at most 280 characters");
  for (const [role, face] of Object.entries(layer.faces ?? {})) {
    if (face === undefined) continue;
    if (!/^[\p{L}\p{N} -]{1,64}$/u.test(face.family)) problems.push(`faces.${role}: family name`);
    if (!/^[a-z0-9 ,\-"'.]{1,200}$/i.test(face.fallback)) problems.push(`faces.${role}: fallback`);
    for (const file of face.files) {
      if (!/^fonts\/[a-z0-9-]+\.woff2$/.test(file.file)) {
        problems.push(`faces.${role}: "${file.file}" isn't a woff2 file under fonts/`);
      }
    }
  }
  if (layer.radius !== undefined && !/^\d+(\.\d+)?(px|rem)$/.test(layer.radius)) {
    problems.push(`radius "${layer.radius}"`);
  }
  const motion = layer.motion ?? {};
  if (motion.pressScale !== undefined && !(motion.pressScale > 0.8 && motion.pressScale <= 1)) {
    problems.push(`motion.pressScale ${motion.pressScale}: between 0.8 and 1`);
  }
  for (const key of ["pressMs", "stateMs"] as const) {
    const value = motion[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 2000)) {
      problems.push(`motion.${key} ${value}: whole milliseconds, 0 to 2000`);
    }
  }
  for (const scope of ["base", "light", "dark"] as const) {
    for (const [name, value] of Object.entries(layer.tokens?.[scope] ?? {})) {
      if (!isTokenName(name)) problems.push(`tokens.${scope}.${name}: no such token`);
      else if (typeof value !== "string" || !isTokenValue(value)) {
        problems.push(`tokens.${scope}.${name}: "${String(value)}" isn't a value a token can hold`);
      }
    }
  }
  if (layer.css !== undefined) {
    if (layer.css.length > 64 * 1024) problems.push("css: at most 64 KiB");
    if (/@import|url\s*\(|<\/style/i.test(layer.css)) {
      problems.push("css: no @import and no url(); a theme's only files are its faces");
    }
  }
}

/**
 * Checks a theme and returns it frozen, or throws `ThemeError` listing every problem: an id that
 * isn't one, a revision this renderer doesn't know, a colour out of gamut or disagreeing with its
 * hex, a text pair below WCAG 2.2 AA, a face with no file, a token that isn't one or a value a
 * token can't hold, CSS that loads something.
 */
export function defineTheme(theme: Theme): Theme {
  const problems: string[] = [];
  checkLayer(theme, problems);
  checkPalette("light", theme.modes.light, problems);
  checkPalette("dark", theme.modes.dark, problems);
  if (theme.stage) {
    for (const mode of ["light", "dark"] as const) {
      const stage = theme.stage[mode];
      checkColor(`stage.${mode}.background`, stage.background, problems);
      checkColor(`stage.${mode}.foreground`, stage.foreground, problems);
      stage.shapes.forEach((color, index) => {
        checkColor(`stage.${mode}.shapes[${index}]`, color, problems);
      });
      const ratio = contrast(stage.foreground, stage.background);
      if (ratio < TEXT) {
        problems.push(`stage.${mode}: text is ${ratio.toFixed(2)}:1 on its ground, below 4.5:1`);
      }
    }
  }
  if (problems.length > 0) throw new ThemeError(theme.id, problems);
  return Object.freeze(theme);
}

/**
 * Checks a layer a stack puts over a complete theme, without its contrast (a pair it changes is
 * judged in the theme it makes, `composeThemes`), and returns it frozen, or throws `ThemeError`.
 */
export function defineThemeLayer(layer: ThemeLayer): ThemeLayer {
  const problems: string[] = [];
  checkLayer(layer, problems);
  for (const mode of ["light", "dark"] as const) {
    const palette = layer.modes?.[mode];
    if (palette) checkPaletteColors(mode, palette, problems);
  }
  if (problems.length > 0) throw new ThemeError(layer.id, problems);
  return Object.freeze(layer);
}

/** Whether a layer is a complete theme, which a stack may start with. */
export function isCompleteTheme(layer: ThemeLayer): layer is Theme {
  const complete = (palette: Partial<Palette> | undefined): boolean =>
    palette !== undefined &&
    [...PALETTE_ROLES].every((role) => role === "highlight" || role in palette);
  return (
    complete(layer.modes?.light) &&
    complete(layer.modes?.dark) &&
    layer.faces?.sans !== undefined &&
    layer.faces.display !== undefined &&
    layer.faces.mono !== undefined &&
    layer.radius !== undefined &&
    layer.motion?.pressScale !== undefined &&
    layer.motion.pressMs !== undefined &&
    layer.motion.stateMs !== undefined
  );
}

/**
 * The theme a stack makes (D178 item 2), unchecked: its first entry, a complete theme, with each
 * later layer over it, later winning, and the CSS of every layer in order. `composeThemes` is
 * this, checked; a caller that must build a stack below contrast (a page's look is its author's,
 * D68) uses this and reports the check's problems itself.
 */
export function layerThemes(first: Theme, layers: readonly ThemeLayer[]): Theme {
  let theme: Theme = first;
  for (const layer of layers) {
    const css = [theme.css, layer.css].filter((part) => part !== undefined && part !== "");
    theme = {
      ...theme,
      revision: theme.revision > layer.revision ? theme.revision : layer.revision,
      id: layer.id,
      name: layer.name,
      description: layer.description,
      modes: {
        light: { ...theme.modes.light, ...layer.modes?.light },
        dark: { ...theme.modes.dark, ...layer.modes?.dark },
      },
      faces: { ...theme.faces, ...layer.faces },
      radius: layer.radius ?? theme.radius,
      motion: { ...theme.motion, ...layer.motion },
      tokens: {
        base: { ...theme.tokens?.base, ...layer.tokens?.base },
        light: { ...theme.tokens?.light, ...layer.tokens?.light },
        dark: { ...theme.tokens?.dark, ...layer.tokens?.dark },
      },
      ...(css.length > 0 ? { css: css.join("\n") } : {}),
    };
  }
  return theme;
}

/**
 * The theme a stack makes, checked as any theme is (`layerThemes`, then `defineTheme`), so a
 * layer that breaks a text pair is named in the `ThemeError`.
 */
export function composeThemes(first: Theme, ...layers: readonly ThemeLayer[]): Theme {
  return layers.length === 0 ? first : defineTheme(layerThemes(first, layers));
}
