/**
 * A theme: every colour a surface uses, in light and dark, its faces, its shape and its motion, as
 * data. Mostra's own themes are values of this type, and so is any theme someone else writes:
 * `defineTheme` checks one the way Mostra's are checked (every colour in gamut and agreeing with
 * its hex, every text pair at WCAG 2.2 AA), so a theme from anywhere renders accessibly or is
 * refused with the reason.
 */
import { type Color, contrast, isHex, oklchToHex } from "./color.ts";

/**
 * The revision of the theme format. Fields are only ever added within a revision (invariant 10); a
 * theme names the revision it was written for, and a renderer refuses one newer than it knows.
 */
export const THEME_REVISION = "2026-11-13";

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
  for (const [role, value] of Object.entries(palette)) {
    if (role === "chart") {
      const chart = value as readonly Color[];
      if (chart.length !== 6) problems.push(`${mode}.chart: six colours, not ${chart.length}`);
      chart.forEach((color, index) => {
        checkColor(`${mode}.chart[${index}]`, color, problems);
      });
    } else checkColor(`${mode}.${role}`, value as Color, problems);
  }
  for (const [text, ground, minimum] of PAIRS) {
    const ratio = contrast(palette[text] as Color, palette[ground] as Color);
    if (ratio < minimum) {
      problems.push(
        `${mode}: ${text} on ${ground} is ${ratio.toFixed(2)}:1, below WCAG 2.2 AA's ${minimum}:1`,
      );
    }
  }
}

/**
 * Checks a theme and returns it frozen, or throws `ThemeError` listing every problem: an id that
 * isn't one, a revision this renderer doesn't know, a colour out of gamut or disagreeing with its
 * hex, a text pair below WCAG 2.2 AA, a face with no file.
 */
export function defineTheme(theme: Theme): Theme {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(theme.id)) problems.push(`id "${theme.id}" isn't a theme id`);
  if (theme.revision > THEME_REVISION) {
    problems.push(`revision ${theme.revision} is newer than this renderer's ${THEME_REVISION}`);
  }
  if (theme.name.trim() === "" || theme.name.length > 64) problems.push("name: 1 to 64 characters");
  checkPalette("light", theme.modes.light, problems);
  checkPalette("dark", theme.modes.dark, problems);
  for (const [role, face] of Object.entries(theme.faces)) {
    if (!/^[\p{L}\p{N} -]{1,64}$/u.test(face.family)) problems.push(`faces.${role}: family name`);
    for (const file of face.files) {
      if (!/^fonts\/[a-z0-9-]+\.woff2$/.test(file.file)) {
        problems.push(`faces.${role}: "${file.file}" isn't a woff2 file under fonts/`);
      }
    }
  }
  if (!/^\d+(\.\d+)?(px|rem)$/.test(theme.radius)) problems.push(`radius "${theme.radius}"`);
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
