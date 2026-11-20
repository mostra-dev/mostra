/**
 * The JSON Schema of a theme layer (D181 items 3 and 4): what a plugin's `contributes.themes` file
 * holds, `@mostra/themes/theme.schema.json`. It is made from the format itself (the palette's roles
 * and the token contract), so it can't drift; `defineThemeLayer` stays the check that decides,
 * contrast included, which a schema can't express.
 */
import { PALETTE_ROLE_NAMES, THEME_REVISION } from "./theme.ts";
import { TOKEN_NAMES, TOKENS } from "./tokens.ts";

/** The schema's own URL, as `$schema` in a theme file names it. */
export const THEME_SCHEMA_ID = "https://mostradev.com/schemas/theme-layer.schema.json";

const color = {
  type: "object",
  description: "A colour: OKLCH (lightness 0 to 1, chroma, hue 0 to 360) and the hex it is.",
  required: ["oklch", "hex"],
  additionalProperties: false,
  properties: {
    oklch: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    hex: { type: "string", pattern: "^#[0-9a-f]{6}$" },
  },
};

const palette = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    PALETTE_ROLE_NAMES.map((role) => [
      role,
      role === "chart" ? { type: "array", items: color, minItems: 6, maxItems: 6 } : color,
    ]),
  ),
};

const face = {
  type: "object",
  required: ["family", "fallback", "files"],
  additionalProperties: false,
  properties: {
    family: { type: "string", maxLength: 64 },
    fallback: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "weight", "style", "unicodeRange"],
        additionalProperties: false,
        properties: {
          file: { type: "string", pattern: "^fonts/[a-z0-9-]+\\.woff2$" },
          weight: { type: "string" },
          style: { enum: ["normal", "italic"] },
          unicodeRange: { type: "string" },
        },
      },
    },
  },
};

const tokens = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    TOKEN_NAMES.map((name) => [
      name,
      {
        type: "string",
        maxLength: 400,
        description: `${TOKENS[name].description} Default: ${TOKENS[name].default}.`,
      },
    ]),
  ),
};

/** The schema, as an object: write it with `JSON.stringify`. */
export function themeLayerSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: THEME_SCHEMA_ID,
    title: "Mostra theme layer",
    description: `A theme, or a layer over one, of theme revision ${THEME_REVISION} (D181). A complete theme sets every palette role in both modes, its faces, radius and motion.`,
    type: "object",
    required: ["revision", "id", "name", "description"],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      revision: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,31}$" },
      name: { type: "string", minLength: 1, maxLength: 64 },
      description: { type: "string", maxLength: 280 },
      modes: {
        type: "object",
        additionalProperties: false,
        properties: { light: palette, dark: palette },
      },
      faces: {
        type: "object",
        additionalProperties: false,
        properties: { sans: face, display: face, mono: face },
      },
      radius: { type: "string", pattern: "^\\d+(\\.\\d+)?(px|rem)$" },
      motion: {
        type: "object",
        additionalProperties: false,
        properties: {
          pressScale: { type: "number" },
          pressMs: { type: "number" },
          stateMs: { type: "number" },
        },
      },
      tokens: {
        type: "object",
        additionalProperties: false,
        properties: { base: tokens, light: tokens, dark: tokens },
      },
      css: { type: "string", maxLength: 65536 },
    },
  };
}
