/**
 * Colours as a theme states them: OKLCH, the space every token is chosen in (D141), with the sRGB
 * hex each one renders as. Hex is what mail clients and older engines read, and what WCAG's
 * contrast formula is defined over, so a theme carries both and `defineTheme` checks they agree.
 */

/** One colour of a theme: its OKLCH coordinates and the sRGB hex it renders as. */
export interface Color {
  /** Lightness 0 to 1, chroma 0 to about 0.4, hue in degrees. */
  readonly oklch: readonly [l: number, c: number, h: number];
  /** `#rrggbb`, lower case. */
  readonly hex: string;
}

/** Makes a colour from its OKLCH coordinates; its hex is computed and clipped to sRGB. */
export function oklch(l: number, c: number, h: number): Color {
  return { oklch: [l, c, h], hex: oklchToHex(l, c, h) };
}

/** The CSS form of a colour: `oklch(l c h)`, every modern engine's. */
export function cssColor(color: Color): string {
  const [l, c, h] = color.oklch;
  return `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)})`;
}

function round(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

/** OKLCH to sRGB hex (Björn Ottosson's OKLab, CSS Color 4's conversion), clipped to the gamut. */
export function oklchToHex(l: number, c: number, h: number): string {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
  return `#${linear
    .map((channel) => {
      const clipped = Math.min(1, Math.max(0, channel));
      const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** WCAG 2's relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2's contrast ratio of two colours, 1 to 21. */
export function contrast(first: Color | string, second: Color | string): number {
  const a = luminance(typeof first === "string" ? first : first.hex);
  const b = luminance(typeof second === "string" ? second : second.hex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whether a string is a `#rrggbb` hex colour. */
export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}
