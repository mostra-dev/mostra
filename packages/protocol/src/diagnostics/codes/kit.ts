/**
 * Diagnostic codes of the KIT area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the KIT area, in the order they were added. */
export const kitDiagnosticCodes = [
  "MOSTRA_KIT_THEME_UNKNOWN",
  "MOSTRA_KIT_THEME_FILE_MISSING",
  "MOSTRA_KIT_THEME_CONFLICT",
  "MOSTRA_KIT_THEME_CONTRAST",
  "MOSTRA_KIT_WRONG_BASE",
  "MOSTRA_KIT_CSS_UNPROCESSED",
  // gen:codes
] as const;

/** The codes of the KIT area. */
export type KitDiagnosticCode = (typeof kitDiagnosticCodes)[number];

/** The KIT area's catalog entries. */
export const kitDiagnostics: AreaCatalog<KitDiagnosticCode> = {
  MOSTRA_KIT_THEME_UNKNOWN: {
    severity: "error",
    phase: "manifest",
    title: "Theme not found",
    hint: "Name a theme `mostra theme list` shows, or install the plugin that contributes it.",
    docs: {
      explanation:
        "An entry of the manifest's theme stack (`kit.theme`) names a theme that isn't built in and that no plugin installed for the artifact contributes, so the page can't be built in it. The message lists the themes on offer.",
      fix: 'Correct the name (`kit: { theme: "studio" }`), or install the plugin first with `mostra plugin add <package> --artifact <dir>`.',
    },
  },
  MOSTRA_KIT_THEME_FILE_MISSING: {
    severity: "error",
    phase: "manifest",
    title: "Theme file missing",
    hint: "Create the CSS file the stack names, or take it out of `kit.theme`.",
    docs: {
      explanation:
        "An entry of the manifest's theme stack names a CSS file of the artifact (`./brand.css`) that isn't in its source, so the stack can't be built.",
      fix: 'Add the file at the path the message names, relative to the artifact\'s root, or remove the entry: `kit: { theme: ["studio"] }`.',
    },
  },
  MOSTRA_KIT_THEME_CONFLICT: {
    severity: "error",
    phase: "manifest",
    title: "Two themes share an id",
    hint: "Uninstall one of the two plugins, or ask its author to rename the theme.",
    docs: {
      explanation:
        "Two themes the artifact can use have the same id: two installed plugins contribute it, or a plugin contributes one with a built-in theme's id. Mostra overrides neither (D172), so the stack can't say which it means.",
      fix: "Remove one of the plugins the message names with `mostra plugin remove <package> --artifact <dir>`.",
    },
  },
  MOSTRA_KIT_THEME_CONTRAST: {
    severity: "warning",
    phase: "lint",
    title: "Theme stack below contrast",
    hint: "Observed only: check the colours this names, if the theme stack changed them on purpose.",
    docs: {
      explanation:
        "The theme the stack makes has a text pair below WCAG 2.2 AA (text 4.5:1, a control's edge and the focus ring 3:1), as `defineTheme` checks every theme. Mostra builds it anyway: a page's look is its author's (D68).",
      fix: "Change the colour the message names in the layer that sets it, so it meets the ratio on the ground it sits on.",
    },
  },
  MOSTRA_KIT_WRONG_BASE: {
    severity: "error",
    phase: "compile",
    title: "Idiom of the other base",
    hint: "Write the idiom of the artifact's base, as the fix shows.",
    docs: {
      explanation:
        "The artifact uses the kit with one shadcn base (`kit.base`, Base UI by default) and composes a part in the other base's way: Radix's `asChild` on a Base UI part, or Base UI's `render` prop on a Radix part. TypeScript refuses it (TS2322), and the page would build but not compose as written.",
      fix: 'On Base UI, pass the child as `render`: `<DialogTrigger render={<Button />}>Open</DialogTrigger>`. On Radix, wrap it with `asChild`: `<DialogTrigger asChild><Button>Open</Button></DialogTrigger>`. Or set `kit: { base: "radix" }` if the page was written for Radix.',
    },
  },
  MOSTRA_KIT_CSS_UNPROCESSED: {
    severity: "warning",
    phase: "lint",
    title: "Tailwind CSS that isn't processed",
    hint: 'Name the file in `kit.theme`, or start it with `@import "tailwindcss";`.',
    docs: {
      explanation:
        "A CSS file of the artifact uses Tailwind's directives (`@theme`, `@apply`, `@utility`, `@variant`) but isn't processed by Tailwind: it neither imports Tailwind nor is a layer of the theme stack, so the directives reach the page unchanged and do nothing, and verify sees no error.",
      fix: 'List the file in the theme stack, after a theme (`kit: { theme: ["studio", "./brand.css"] }`), so it joins the build\'s one Tailwind run; or begin it with `@import "tailwindcss";`.',
    },
  },
  // gen:entries
};
