/**
 * Writes the themes' stylesheets in `css/` (`css/studio.css`, `css/mostra.css`, `css/frame.css`…),
 * so a bundler or a plain `<link>` takes a theme with no code, and `theme.schema.json`, the schema
 * of a theme layer. The tests fail when any of them is stale. An artifact never copies a
 * stylesheet: its build takes its theme stack (D179).
 *
 *   pnpm --filter @mostra/themes generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { facesStylesheet, studio, THEMES, themeLayerSchema, themeStylesheet } from "@mostra/themes";

mkdirSync(new URL("../css/", import.meta.url), { recursive: true });
for (const theme of Object.values(THEMES)) {
  writeFileSync(
    new URL(`../css/${theme.id}.css`, import.meta.url),
    themeStylesheet(theme, { assetBase: "../" }),
  );
  console.log(`wrote css/${theme.id}.css`);
}
// The faces alone, for a page that names the theme's faces in its own stylesheet.
writeFileSync(
  new URL("../css/faces.css", import.meta.url),
  facesStylesheet(studio, { assetBase: "../" }),
);
console.log("wrote css/faces.css");

// The JSON Schema of a theme layer, for a plugin's theme files (D179 items 3 and 4).
writeFileSync(
  new URL("../theme.schema.json", import.meta.url),
  `${JSON.stringify(themeLayerSchema(), null, 2)}\n`,
);
console.log("wrote theme.schema.json");
