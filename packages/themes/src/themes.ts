/**
 * Mostra's own themes. `mostra` is the brand (Mostra!, Italian modernism): it dresses Mostra's own
 * pages. `studio` is the brand without its marks, quieter and the agent’s content first (D141, D171): it
 * is what an agent's page looks like when the agent doesn't style it, and what dresses a page
 * someone else sent. They share the palette, the faces and the shapes, so the two read as one
 * family.
 */
import { type Color, oklch } from "./color.ts";
import { defineTheme, type Face, type Palette, THEME_REVISION, type Theme } from "./theme.ts";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const face = (family: string, slug: string, weight: string, fallback: string): Face => ({
  family,
  fallback,
  files: [
    { file: `fonts/${slug}-latin-wght-normal.woff2`, weight, style: "normal", unicodeRange: LATIN },
    {
      file: `fonts/${slug}-latin-ext-wght-normal.woff2`,
      weight,
      style: "normal",
      unicodeRange: LATIN_EXT,
    },
  ],
});

/** The faces (SIL OFL 1.1, served by the page's own origin): interfaces, Mostra's voice, code. */
export const FACES: { readonly figtree: Face; readonly jost: Face; readonly splineSansMono: Face } =
  {
    figtree: face("Figtree", "figtree", "300 900", "ui-sans-serif, system-ui, sans-serif"),
    jost: face("Jost", "jost", "100 900", "ui-sans-serif, system-ui, sans-serif"),
    splineSansMono: face(
      "Spline Sans Mono",
      "spline-sans-mono",
      "300 700",
      "ui-monospace, monospace",
    ),
  };

/** The brand's colours (B41), each in OKLCH. Every role below is one of these or a tint of one. */
const P = {
  blu: oklch(0.45, 0.212, 267.0),
  bluDeep: oklch(0.37, 0.173, 267.5),
  bluTint: oklch(0.959, 0.015, 273.9),
  rosso: oklch(0.603, 0.218, 32.2),
  rossoText: oklch(0.541, 0.198, 32.0),
  giallo: oklch(0.814, 0.167, 83.9),
  nero: oklch(0.191, 0, 0),
  bianco: oklch(1, 0, 0),
  pietra50: oklch(0.972, 0.004, 106.5),
  pietra75: oklch(0.957, 0.004, 106.5),
  pietraLine: oklch(0.917, 0.008, 106.6),
  pietraEdge: oklch(0.64, 0.009, 106.6),
  pietra600: oklch(0.466, 0.008, 106.7),
  verde: oklch(0.513, 0.111, 161.3),
  ocra: oklch(0.528, 0.109, 82.4),
  notte: oklch(0.178, 0.006, 271.0),
  notte15: oklch(0.205, 0.008, 274.5),
  notte2: oklch(0.223, 0.01, 276.6),
  notte25: oklch(0.258, 0.013, 279.0),
  notteLine: oklch(0.29, 0.011, 278.2),
  notteEdge: oklch(0.52, 0.012, 279.2),
  notteMuted: oklch(0.717, 0.007, 286.2),
  ink: oklch(0.96, 0.004, 106.5),
  bluDark: oklch(0.662, 0.18, 272.8),
  bluDarkTint: oklch(0.265, 0.055, 271.9),
  bluDarkText: oklch(0.855, 0.072, 277.0),
  rossoDark: oklch(0.706, 0.188, 32.9),
  gialloDark: oklch(0.861, 0.163, 87.1),
  verdeDark: oklch(0.797, 0.164, 159.7),
  notteInk: oklch(0.165, 0.009, 274.3),
} satisfies Record<string, Color>;

/** The six series colours in their fixed order: blu, rosso, viola, verde, ocra, rosa (D141). */
const CHART_LIGHT = [
  P.blu,
  oklch(0.627, 0.201, 33.0),
  oklch(0.559, 0.192, 301.5),
  oklch(0.561, 0.121, 160.3),
  oklch(0.651, 0.135, 80.9),
  oklch(0.586, 0.176, 358.8),
] as const;
const CHART_DARK = [
  oklch(0.657, 0.182, 273.1),
  oklch(0.636, 0.186, 35.5),
  oklch(0.63, 0.182, 299.0),
  oklch(0.627, 0.133, 159.6),
  oklch(0.645, 0.131, 81.9),
  oklch(0.63, 0.169, 355.6),
] as const;

/** Light: white surfaces, nero text, blu for the one main action. */
const light = (ground: Color): Palette => ({
  background: ground,
  foreground: P.nero,
  card: P.bianco,
  cardForeground: P.nero,
  popover: P.bianco,
  popoverForeground: P.nero,
  muted: P.pietra50,
  mutedForeground: P.pietra600,
  border: P.pietraLine,
  input: P.pietraEdge,
  ring: P.blu,
  primary: P.blu,
  primaryForeground: P.bianco,
  secondary: P.pietra75,
  secondaryForeground: P.nero,
  accent: P.bluTint,
  accentForeground: P.bluDeep,
  destructive: P.rossoText,
  destructiveForeground: P.bianco,
  success: P.verde,
  warning: P.ocra,
  answer: P.giallo,
  chart: CHART_LIGHT,
});

/** Dark: notte grounds, ink text, the lighter blu. */
const dark = (ground: Color): Palette => ({
  background: ground,
  foreground: P.ink,
  card: P.notte15,
  cardForeground: P.ink,
  popover: P.notte15,
  popoverForeground: P.ink,
  muted: P.notte2,
  mutedForeground: P.notteMuted,
  border: P.notteLine,
  input: P.notteEdge,
  ring: P.bluDark,
  primary: P.bluDark,
  primaryForeground: P.notteInk,
  secondary: P.notte25,
  secondaryForeground: P.ink,
  accent: P.bluDarkTint,
  accentForeground: P.bluDarkText,
  destructive: P.rossoDark,
  destructiveForeground: P.notteInk,
  success: P.verdeDark,
  warning: P.gialloDark,
  answer: P.gialloDark,
  chart: CHART_DARK,
});

const MOTION = { pressScale: 0.97, pressMs: 140, stateMs: 180 } as const;

/**
 * Studio: the brand without its marks, as an editorial page (D141, D171, D181). White grounds,
 * panels marked by a nero rule rather than boxed, square edges, Jost set large for titles and
 * headings, Figtree for the rest, pill actions, rosso for the one recommended thing, a menu's
 * highlight in nero, and what a person answered marked in giallo.
 */
export const studio: Theme = defineTheme({
  revision: THEME_REVISION,
  id: "studio",
  name: "Studio",
  description:
    "Mostra's default theme: the brand without its marks, as an editorial page of white grounds, nero rules, square edges and Jost set large.",
  modes: {
    light: { ...light(P.bianco), highlight: P.rossoText },
    dark: { ...dark(P.notte), card: P.notte, highlight: P.rossoDark },
  },
  faces: { sans: FACES.figtree, display: FACES.jost, mono: FACES.splineSansMono },
  radius: "2px",
  motion: MOTION,
  tokens: {
    base: {
      "title-size": "clamp(2.25rem, 1.5rem + 2.6vw, 3.4rem)",
      "title-weight": "500",
      "title-tracking": "-0.032em",
      "title-leading": "1.02",
      "heading-size": "1.625rem",
      "heading-weight": "500",
      "heading-tracking": "-0.018em",
      "card-title-font": "var(--font-display)",
      "card-title-size": "1.1875rem",
      "card-title-weight": "500",
      "figure-font": "var(--font-display)",
      "figure-weight": "500",
      "dialog-title-size": "1.5rem",
      "card-radius": "0px",
      "control-radius": "0px",
      "choice-radius": "0px",
      "popover-radius": "2px",
      "tabs-radius": "0px",
      "tabs-indicator-radius": "0px",
      "thumb-radius": "0px",
      "card-gap": "1rem",
      "card-pad-x": "0px",
      "card-pad-top": "1.25rem",
      "card-pad-bottom": "0px",
      "dialog-pad": "1.75rem",
      "menu-pad": "0.25rem",
      "tabs-track-pad": "0px",
      "figure-pad": "1.25rem 1.5rem 0.25rem",
      "page-pad": "3.5rem",
      "stack-gap": "2.75rem",
      rule: "var(--foreground)",
      "card-shadow": "inset 0 2px 0 var(--rule)",
      "choice-selected-shadow": "0 0 0 2px var(--foreground)",
      "tabs-track-shadow": "inset 0 -1px 0 var(--border)",
      "tabs-indicator-shadow": "none",
      "choice-selected-bg": "color-mix(in oklab, var(--answer) 16%, var(--card))",
      "menu-highlight": "var(--foreground)",
      "menu-highlight-fg": "var(--background)",
      "tabs-track-bg": "transparent",
      "tabs-indicator-bg": "var(--foreground)",
      "tabs-indicator-fill": "0",
      "section-index-color": "var(--highlight)",
      "figures-bg": "transparent",
    },
    light: {
      "popover-shadow": "0 0 0 1.5px var(--foreground), 0 12px 32px -12px oklch(0.191 0 0 / 0.25)",
    },
    dark: {
      "popover-shadow": "0 0 0 1.5px var(--foreground), 0 16px 40px -12px oklch(0 0 0 / 0.6)",
    },
  },
  // A row of figures sits on its rule: its first figure (and, two to a row, every odd one)
  // starts at the rule's edge.
  css: [
    ':where([data-slot="figure"]:nth-child(odd)) { padding-left: 0; }',
    "@media (min-width: 40rem) {",
    '  :where([data-slot="figure"]:nth-child(odd)) { padding-left: 1.5rem; }',
    '  :where([data-slot="figure"]:first-child) { padding-left: 0; }',
    "}",
  ].join("\n"),
});

/**
 * Arcata: the brand's other half (D181). Flat fields of colour in place of lines, round shapes,
 * bold Jost, and a choice that fills with blu the moment it is made; no borders where a field of
 * colour does the work, and no shadows but a menu's.
 */
export const arcata: Theme = defineTheme({
  revision: THEME_REVISION,
  id: "arcata",
  name: "Arcata",
  description:
    "Mostra's second theme: flat fields of colour, round shapes and bold Jost, with every choice filling with blu as it is made.",
  modes: {
    light: {
      ...light(P.bianco),
      card: oklch(0.978, 0.003, 106.5),
      muted: oklch(0.955, 0.004, 106.5),
      mutedForeground: oklch(0.44, 0.008, 106.7),
      border: oklch(0.9, 0.008, 106.6),
      input: oklch(0.6, 0.009, 106.6),
      secondary: oklch(0.955, 0.004, 106.5),
    },
    dark: {
      ...dark(P.notte),
      card: P.notte2,
      popover: P.notte25,
      muted: P.notte25,
      mutedForeground: oklch(0.74, 0.007, 286.2),
      border: oklch(0.3, 0.011, 278.2),
      input: oklch(0.55, 0.012, 279.2),
    },
  },
  faces: { sans: FACES.figtree, display: FACES.jost, mono: FACES.splineSansMono },
  radius: "16px",
  motion: { ...MOTION, pressScale: 0.96 },
  tokens: {
    base: {
      "title-size": "clamp(2.25rem, 1.55rem + 2.4vw, 3.25rem)",
      "title-weight": "600",
      "title-tracking": "-0.03em",
      "title-leading": "1.04",
      "heading-size": "1.625rem",
      "heading-weight": "600",
      "heading-tracking": "-0.02em",
      "card-title-font": "var(--font-display)",
      "card-title-size": "1.25rem",
      "card-title-weight": "600",
      "figure-font": "var(--font-display)",
      "figure-weight": "600",
      "dialog-title-size": "1.375rem",
      "question-number-color": "var(--primary)",
      "card-radius": "1.75rem",
      "control-radius": "1rem",
      "choice-radius": "1.25rem",
      "popover-radius": "1.25rem",
      "dialog-radius": "1.75rem",
      "thumb-radius": "1rem",
      "section-radius": "var(--card-radius)",
      "figure-radius": "var(--choice-radius)",
      "control-h": "3rem",
      "control-h-sm": "2.375rem",
      "card-gap": "1rem",
      "card-pad-x": "1.75rem",
      "card-pad-top": "1.75rem",
      "card-pad-bottom": "1.75rem",
      "dialog-pad": "1.75rem",
      "figures-gap": "0.75rem",
      "section-pad": "clamp(1.5rem, 4vw, 2.25rem)",
      "section-index-size": "2.25rem",
      "stack-gap": "1.25rem",
      rule: "transparent",
      "card-shadow": "none",
      "choice-shadow": "none",
      "choice-selected-shadow": "none",
      "section-rule": "0 solid transparent",
      "figures-shadow": "none",
      "figures-divider": "transparent",
      "tabs-indicator-shadow": "none",
      "button-outline-border": "transparent",
      "button-outline-bg": "var(--accent)",
      "choice-selected-bg": "var(--primary)",
      "choice-selected-fg": "var(--primary-foreground)",
      "scale-selected-bg": "var(--primary)",
      "scale-selected-fg": "var(--primary-foreground)",
      "scale-selected-shadow": "none",
      "menu-highlight": "var(--primary)",
      "menu-highlight-fg": "var(--primary-foreground)",
      "tabs-indicator-bg": "var(--primary)",
      "tabs-active-fg": "var(--primary-foreground)",
      "section-bg": "var(--card)",
      "section-index-color": "var(--primary-foreground)",
      "section-index-bg": "var(--primary)",
      "figure-bg": "var(--card)",
      "figures-bg": "transparent",
    },
    light: {
      field: "oklch(1 0 0)",
      "choice-bg": "oklch(1 0 0)",
      "choice-hover-bg": "oklch(0.985 0.002 106.5)",
      "choice-selected-hover-bg": "color-mix(in oklab, var(--primary), black 14%)",
      "choice-selected-muted": "oklch(0.88 0.04 270)",
      "popover-shadow":
        "0 0 0 1px oklch(0.191 0 0 / 0.06), 0 18px 40px -14px oklch(0.191 0 0 / 0.25)",
    },
    dark: {
      field: "var(--muted)",
      "choice-bg": "var(--muted)",
      "choice-hover-bg": "oklch(0.29 0.014 279)",
      "choice-selected-hover-bg": "color-mix(in oklab, var(--primary), white 12%)",
      "choice-selected-muted": "oklch(0.3 0.05 272)",
      "popover-shadow": "0 0 0 1px oklch(1 0 0 / 0.08), 0 24px 48px -16px oklch(0 0 0 / 0.7)",
    },
  },
});

/**
 * Mostra: the brand itself (B41), for the pages that are Mostra's own: white grounds, the blu
 * stage with the arches in rosso and white and the giallo dot, Jost for Mostra's voice.
 */
export const mostra: Theme = defineTheme({
  revision: THEME_REVISION,
  id: "mostra",
  name: "Mostra",
  description: "Mostra's brand: for Mostra's own pages, with its stage, arches and marks.",
  modes: { light: light(P.bianco), dark: dark(P.notte) },
  faces: { sans: FACES.figtree, display: FACES.jost, mono: FACES.splineSansMono },
  radius: "10px",
  motion: MOTION,
  stage: {
    light: { background: P.blu, foreground: P.bianco, shapes: [P.rosso, P.bianco, P.giallo] },
    dark: {
      background: P.notte2,
      foreground: P.ink,
      shapes: [P.rossoDark, P.bluDark, P.gialloDark],
    },
  },
});

/**
 * The frame: what dresses the trusted shell around a page and a server's own pages when they
 * aren't in the brand (D171 item 2, D181 item 8). The brand's palette and faces without its marks
 * on a warm pietra ground with raised cards, as UX-01 designed them, so the frame keeps its look
 * whichever theme the page inside it wears; WP-20's final pass on the shell starts from it.
 */
export const frame: Theme = defineTheme({
  revision: THEME_REVISION,
  id: "frame",
  name: "Frame",
  description:
    "The frame around a page: the shell and a server's own pages, in the brand's palette and faces without its marks.",
  modes: { light: light(P.pietra50), dark: dark(P.notte) },
  faces: { sans: FACES.figtree, display: FACES.jost, mono: FACES.splineSansMono },
  radius: "10px",
  motion: MOTION,
});

/** Every theme this package ships, by id. */
export const THEMES: Readonly<Record<string, Theme>> = Object.freeze({
  studio,
  arcata,
  frame,
  mostra,
});

/**
 * The built-in themes an artifact's stack may name (D181): Studio, the default, and Arcata. The
 * `mostra` theme dresses Mostra's own pages and carries its brand, so it isn't one.
 */
export const ARTIFACT_THEMES: Readonly<Record<string, Theme>> = Object.freeze({ studio, arcata });
