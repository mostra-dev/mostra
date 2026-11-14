/**
 * Writes the themes' stylesheets in `css/` (`css/studio.css`, `css/mostra.css`), so a bundler or a
 * plain `<link>` takes a theme with no code, and the Agent Skill's Studio stylesheet with every
 * example's copy of it. The tests fail when any of them is stale.
 *
 *   pnpm --filter @mostra/themes generate
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import {
  facesStylesheet,
  studio,
  THEMES,
  tailwindStylesheet,
  themeStylesheet,
} from "@mostra/themes";

mkdirSync(new URL("../css/", import.meta.url), { recursive: true });
for (const theme of Object.values(THEMES)) {
  writeFileSync(
    new URL(`../css/${theme.id}.css`, import.meta.url),
    themeStylesheet(theme, { assetBase: "../" }),
  );
  console.log(`wrote css/${theme.id}.css`);
}
// The faces alone, which the Skill's Studio stylesheet imports (every theme shares them).
writeFileSync(
  new URL("../css/faces.css", import.meta.url),
  facesStylesheet(studio, { assetBase: "../" }),
);
console.log("wrote css/faces.css");

// The Agent Skill's baseline stylesheet and every example's copy of it (the CLI's skill test holds
// the copies equal): Studio, as an artifact takes it.
const skill = new URL("../../../skills/mostra/assets/", import.meta.url);
const css = tailwindStylesheet(studio);
writeFileSync(new URL("studio.css", skill), css);
for (const example of readdirSync(new URL("examples/", skill))) {
  writeFileSync(new URL(`examples/${example}/styles.css`, skill), css);
}
console.log("wrote skills/mostra/assets/studio.css and its examples' copies");
