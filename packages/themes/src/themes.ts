/**
 * Mostra's own themes. `mostra` is the brand (Mostra!, Italian modernism): it dresses Mostra's own
 * pages. `studio` is the brand without its marks, quieter and the agent's content first (D141): it
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
 * Studio: the brand without its marks (D141, amended in UX-01). A warm pietra ground with white
 * cards, Jost for headings and Figtree for everything else, blu for the main action and what is
 * selected, giallo for what a person answered, rosso second in charts.
 */
export const studio: Theme = defineTheme({
  revision: THEME_REVISION,
  id: "studio",
  name: "Studio",
  description:
    "Mostra's default theme: the brand's palette, faces and shapes without its marks, quiet so the page's own content leads.",
  modes: { light: light(P.pietra50), dark: dark(P.notte) },
  faces: { sans: FACES.figtree, display: FACES.jost, mono: FACES.splineSansMono },
  radius: "10px",
  motion: MOTION,
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

/** Every theme this package ships, by id. */
export const THEMES: Readonly<Record<string, Theme>> = Object.freeze({ studio, mostra });
