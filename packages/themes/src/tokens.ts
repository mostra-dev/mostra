/**
 * The kit's token contract beyond colours (D178 item 3): every custom property a theme may set to
 * shape the kit's parts, with what it does and the value a theme that doesn't set it gets. A
 * theme's `tokens` name them without their `--`; a value may refer to any palette role or other
 * token through `var()`, so most need no light and dark of their own.
 *
 * The defaults are the format's, not a theme's: plain, legible, square-cornered, with no depth.
 * Each built-in theme sets what makes it itself.
 */

/** What a token shapes. */
export type TokenGroup = "type" | "shape" | "space" | "depth" | "surface" | "motion";

/** One token of the contract. */
export interface TokenSpec {
  /** What it shapes. */
  readonly group: TokenGroup;
  /** One sentence: what it shapes. */
  readonly description: string;
  /** Its value when no layer sets it. */
  readonly default: string;
}

const t = (group: TokenGroup, description: string, value: string): TokenSpec => ({
  group,
  description,
  default: value,
});

/** Every token's name, without its `--`. Names are only ever added (THEME_REVISION). */
export const TOKEN_NAMES = [
  "body-size",
  "title-size",
  "title-weight",
  "title-tracking",
  "title-leading",
  "heading-font",
  "heading-size",
  "heading-weight",
  "heading-tracking",
  "card-title-font",
  "card-title-size",
  "card-title-weight",
  "figure-font",
  "figure-weight",
  "dialog-title-size",
  "question-number-color",
  "card-radius",
  "control-radius",
  "button-radius",
  "choice-radius",
  "popover-radius",
  "dialog-radius",
  "badge-radius",
  "tabs-radius",
  "tabs-indicator-radius",
  "thumb-radius",
  "section-radius",
  "figure-radius",
  "control-h",
  "control-h-sm",
  "card-gap",
  "card-pad-x",
  "card-pad-top",
  "card-pad-bottom",
  "dialog-pad",
  "menu-pad",
  "menu-item-radius",
  "tabs-track-pad",
  "figure-pad",
  "figures-gap",
  "section-pad",
  "section-index-size",
  "page-width",
  "page-pad",
  "stack-gap",
  "rule",
  "card-shadow",
  "choice-shadow",
  "choice-selected-shadow",
  "scale-selected-shadow",
  "popover-shadow",
  "button-shadow",
  "control-shadow",
  "section-shadow",
  "section-rule",
  "figures-shadow",
  "figures-divider",
  "tabs-track-shadow",
  "tabs-indicator-shadow",
  "field",
  "button-outline-border",
  "button-outline-bg",
  "choice-bg",
  "choice-hover-bg",
  "choice-selected-bg",
  "choice-selected-hover-bg",
  "choice-selected-fg",
  "scale-selected-bg",
  "scale-selected-fg",
  "choice-selected-muted",
  "menu-highlight",
  "menu-highlight-fg",
  "tabs-track-bg",
  "tabs-indicator-bg",
  "tabs-indicator-fill",
  "tabs-indicator-line",
  "tabs-active-fg",
  "section-bg",
  "section-index-color",
  "section-index-bg",
  "figure-bg",
  "figures-bg",
  "ease-out",
  "ease-answer",
  "answer-ms",
] as const;

/** A token's name, without its `--`. */
export type TokenName = (typeof TOKEN_NAMES)[number];

/** Every token: what it shapes and its default. */
export const TOKENS: Readonly<Record<TokenName, TokenSpec>> = {
  // Type: the faces themselves are a theme's `faces`.
  "body-size": t("type", "Body text's size.", "1rem"),
  "title-size": t("type", "The page title's size (h1).", "2.25rem"),
  "title-weight": t("type", "The page title's weight.", "600"),
  "title-tracking": t("type", "The page title's letter spacing.", "-0.02em"),
  "title-leading": t("type", "The page title's line height.", "1.1"),
  "heading-font": t(
    "type",
    "Section headings' face: var(--font-display) or var(--font-sans).",
    "var(--font-display)",
  ),
  "heading-size": t("type", "Section headings' size (h2).", "1.375rem"),
  "heading-weight": t("type", "Headings' weight.", "600"),
  "heading-tracking": t("type", "Headings' letter spacing.", "-0.01em"),
  "card-title-font": t("type", "A card title's face.", "var(--font-sans)"),
  "card-title-size": t("type", "A card title's size.", "1rem"),
  "card-title-weight": t("type", "A card title's weight.", "600"),
  "figure-font": t("type", "A figure's number face.", "var(--font-sans)"),
  "figure-weight": t("type", "A figure's number weight.", "600"),
  "dialog-title-size": t("type", "A dialog title's size.", "1.25rem"),
  "question-number-color": t("type", "A question's number.", "var(--muted-foreground)"),

  // Shape.
  "card-radius": t("shape", "Cards and panels.", "var(--radius)"),
  "control-radius": t("shape", "Fields people type in or pick from.", "var(--radius)"),
  "button-radius": t("shape", "Buttons; 999px makes pills.", "999px"),
  "choice-radius": t("shape", "Choices, scale steps and ranked rows.", "var(--radius)"),
  "popover-radius": t("shape", "Menus, popovers and select lists.", "var(--radius)"),
  "dialog-radius": t("shape", "Dialogs and sheets.", "var(--popover-radius)"),
  "badge-radius": t("shape", "Badges.", "999px"),
  "tabs-radius": t("shape", "The tab list's track.", "var(--button-radius)"),
  "tabs-indicator-radius": t("shape", "The active tab's mark.", "var(--button-radius)"),
  "thumb-radius": t("shape", "Previews inside choices.", "var(--radius)"),
  "section-radius": t("shape", "Sections of a page.", "0px"),
  "figure-radius": t("shape", "One figure of a row.", "0px"),

  // Space and size.
  "control-h": t("space", "A field's or button's height.", "2.75rem"),
  "control-h-sm": t("space", "A small field's or button's height.", "2.25rem"),
  "card-gap": t("space", "Between the parts of a card.", "1rem"),
  "card-pad-x": t("space", "Inside a card, at its sides.", "1.25rem"),
  "card-pad-top": t("space", "Inside a card, above its first part.", "1.25rem"),
  "card-pad-bottom": t("space", "Inside a card, below its last part.", "1.25rem"),
  "dialog-pad": t("space", "Inside a dialog.", "1.5rem"),
  "menu-pad": t("space", "Inside a menu, around its items.", "0.375rem"),
  "menu-item-radius": t(
    "shape",
    "A menu item: its menu's radius less the menu's padding.",
    "max(0px, calc(var(--popover-radius) - var(--menu-pad)))",
  ),
  "tabs-track-pad": t("space", "Inside the tab list's track.", "0.25rem"),
  "figure-pad": t("space", "Inside one figure.", "1.25rem 1.5rem"),
  "figures-gap": t("space", "Between the figures of a row.", "0px"),
  "section-pad": t("space", "Inside a section.", "1.5rem 0 0"),
  "section-index-size": t("space", "A section number's mark: auto, or a circle's size.", "auto"),
  "page-width": t("space", "A page's measure.", "60rem"),
  "page-pad": t("space", "Above and below a page's content.", "3rem"),
  "stack-gap": t("space", "Between a page's blocks.", "2.5rem"),

  // Depth: shadows, rings and rules.
  rule: t("depth", "The rule a theme draws its sections and cards with.", "var(--border)"),
  "card-shadow": t("depth", "A card's edge and depth.", "0 0 0 1px var(--border)"),
  "choice-shadow": t("depth", "A choice's edge.", "0 0 0 1px var(--border)"),
  "choice-selected-shadow": t("depth", "A chosen choice's edge.", "0 0 0 2px var(--primary)"),
  "scale-selected-shadow": t(
    "depth",
    "A chosen step of a scale's edge.",
    "0 0 0 2px var(--foreground)",
  ),
  "popover-shadow": t(
    "depth",
    "A menu's or popover's edge and depth.",
    "0 0 0 1px var(--border), 0 12px 32px -12px oklch(0 0 0 / 0.25)",
  ),
  "button-shadow": t("depth", "The main button's depth.", "none"),
  "control-shadow": t("depth", "A field's depth.", "none"),
  "section-shadow": t("depth", "A section's edge and depth.", "none"),
  "section-rule": t("depth", "The rule above a section.", "2px solid var(--rule)"),
  "figures-shadow": t("depth", "A row of figures' edge.", "var(--card-shadow)"),
  "figures-divider": t("depth", "The line between figures.", "var(--border)"),
  "tabs-track-shadow": t("depth", "The tab list's edge.", "none"),
  "tabs-indicator-shadow": t("depth", "The active tab's mark's depth.", "var(--choice-shadow)"),

  // Surfaces: what fills each part, and the text on it.
  field: t("surface", "Inside a field.", "var(--card)"),
  "button-outline-border": t("surface", "An outlined button's edge.", "var(--input)"),
  "button-outline-bg": t("surface", "An outlined button's fill.", "var(--field)"),
  "choice-bg": t("surface", "A choice's fill.", "var(--card)"),
  "choice-hover-bg": t("surface", "A choice's fill under the pointer.", "var(--muted)"),
  "choice-selected-bg": t("surface", "A chosen choice's fill.", "var(--accent)"),
  "choice-selected-hover-bg": t(
    "surface",
    "A chosen choice's fill under the pointer.",
    "var(--choice-selected-bg)",
  ),
  "choice-selected-fg": t("surface", "Text on a chosen choice.", "var(--card-foreground)"),
  "scale-selected-bg": t(
    "surface",
    "A chosen step of a scale: the answer's mark.",
    "var(--answer)",
  ),
  "scale-selected-fg": t("surface", "Text on a chosen step of a scale.", "var(--foreground)"),
  "choice-selected-muted": t(
    "surface",
    "Secondary text on a chosen choice.",
    "var(--muted-foreground)",
  ),
  "menu-highlight": t("surface", "The item a menu's pointer or keys are on.", "var(--accent)"),
  "menu-highlight-fg": t("surface", "Text on that item.", "var(--accent-foreground)"),
  "tabs-track-bg": t("surface", "The tab list's track.", "var(--muted)"),
  "tabs-indicator-bg": t("surface", "The active tab's mark.", "var(--card)"),
  "tabs-indicator-fill": t("surface", "1: the mark fills the tab; 0: it underlines it.", "1"),
  "tabs-indicator-line": t("surface", "The underline's thickness when the mark underlines.", "2px"),
  "tabs-active-fg": t("surface", "The active tab's text.", "var(--foreground)"),
  "section-bg": t("surface", "A section's fill.", "transparent"),
  "section-index-color": t("surface", "A section's number.", "var(--muted-foreground)"),
  "section-index-bg": t("surface", "A section number's mark.", "transparent"),
  "figure-bg": t("surface", "One figure's fill.", "transparent"),
  "figures-bg": t("surface", "A row of figures' fill.", "var(--card)"),

  // Motion (the press, hover and answer timings are a theme's `motion`).
  "ease-out": t("motion", "How things arrive.", "cubic-bezier(0.23, 1, 0.32, 1)"),
  "ease-answer": t("motion", "How an answer's dot drops in.", "cubic-bezier(0.34, 1.56, 0.64, 1)"),
  "answer-ms": t("motion", "How long it takes.", "400ms"),
};

/** Token values a layer sets: for both modes, and for each over that. */
export interface TokenValues {
  /** Values for both modes. */
  readonly base?: Readonly<Partial<Record<TokenName, string>>>;
  /** Values in light, over `base`. */
  readonly light?: Readonly<Partial<Record<TokenName, string>>>;
  /** Values in dark, over `base`. */
  readonly dark?: Readonly<Partial<Record<TokenName, string>>>;
}

/** Whether a string names a token. */
export function isTokenName(name: string): name is TokenName {
  return Object.hasOwn(TOKENS, name);
}

/**
 * Whether a value can stand in a custom property declaration and nothing else: no block, no
 * statement end, no comment, no URL (a theme's files are its faces), at most 400 characters.
 */
export function isTokenValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 400 &&
    !/[;{}<>\\]|\/\*|url\s*\(|@|!important|expression\s*\(/i.test(value)
  );
}
