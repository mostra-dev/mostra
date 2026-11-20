/**
 * A theme as an artifact's build takes it (D178 items 2 and 3): the stylesheet the builder puts
 * inside the build's one Tailwind run, after `tailwindcss` and the kit's own CSS.
 */
import { paletteVariables, stack, TAILWIND_COLORS } from "./css.ts";
import type { Theme } from "./theme.ts";
import { TOKENS, type TokenName } from "./tokens.ts";

/** Where a stylesheet for an artifact finds a theme's font files. */
export interface KitStylesheetOptions {
  /** The URL each face file is served at, from its package-relative path (`fonts/….woff2`). */
  readonly faceUrl?: (file: string) => string;
}

/** Every Tailwind colour utility the kit's token contract makes (`bg-card`, `text-highlight`…). */
const KIT_COLORS: readonly string[] = [...TAILWIND_COLORS, "destructive-foreground", "highlight"];

/** The utilities the token contract gives Tailwind: the colours, faces, radii, depths and eases. */
const UTILITIES: readonly string[] = [
  ...KIT_COLORS.map((role) => "--color-" + role + ": var(--" + role + ");"),
  "--font-sans: var(--font-sans);",
  "--font-display: var(--font-display);",
  "--font-heading: var(--heading-font);",
  "--font-mono: var(--font-mono);",
  "--radius-sm: calc(var(--radius) * 0.6);",
  "--radius-md: calc(var(--radius) * 0.8);",
  "--radius-lg: var(--radius);",
  "--radius-xl: calc(var(--radius) * 1.4);",
  "--radius-2xl: calc(var(--radius) * 1.8);",
  "--radius-3xl: calc(var(--radius) * 2.2);",
  "--radius-4xl: calc(var(--radius) * 2.6);",
  "--radius-card: var(--card-radius);",
  "--radius-control: var(--control-radius);",
  "--radius-button: var(--button-radius);",
  "--radius-choice: var(--choice-radius);",
  "--radius-popover: var(--popover-radius);",
  "--radius-badge: var(--badge-radius);",
  "--shadow-card: var(--card-shadow);",
  "--shadow-choice: var(--choice-shadow);",
  "--shadow-popover: var(--popover-shadow);",
  "--shadow-button: var(--button-shadow);",
  "--shadow-control: var(--control-shadow);",
  "--ease-out: var(--ease-out);",
  "--ease-answer: var(--ease-answer);",
];

/**
 * The element rules every themed page gets, in Tailwind's base layer after its preflight: any
 * utility, and any rule of the artifact's own (unlayered), wins over them.
 */
const BASE_RULES: readonly (readonly [selector: string, lines: readonly string[]])[] = [
  [
    "html",
    [
      "background: var(--background);",
      "color: var(--foreground);",
      "font-family: var(--font-sans);",
      "font-size: var(--body-size);",
      "line-height: 1.55;",
      "-webkit-font-smoothing: antialiased;",
      "text-rendering: optimizeLegibility;",
      "caret-color: var(--primary);",
      "accent-color: var(--primary);",
    ],
  ],
  ["*, ::before, ::after", ["border-color: var(--border);"]],
  [
    "h1",
    [
      "font-family: var(--font-display);",
      "font-size: var(--title-size);",
      "font-weight: var(--title-weight);",
      "letter-spacing: var(--title-tracking);",
      "line-height: var(--title-leading);",
      "text-wrap: balance;",
    ],
  ],
  [
    "h2",
    [
      "font-family: var(--heading-font);",
      "font-size: var(--heading-size);",
      "font-weight: var(--heading-weight);",
      "letter-spacing: var(--heading-tracking);",
      "line-height: 1.25;",
      "text-wrap: balance;",
    ],
  ],
  [
    "h3, h4",
    [
      "font-family: var(--heading-font);",
      "font-weight: var(--heading-weight);",
      "letter-spacing: var(--heading-tracking);",
      "line-height: 1.3;",
      "text-wrap: balance;",
    ],
  ],
  ["p", ["text-wrap: pretty;"]],
  ["code, kbd, samp, pre", ["font-family: var(--font-mono);"]],
  [
    "::selection",
    [
      "background: color-mix(in oklab, var(--answer) 45%, transparent);",
      "color: var(--foreground);",
    ],
  ],
  [":focus-visible", ["outline: 2px solid var(--ring);", "outline-offset: 2px;"]],
];

const block = (selector: string, lines: readonly string[], indent = ""): string =>
  [indent + selector + " {", ...lines.map((line) => indent + "  " + line), indent + "}"].join("\n");

const tokenLines = (values: Readonly<Partial<Record<TokenName, string>>> | undefined): string[] =>
  Object.entries(values ?? {}).map(([name, value]) => "--" + name + ": " + value + ";");

/**
 * A theme as an artifact's build takes it: its faces; every token of the contract at the format's
 * default, then the theme's own values, light by default, dark when the device prefers it unless
 * the page chose light, and either one under `data-appearance`; the Tailwind 4 utilities that read
 * them (`@theme inline`); the base rules every page gets; then the theme's own rules. The text is
 * deterministic.
 *
 * Every token block it writes is `:where(…)`, of no specificity, and its element rules sit in
 * Tailwind's base layer, so any rule of the artifact's own, the later layers of its stack
 * included, overrides it without `!important`.
 */
export function kitStylesheet(theme: Theme, options: KitStylesheetOptions = {}): string {
  const faceUrl = options.faceUrl ?? ((file: string) => "./" + file);
  const faces: string[] = [];
  const seen = new Set<string>();
  for (const face of Object.values(theme.faces)) {
    for (const file of face.files) {
      if (seen.has(file.file)) continue;
      seen.add(file.file);
      faces.push(
        block("@font-face", [
          'font-family: "' + face.family + '";',
          "font-style: " + file.style + ";",
          "font-display: swap;",
          "font-weight: " + file.weight + ";",
          'src: url("' + faceUrl(file.file) + '") format("woff2");',
          "unicode-range: " + file.unicodeRange + ";",
        ]),
      );
    }
  }
  const shared = [
    ...Object.entries(TOKENS).map(([name, spec]) => "--" + name + ": " + spec.default + ";"),
    "--highlight: var(--primary);",
    "--font-sans: " + stack(theme.faces.sans) + ";",
    "--font-display: " + stack(theme.faces.display) + ";",
    "--font-mono: " + stack(theme.faces.mono) + ";",
    "--radius: " + theme.radius + ";",
    "--press-scale: " + theme.motion.pressScale + ";",
    "--press-ms: " + theme.motion.pressMs + "ms;",
    "--state-ms: " + theme.motion.stateMs + "ms;",
    ...tokenLines(theme.tokens?.base),
  ];
  const light = [
    "color-scheme: light;",
    ...paletteVariables(theme.modes.light),
    ...tokenLines(theme.tokens?.light),
  ];
  const dark = [
    "color-scheme: dark;",
    ...paletteVariables(theme.modes.dark),
    ...tokenLines(theme.tokens?.dark),
  ];
  return [
    "/* " +
      theme.name +
      " (" +
      theme.id +
      "), theme revision " +
      theme.revision +
      ": generated by @mostra/themes. */",
    ...faces,
    block(":where(:root)", [...shared, ...light]),
    "@media (prefers-color-scheme: dark) {\n" +
      block(':where(:root:not([data-appearance="light"]))', dark, "  ") +
      "\n}",
    block(':where(:root[data-appearance="dark"])', dark),
    block(':where(:root[data-appearance="light"])', light),
    block("@theme inline", UTILITIES),
    "@layer base {\n" +
      BASE_RULES.map(([selector, lines]) => block(selector, lines, "  ")).join("\n") +
      "\n}",
    ...(theme.css !== undefined && theme.css !== "" ? [theme.css] : []),
    "",
  ].join("\n");
}
