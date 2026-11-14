# @mostra/themes

Audience: everything visual: the shell, the server's pages, the kit, operators. Runs in: neutral. May import: no workspace packages (tools/package-map.ts).

## Purpose

The one source of how Mostra looks (UX-01). A theme is data (`Theme`): every colour in light and
dark by shadcn's role names, the faces, the radius and the motion. From a theme this package makes
its stylesheet (`themeStylesheet`, and the files `css/studio.css` and `css/mostra.css`), the pages a server
draws itself with no script (`createPages`), and mail (`renderMail`). The faces (SIL OFL 1.1) and
Mostra's marks ship as files beside them.

Two themes ship: `mostra`, the brand, for Mostra's own pages, and `studio`, the brand without its
marks, for agents' pages by default and for pages someone else sent (D141, amended by D171).

## Invariants it owns

- **Every theme renders accessibly or is refused.** `defineTheme` checks every colour (in gamut,
  its hex agreeing with its OKLCH) and every text pair at WCAG 2.2 AA (text 4.5:1, a control's
  edge and the focus ring 3:1) in both modes, and throws `ThemeError` listing each problem. The
  built-in themes go through it when the module loads.
- **Markup never comes from data.** `html` escapes every interpolated value that isn't `SafeHtml`,
  and only `html` makes `SafeHtml`. Links go through `safeHref` (`https:`, loopback `http:`, or the
  page's own paths).
- **Pages need no script and no inline style.** `createPages` renders with one stylesheet and the
  faces from the page's own origin; `pages.csp` is the policy that holds them.
- **The theme format grows additively.** `THEME_REVISION` names it; a theme from a newer revision
  is refused rather than half-rendered.

## Public interface

`src/index.ts`; the API report is `etc/themes.api.md`. Files: `css/studio.css`, `css/mostra.css`, `css/faces.css` (the faces alone, which the Skill's Studio stylesheet imports; the package is in the warm set)
(generated: `pnpm --filter @mostra/themes generate`), `fonts/`, `marks/`.

## Tests to run

`pnpm --filter @mostra/themes test`, then `pnpm check --affected`. The runtime's server pages and
the shell carry their own suites.

## Gotchas

- The stylesheets are generated from the themes: change `src/themes.ts`, then regenerate; a test
  fails on a stale file.
- The font files are pinned by SHA-256 in the tests (fontsource 5.3.0, VERIFIED_FACTS): replacing
  one is a change to record, with its licence.
- The marks are Mostra's (its trademark is not licensed by Apache-2.0); a page shows them only
  where it is dressed in the `mostra` theme, or as "Runs on Mostra".
- Keep the package neutral: no `node:` imports. A server reads an asset's bytes from
  `asset.body.fileUrl` itself.
