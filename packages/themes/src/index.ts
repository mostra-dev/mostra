/**
 * `@mostra/themes`: Mostra's themes and the templates that wear them. Every theme is data
 * (`Theme`), checked by `defineTheme` for gamut and WCAG 2.2 AA; `themeStylesheet` makes it CSS;
 * `createPages` draws a server's own pages in it with no script; `renderMail` writes mail in it.
 * The stylesheets (`@mostra/themes/studio.css`, `@mostra/themes/mostra.css`), the faces
 * (`@mostra/themes/fonts/…`) and Mostra's marks (`@mostra/themes/marks/…`) ship as files.
 *
 * @packageDocumentation
 */

export { type Color, contrast, cssColor, luminance, oklch, oklchToHex } from "./color.ts";
export { type StylesheetOptions, tailwindStylesheet, themeStylesheet, variableOf } from "./css.ts";
export { escapeHtml, type HtmlValue, html, isSafeHtml, type SafeHtml, text } from "./html.ts";
export { type Mail, type MailContent, type MailIdentity, renderMail } from "./mail.ts";
export {
  APPEARANCE_COOKIE,
  actions,
  alert,
  appearanceCookie,
  button,
  choice,
  code,
  createPages,
  type FooterLink,
  field,
  fieldset,
  fine,
  type Identity,
  linkButton,
  PAGE_WORDS,
  type PageAsset,
  type PageContent,
  type PageSection,
  type Pages,
  type PagesOptions,
  type PageWords,
  readAppearance,
  safeHref,
} from "./pages.ts";
export {
  APPEARANCES,
  type Appearance,
  defineTheme,
  type Face,
  type FontFile,
  type Mode,
  type Palette,
  type Stage,
  THEME_REVISION,
  type Theme,
  ThemeError,
} from "./theme.ts";
export { FACES, mostra, studio, THEMES } from "./themes.ts";
