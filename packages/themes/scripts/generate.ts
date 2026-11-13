/**
 * Writes the themes' stylesheets in `css/` (`css/studio.css`, `css/mostra.css`), so a bundler or a
 * plain `<link>` takes a theme with no code. `test/index.test.ts` fails when they are stale.
 *
 *   pnpm --filter @mostra/themes generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { THEMES, themeStylesheet } from "@mostra/themes";

mkdirSync(new URL("../css/", import.meta.url), { recursive: true });
for (const theme of Object.values(THEMES)) {
  writeFileSync(
    new URL(`../css/${theme.id}.css`, import.meta.url),
    themeStylesheet(theme, { assetBase: "../" }),
  );
  console.log(`wrote css/${theme.id}.css`);
}
