"use client";

/**
 * The page's theme as values a drawing library can take (D26, D141, KT-04): libraries that paint
 * on a canvas or a WebGL surface (uPlot, ECharts, MapLibre, three.js, Excalidraw) can't read CSS
 * variables, so this reads the theme's tokens from the page and resolves each colour to `rgb()`,
 * and `useTokens()` reads them again whenever the page's theme or its light or dark changes. Every
 * kit module that draws reads its colours here, so every theme in a stack restyles it, and an
 * artifact's own canvas code can use it too. Ordinary React, the same in either base.
 */

import { useSyncExternalStore } from "react";

/** The theme's six series colours, in their fixed order (D141): never cycled, never reordered. */
export type ChartColors = readonly [string, string, string, string, string, string];

/** The page's theme, resolved: every colour as `rgb(r g b)` or `rgb(r g b / a)`. */
export interface Tokens {
  /** Whether the page shows its light or its dark colours now. */
  readonly appearance: "light" | "dark";
  /** The series colours, `--chart-1` to `--chart-6`. */
  readonly chart: ChartColors;
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly input: string;
  readonly ring: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly destructive: string;
  readonly success: string;
  readonly warning: string;
  /** What a person answered or chose: a dot or a field, never text. */
  readonly answer: string;
  /** The theme's accent for one thing at a time (its recommended choice). */
  readonly highlight: string;
  /** The interface face, as a `font-family` value. */
  readonly fontSans: string;
  /** The code face, as a `font-family` value. */
  readonly fontMono: string;
  /** The theme's base radius, in CSS pixels. */
  readonly radius: number;
}

/** Each colour token and the CSS variable it reads. */
const COLOR_VARIABLES = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  success: "--success",
  warning: "--warning",
  answer: "--answer",
  highlight: "--highlight",
} as const satisfies Record<string, `--${string}`>;

type ColorToken = keyof typeof COLOR_VARIABLES;

/**
 * What a page with no theme (`kit: { theme: "none" }`), or code outside a browser, reads: neutral
 * colours that still tell series apart.
 */
const FALLBACK: Tokens = {
  appearance: "light",
  chart: [
    "rgb(37 99 235)",
    "rgb(220 38 38)",
    "rgb(124 58 237)",
    "rgb(22 163 74)",
    "rgb(202 138 4)",
    "rgb(219 39 119)",
  ],
  background: "rgb(255 255 255)",
  foreground: "rgb(23 23 23)",
  card: "rgb(255 255 255)",
  cardForeground: "rgb(23 23 23)",
  muted: "rgb(245 245 245)",
  mutedForeground: "rgb(102 102 102)",
  border: "rgb(229 229 229)",
  input: "rgb(163 163 163)",
  ring: "rgb(37 99 235)",
  primary: "rgb(23 23 23)",
  primaryForeground: "rgb(255 255 255)",
  accent: "rgb(245 245 245)",
  accentForeground: "rgb(23 23 23)",
  destructive: "rgb(220 38 38)",
  success: "rgb(22 163 74)",
  warning: "rgb(180 83 9)",
  answer: "rgb(234 179 8)",
  highlight: "rgb(37 99 235)",
  fontSans: "system-ui, sans-serif",
  fontMono: "ui-monospace, monospace",
  radius: 10,
};

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour (`oklch(…)`, `color-mix(…)`, a name) as `rgb(r g b)` or `rgb(r g b / a)`, the
 * form every drawing library parses, by painting it once on a 1×1 canvas and reading the pixel.
 * `undefined` for a value that isn't a colour.
 */
export function resolveColor(value: string): string | undefined {
  const text = value.trim();
  if (text === "" || typeof document === "undefined") return undefined;
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return undefined;
  // An invalid colour leaves `fillStyle` as it was: two different starting colours tell.
  probe.fillStyle = "#000";
  probe.fillStyle = text;
  const first = probe.fillStyle;
  probe.fillStyle = "#fff";
  probe.fillStyle = text;
  if (first !== probe.fillStyle) return undefined;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data as unknown as [
    number,
    number,
    number,
    number,
  ];
  return a === 255
    ? `rgb(${r} ${g} ${b})`
    : `rgb(${r} ${g} ${b} / ${Math.round((a / 255) * 1000) / 1000})`;
}

/** A colour as `[r, g, b, a]`, each 0 to 255: what deck.gl's layers take. */
export function colorBytes(color: string): [number, number, number, number] {
  const match = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(resolveColor(color) ?? color);
  if (!match) return [0, 0, 0, 255];
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? 255 : Math.round(Number(match[4]) * 255),
  ];
}

/**
 * The page's theme as it is now, read from `element` (default the page's root, where the theme's
 * tokens live).
 */
export function readTokens(element?: Element): Tokens {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return FALLBACK;
  const root = element ?? document.documentElement;
  const style = getComputedStyle(root);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const color = (token: ColorToken): string =>
    resolveColor(read(COLOR_VARIABLES[token])) ?? FALLBACK[token];
  const colors = Object.fromEntries(
    (Object.keys(COLOR_VARIABLES) as ColorToken[]).map((token) => [token, color(token)]),
  ) as Record<ColorToken, string>;
  const chart = FALLBACK.chart.map(
    (fallback, index) => resolveColor(read(`--chart-${index + 1}`)) ?? fallback,
  ) as unknown as ChartColors;
  const radius = Number.parseFloat(read("--radius"));
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return {
    appearance: style.colorScheme.includes("dark") ? "dark" : "light",
    chart,
    ...colors,
    fontSans: read("--font-sans") || FALLBACK.fontSans,
    fontMono: read("--font-mono") || FALLBACK.fontMono,
    radius: Number.isFinite(radius)
      ? read("--radius").endsWith("rem")
        ? radius * rem
        : radius
      : FALLBACK.radius,
  };
}

/**
 * A series' colour: the theme's `--chart-<n>` in its fixed order. Past the sixth series the
 * colours repeat, so a chart names every series in a legend or a label and no series is told apart
 * by colour alone (D141).
 */
export function seriesColor(index: number, tokens: Tokens = readTokens()): string {
  return tokens.chart[((index % 6) + 6) % 6] as string;
}

/* -------------------------------------------------------------------------------------------- */
/* Following the page's theme                                                                    */

let current: Tokens | undefined;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;

function refresh(): void {
  const next = readTokens();
  if (current !== undefined && JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

/** Watches what changes the page's theme: its root's attributes and style, and the device's light or dark. */
function watch(): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  let scheduled = false;
  const later = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refresh();
    });
  };
  const observer = new MutationObserver(later);
  // `data-theme`, `data-appearance`, `data-host-look`, `class` and `style` on the root (a host's
  // look, the shell's light or dark), and the stylesheets in the head (a host's variables).
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  media?.addEventListener("change", later);
  // A face that finishes loading changes no token, but a theme's late stylesheet may.
  document.fonts?.addEventListener?.("loadingdone", later);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", later);
    document.fonts?.removeEventListener?.("loadingdone", later);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = readTokens();
    stop = watch();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

function snapshot(): Tokens {
  current ??= readTokens();
  return current;
}

/**
 * The page's theme, resolved, kept current: a component that draws with it draws again when the
 * theme, its light or dark, or a host's look changes.
 *
 * ```tsx
 * const tokens = useTokens();
 * ctx.strokeStyle = tokens.chart[0];
 * ```
 */
export function useTokens(): Tokens {
  return useSyncExternalStore(subscribe, snapshot, () => FALLBACK);
}
