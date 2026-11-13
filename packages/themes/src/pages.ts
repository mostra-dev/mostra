/**
 * Pages a server draws itself, with no script: sign-in, linking a machine, consent, a first
 * sign-in step, and every page a request can end on. One template for every server that runs
 * Mostra (the open server's API origin and gateway, an operator's own pages), so they read as one
 * product in whichever theme the server's operator chose.
 *
 * The template follows the hosted rules (ARCHITECTURE §15.6): no script; one stylesheet and the
 * faces, served by the page's own origin (`style-src 'self'; font-src 'self'`); every string that
 * isn't the caller's own markup rendered as text (`html`); links only to `https:`, or to the page's
 * own origin.
 */
import { themeStylesheet } from "./css.ts";
import { type HtmlValue, html, type SafeHtml } from "./html.ts";
import { APPEARANCES, type Appearance, type Theme } from "./theme.ts";

/** The words the template itself says, for a server to translate or reword (D149). */
export interface PageWords {
  /** The appearance switch's label while the page is light. */
  readonly toDark: string;
  /** Its label while the page is dark. */
  readonly toLight: string;
  /** The footer's mark of a server that isn't dressed as Mostra: "Runs on Mostra". */
  readonly runsOn: string;
  /** The invitation beside it: "Make pages like this". */
  readonly makePages: string;
  /** The skip link to the page's content. */
  readonly skip: string;
}

/** The template's English words. */
export const PAGE_WORDS: PageWords = {
  toDark: "Switch to dark",
  toLight: "Switch to light",
  runsOn: "Runs on Mostra",
  makePages: "Make pages like this",
  skip: "Skip to the page",
};

/**
 * How a server names itself on its pages. Mostra by default; an operator may give its own name
 * and image, or no name at all. Whatever it sets, a server dressed in another theme than Mostra's
 * shows "Runs on Mostra" in its footer.
 */
export interface Identity {
  /** The name pages speak of ("Sign in to …"), or `null` to name nothing. */
  readonly name: string | null;
  /** An image the operator supplies, served by the page's own origin. */
  readonly logo?: {
    readonly src: string;
    readonly alt: string;
    readonly width: number;
    readonly height: number;
  };
  /** A line on the brand's stage, for a theme that has one ("Let your agent show you."). */
  readonly stageLine?: string;
}

/** A link in a page's footer (terms, privacy, help). */
export interface FooterLink {
  /** Where it goes: `https:` or a path of the page's own origin. */
  readonly href: string;
  /** The link's words. */
  readonly text: string;
}

/** Everything a server's pages share. Made once per server, by `createPages`. */
export interface PagesOptions {
  /** The theme the operator dressed its pages in. */
  readonly theme: Theme;
  /** How the server names itself. */
  readonly identity: Identity;
  /** The URL prefix the server serves `assets` under, ending in `/`: `/_mostra/theme/`. */
  readonly assetBase: string;
  /** Where "Make pages like this" goes: an `https:` URL. */
  readonly madeWithHref?: string;
  /** Links in every page's footer: terms, privacy, help. */
  readonly footer?: readonly FooterLink[];
  /**
   * The path a person's appearance switch posts to (`appearance`, `next`), which sets the
   * `APPEARANCE_COOKIE` and sends them back; without it, pages follow the device alone.
   */
  readonly appearanceAction?: string;
  /** The appearance a person who never chose gets: `system` unless the operator says so. */
  readonly defaultAppearance?: Appearance;
  /** The template's words; `PAGE_WORDS` by default. */
  readonly words?: PageWords;
  /** The pages' language, `en` by default. */
  readonly lang?: string;
}

/** One page. */
export interface PageContent {
  /** The document's title and its heading. */
  readonly title: string;
  /** A sentence under the heading. */
  readonly lede?: HtmlValue;
  /** The page's content: build it with `html` and the parts below. */
  readonly body?: SafeHtml;
  /**
   * `task`: something to do (sign in, approve, answer the step), in a panel, beside the brand's
   * stage in a theme that has one. `notice`: where a request ended (a refusal, an expired link).
   */
  readonly kind: "task" | "notice";
  /** A notice about a problem is announced as one. */
  readonly tone?: "neutral" | "problem";
  /** The person's choice, read from their request (`readAppearance`). */
  readonly appearance?: Appearance;
  /** Where the appearance switch returns: this page's own path and query. */
  readonly path?: string;
}

/** A file a server serves for its pages, under `assetBase`. */
export interface PageAsset {
  /** The path after `assetBase`. */
  readonly path: string;
  /** Its `Content-Type`. */
  readonly contentType: string;
  /**
   * The text (the stylesheet), or the `file:` URL of the bytes in this package (a face, a mark),
   * for the server to read: `readFileSync(new URL(asset.body.fileUrl))`.
   */
  readonly body: { readonly text: string } | { readonly fileUrl: string };
  /** The path changes when the content does, so it may be cached for good. */
  readonly immutable: boolean;
}

/** A server's pages: its assets to serve, and the renderer. */
export interface Pages {
  /** Every file the pages load: serve each under `assetBase`. */
  readonly assets: readonly PageAsset[];
  /** The `Content-Security-Policy` sources the pages need, besides `form-action`. */
  readonly csp: string;
  /** The page's HTML. */
  render(content: PageContent): string;
}

/** The cookie that keeps a person's appearance on a server's own origin. */
export const APPEARANCE_COOKIE = "mostra-appearance";

/** A person's appearance from a request's `Cookie` header, or `fallback`. */
export function readAppearance(
  cookieHeader: string | undefined,
  fallback: Appearance = "system",
): Appearance {
  for (const part of (cookieHeader ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    if (name !== APPEARANCE_COOKIE && name !== `__Host-${APPEARANCE_COOKIE}`) continue;
    const value = part.slice(at + 1).trim();
    if ((APPEARANCES as readonly string[]).includes(value)) return value as Appearance;
  }
  return fallback;
}

/** The `Set-Cookie` value keeping an appearance for a year: host-only, and `__Host-` on https. */
export function appearanceCookie(appearance: Appearance, secure: boolean): string {
  const name = secure ? `__Host-${APPEARANCE_COOKIE}` : APPEARANCE_COOKIE;
  return `${name}=${appearance}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * A link target a page may carry: an `https:` URL, `http:` only on loopback, or a path of the
 * page's own origin. Anything else (another scheme, `//host`, a malformed URL) is `undefined`.
 */
export function safeHref(href: string | undefined): string | undefined {
  if (href === undefined || href === "") return undefined;
  if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")) return href;
  try {
    const url = new URL(href);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && /^(127\.0\.0\.1|\[::1\]|localhost)$/.test(url.hostname)) {
      return url.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** A file of this package (a face, a mark), wherever the package is installed. */
function packageFile(path: string): string {
  return new URL(`../${path}`, import.meta.url).href;
}

/** The marks a page may show: Mostra's own, from this package. */
const MARKS = [
  "marks/wordmark-colour.svg",
  "marks/wordmark-on-dark.svg",
  "marks/wordmark-on-blu.svg",
  "marks/mark-colour.svg",
  "marks/mark-on-dark.svg",
];

/** FNV-1a over the stylesheet: a short, stable name that changes with its content. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Makes a server's pages. */
export function createPages(options: PagesOptions): Pages {
  const words = options.words ?? PAGE_WORDS;
  const theme = options.theme;
  const base = options.assetBase;
  const css = `${themeStylesheet(theme, { assetBase: "" })}\n${PAGE_CSS}`;
  const stylesheetPath = `pages-${theme.id}-${digest(css)}.css`;
  const fonts = Object.values(theme.faces).flatMap((face) => face.files.map((file) => file.file));
  const assets: PageAsset[] = [
    {
      path: stylesheetPath,
      contentType: "text/css; charset=utf-8",
      body: { text: css },
      immutable: true,
    },
    ...[...new Set(fonts)].map((path) => ({
      path,
      contentType: "font/woff2",
      body: { fileUrl: packageFile(path) },
      immutable: true,
    })),
    ...MARKS.map((path) => ({
      path,
      contentType: "image/svg+xml",
      body: { fileUrl: packageFile(path) },
      immutable: false,
    })),
  ];
  const madeWith = safeHref(options.madeWithHref);
  const dressedAsMostra = theme.stage !== undefined;

  /**
   * One small button that turns a light page dark and a dark one light. With no script, the page
   * carries both and CSS shows the one for the appearance in force (the device's until the person
   * chooses); pressing it keeps the other appearance for this origin.
   */
  const appearanceSwitch = (path: string | undefined): SafeHtml | undefined => {
    if (!options.appearanceAction) return undefined;
    const icon = (dark: boolean) =>
      dark
        ? html`<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 10.3A6 6 0 0 1 5.7 2.6a6 6 0 1 0 7.7 7.7z"/></svg>`
        : html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"/></svg>`;
    return html`<form class="m-appearance" method="post" action="${options.appearanceAction}"><input type="hidden" name="next" value="${path ?? "/"}"><button class="m-light" name="appearance" value="dark" aria-label="${words.toDark}" title="${words.toDark}">${icon(true)}</button><button class="m-dark" name="appearance" value="light" aria-label="${words.toLight}" title="${words.toLight}">${icon(false)}</button></form>`;
  };

  const identityMark = (onStage: boolean): SafeHtml => {
    const { identity } = options;
    if (dressedAsMostra) {
      // Each mode has its own colourway of the wordmark (B41); CSS shows the one in force.
      const light = onStage ? "wordmark-on-blu" : "wordmark-colour";
      const alt = identity.name ?? "Mostra";
      return html`<img class="m-wordmark m-light" src="${base}marks/${light}.svg" alt="${alt}" width="132" height="33"><img class="m-wordmark m-dark" src="${base}marks/wordmark-on-dark.svg" alt="${alt}" width="132" height="33">`;
    }
    if (identity.logo) {
      const src = safeHref(identity.logo.src);
      if (src) {
        return html`<img class="m-logo" src="${src}" alt="${identity.logo.alt}" width="${identity.logo.width}" height="${identity.logo.height}">`;
      }
    }
    return identity.name ? html`<span class="m-name">${identity.name}</span>` : html``;
  };

  const runsOn = (): SafeHtml | undefined => {
    if (dressedAsMostra) return undefined;
    const mark = html`<img class="m-mark m-light" src="${base}marks/mark-colour.svg" alt="" width="20" height="20"><img class="m-mark m-dark" src="${base}marks/mark-on-dark.svg" alt="" width="20" height="20">`;
    return madeWith
      ? html`<a class="m-runs" href="${madeWith}">${mark}<span>${words.runsOn}</span> <span class="m-runs-invite">${words.makePages}</span></a>`
      : html`<span class="m-runs">${mark}<span>${words.runsOn}</span></span>`;
  };

  const footer = (path: string | undefined): SafeHtml => {
    const links = (options.footer ?? [])
      .map((link) => ({ href: safeHref(link.href), text: link.text }))
      .filter((link): link is FooterLink => link.href !== undefined);
    return html`<footer class="m-footer"><nav class="m-footer-links">${links.map((link) => html`<a href="${link.href}">${link.text}</a>`)}</nav>${runsOn()}${appearanceSwitch(path)}</footer>`;
  };

  const stageArt = html`<div class="m-art" aria-hidden="true"><i class="m-arch m-arch-back"></i><i class="m-arch m-arch-front"></i><i class="m-dot"></i></div>`;

  return {
    assets,
    csp: "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    render(content) {
      const appearance = content.appearance ?? options.defaultAppearance ?? "system";
      const heading = html`<h1 class="m-title">${content.title}</h1>${content.lede !== undefined ? html`<p class="m-lede">${content.lede}</p>` : ""}`;
      const role = content.tone === "problem" ? html` role="alert"` : html``;
      let main: SafeHtml;
      if (content.kind === "task" && dressedAsMostra) {
        main = html`<div class="m-split"><section class="m-stage" aria-hidden="true">${identityMark(true)}${options.identity.stageLine ? html`<p class="m-stage-line">${options.identity.stageLine}</p>` : ""}${stageArt}</section>
<main id="main" class="m-split-main"><div class="m-task">${heading}<div${role}>${content.body}</div></div>${footer(content.path)}</main></div>`;
      } else if (content.kind === "task") {
        main = html`<div class="m-frame"><header class="m-header">${identityMark(false)}</header>
<main id="main" class="m-panel-wrap"><div class="m-panel">${heading}<div${role}>${content.body}</div></div></main>${footer(content.path)}</div>`;
      } else if (dressedAsMostra) {
        main = html`<div class="m-frame"><main id="main" class="m-notice m-notice-stage"><div class="m-notice-art" aria-hidden="true"><i class="m-arch m-arch-blu"></i><i class="m-arch m-arch-rosso"></i></div><div${role}>${heading}${content.body}</div>${identityMark(false)}</main>${footer(content.path)}</div>`;
      } else {
        main = html`<div class="m-frame"><header class="m-header">${identityMark(false)}</header>
<main id="main" class="m-notice"><div${role}>${heading}${content.body}</div></main>${footer(content.path)}</div>`;
      }
      const attribute = appearance === "system" ? html`` : html` data-appearance="${appearance}"`;
      return html`<!doctype html>
<html lang="${options.lang ?? "en"}"${attribute}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark">
<title>${content.title}</title><link rel="stylesheet" href="${base}${stylesheetPath}"><link rel="icon" href="${base}marks/mark-colour.svg" type="image/svg+xml"></head>
<body class="m-body" data-page="${content.kind}" data-dressed="${dressedAsMostra ? "mostra" : "plain"}"><a class="m-skip" href="#main">${words.skip}</a>${main}</body></html>`
        .value;
    },
  };
}

/** A link styled as a button: providers on a sign-in page, the way on from a notice. */
export function linkButton(
  href: string,
  label: HtmlValue,
  options: { readonly primary?: boolean; readonly icon?: SafeHtml } = {},
): SafeHtml {
  return html`<a class="m-button${options.primary ? " m-primary" : ""}" href="${safeHref(href) ?? "#"}">${options.icon}<span>${label}</span></a>`;
}

/** A form's button: `name`/`value` say which one was pressed. */
export function button(
  label: HtmlValue,
  options: { readonly name?: string; readonly value?: string; readonly primary?: boolean } = {},
): SafeHtml {
  return html`<button class="m-button${options.primary ? " m-primary" : ""}"${options.name ? html` name="${options.name}"` : ""}${options.value !== undefined ? html` value="${options.value}"` : ""}>${label}</button>`;
}

/** A labelled text field. */
export function field(options: {
  readonly label: HtmlValue;
  readonly name: string;
  readonly value?: string;
  readonly hint?: HtmlValue;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly autocomplete?: string;
  readonly code?: boolean;
}): SafeHtml {
  const id = `m-${options.name}`;
  return html`<div class="m-field"><label for="${id}">${options.label}</label>${options.hint !== undefined ? html`<p class="m-hint" id="${id}-hint">${options.hint}</p>` : ""}<input id="${id}" name="${options.name}"${options.value !== undefined ? html` value="${options.value}"` : ""}${options.required ? html` required` : ""}${options.maxLength ? html` maxlength="${options.maxLength}"` : ""} autocomplete="${options.autocomplete ?? "off"}"${options.code ? html` class="m-code-input" spellcheck="false" autocapitalize="characters"` : ""}${options.hint !== undefined ? html` aria-describedby="${id}-hint"` : ""}></div>`;
}

/** A checkbox or radio with its label as one target. */
export function choice(options: {
  readonly type: "checkbox" | "radio";
  readonly name: string;
  readonly value: string;
  readonly label: HtmlValue;
  readonly checked?: boolean;
  readonly required?: boolean;
}): SafeHtml {
  return html`<label class="m-choice"><input type="${options.type}" name="${options.name}" value="${options.value}"${options.checked ? html` checked` : ""}${options.required ? html` required` : ""}><span>${options.label}</span></label>`;
}

/** A group of choices under a legend. */
export function fieldset(legend: HtmlValue, content: HtmlValue, hint?: HtmlValue): SafeHtml {
  return html`<fieldset class="m-fieldset"><legend>${legend}</legend>${hint !== undefined ? html`<p class="m-hint">${hint}</p>` : ""}${content}</fieldset>`;
}

/** A message the page must say first: a problem (announced) or a note. */
export function alert(message: HtmlValue, tone: "problem" | "note" = "problem"): SafeHtml {
  return html`<p class="m-alert m-alert-${tone}"${tone === "problem" ? html` role="alert"` : ""}>${message}</p>`;
}

/** Buttons side by side, the main one first. */
export function actions(...items: readonly HtmlValue[]): SafeHtml {
  return html`<div class="m-actions">${items}</div>`;
}

/** Small print under a task. */
export function fine(message: HtmlValue): SafeHtml {
  return html`<p class="m-fine">${message}</p>`;
}

/** A code a person compares with another screen, set apart and large. */
export function code(value: string): SafeHtml {
  return html`<p class="m-code" translate="no">${value}</p>`;
}

/**
 * The template's own styles, after the theme's variables. Logical properties, so a right-to-left
 * page mirrors; every control at least 44 px tall on a coarse pointer; focus always visible.
 */
const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body.m-body { margin: 0; min-block-size: 100dvh; font: 400 1rem/1.55 var(--font-sans); color: var(--foreground); background: var(--background); -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
::selection { background: color-mix(in oklch, var(--answer) 45%, transparent); color: var(--foreground); }
a { color: var(--primary); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
.m-skip { position: absolute; inset-inline-start: 12px; inset-block-start: -100px; background: var(--card); color: var(--foreground); padding: 10px 14px; border-radius: var(--radius); z-index: 10; }
.m-skip:focus { inset-block-start: 12px; }
.m-title { font: 500 clamp(1.75rem, 1.4rem + 1.2vw, 2.125rem)/1.15 var(--font-display); letter-spacing: -0.02em; margin: 0 0 0.5rem; text-wrap: balance; }
.m-lede { color: var(--muted-foreground); margin: 0 0 1.75rem; text-wrap: pretty; }
p { margin: 0 0 1rem; }
.m-frame { min-block-size: 100dvh; display: grid; grid-template-rows: auto 1fr auto; }
.m-header { padding: 28px 32px; display: flex; align-items: center; min-block-size: 82px; }
.m-wordmark { display: block; block-size: 26px; inline-size: auto; }
/* What belongs to one appearance (a mark's colourway, the switch's button) hides in the other. */
:root[data-appearance="light"] .m-dark, :root[data-appearance="dark"] .m-light { display: none !important; }
@media not (prefers-color-scheme: dark) { :root:not([data-appearance]) .m-dark { display: none !important; } }
@media (prefers-color-scheme: dark) { :root:not([data-appearance]) .m-light { display: none !important; } }
.m-logo { display: block; block-size: 28px; inline-size: auto; max-inline-size: 220px; object-fit: contain; }
.m-name { font: 600 1.125rem/1.2 var(--font-sans); }
.m-panel-wrap { display: grid; justify-items: center; align-content: start; padding: 4vh 20px 48px; }
.m-panel { inline-size: 100%; max-inline-size: 440px; background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: 16px; padding: 36px 32px; }
.m-notice { display: grid; align-content: center; justify-items: start; padding: 24px 32px 72px; max-inline-size: 560px; margin-inline: auto; inline-size: 100%; }
.m-notice-stage { justify-items: center; text-align: center; }
.m-notice-stage .m-title { font-size: clamp(2rem, 1.6rem + 1.6vw, 2.5rem); }
.m-notice-stage .m-wordmark { block-size: 20px; margin-block-start: 2.5rem; }
.m-notice-art { display: flex; justify-content: center; align-items: flex-end; block-size: 112px; margin-block-end: 2rem; }
.m-notice-art .m-arch { inline-size: 88px; block-size: 112px; border-radius: 44px 44px 0 0; display: block; }
.m-arch-blu { background: var(--primary); }
.m-arch-rosso { background: var(--stage-shape-1); margin-inline-start: -26px; mix-blend-mode: multiply; }
:root[data-appearance="dark"] .m-arch-rosso { mix-blend-mode: screen; }
@media (prefers-color-scheme: dark) { :root:not([data-appearance="light"]) .m-arch-rosso { mix-blend-mode: screen; } }
.m-split { min-block-size: 100dvh; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); }
.m-stage { position: relative; overflow: hidden; background: var(--stage); color: var(--stage-foreground); padding: 40px 48px; display: flex; flex-direction: column; gap: 40px; }
.m-stage .m-wordmark { block-size: 30px; align-self: flex-start; }
.m-stage-line { font: 500 clamp(2rem, 1.2rem + 2.4vw, 3rem)/1.05 var(--font-display); letter-spacing: -0.02em; margin: 0; max-inline-size: 11ch; position: relative; z-index: 1; }
.m-art { position: absolute; inset: 0; pointer-events: none; }
.m-art .m-arch { position: absolute; inline-size: 300px; block-size: 300px; border-radius: 150px 150px 0 0; inset-block-end: -40px; display: block; }
.m-arch-front { inset-inline-end: -30px; background: var(--stage-shape-1); }
.m-arch-back { inset-inline-end: 160px; background: var(--stage-shape-2); opacity: 0.14; }
.m-dot { position: absolute; inline-size: 56px; block-size: 56px; border-radius: 50%; background: var(--stage-shape-3); inset-inline-end: 150px; inset-block-end: 290px; display: block; }
.m-split-main { display: grid; grid-template-rows: 1fr auto; }
.m-task { align-self: center; justify-self: center; inline-size: 100%; max-inline-size: 420px; padding: 40px 24px; }
.m-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; padding: 18px 32px; font-size: 0.8125rem; color: var(--muted-foreground); }
.m-footer a { color: inherit; }
.m-footer-links { display: flex; flex-wrap: wrap; gap: 4px 18px; }
.m-runs { display: inline-flex; align-items: center; gap: 8px; color: var(--foreground); text-decoration: none; font-weight: 600; margin-inline-start: auto; }
a.m-runs:hover .m-runs-invite { text-decoration: underline; }
.m-runs-invite { font-weight: 400; color: var(--muted-foreground); }
.m-mark { inline-size: 20px; block-size: 20px; }
.m-appearance { display: inline-flex; margin-inline-start: auto; }
.m-runs ~ .m-appearance { margin-inline-start: 0; }
.m-appearance button { display: inline-grid; place-items: center; inline-size: 36px; block-size: 36px; padding: 0; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--muted-foreground); cursor: pointer; transition: background-color var(--state-ms) ease, color var(--state-ms) ease; }
.m-appearance button svg { inline-size: 16px; block-size: 16px; }
@media (hover: hover) and (pointer: fine) { .m-appearance button:hover { background: var(--muted); color: var(--foreground); } }
.m-button { display: flex; align-items: center; justify-content: center; gap: 10px; min-block-size: 48px; inline-size: 100%; padding: 0 20px; border-radius: 999px; font: 600 1rem/1.2 var(--font-sans); text-decoration: none; text-align: center; border: 1px solid var(--input); color: var(--foreground); background: var(--card); cursor: pointer; touch-action: manipulation; transition: background-color var(--state-ms) ease, border-color var(--state-ms) ease, transform var(--press-ms) ease-out; }
.m-button svg, .m-button img { inline-size: 20px; block-size: 20px; flex: none; }
.m-button.m-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
@media (hover: hover) and (pointer: fine) { .m-button:hover { background: var(--muted); } .m-button.m-primary:hover { background: color-mix(in oklch, var(--primary) 88%, var(--foreground)); } }
.m-button:active { transform: scale(var(--press-scale)); }
.m-actions { display: grid; gap: 12px; margin-block: 1.5rem 0; }
.m-list { display: grid; gap: 12px; }
.m-grants { list-style: none; padding: 0; margin: 0 0 1rem; display: grid; gap: 8px; }
.m-grants li { position: relative; padding-inline-start: 22px; }
.m-grants li::before { content: ""; position: absolute; inset-inline-start: 2px; inset-block-start: 0.55em; inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--primary); }
.m-fine { font-size: 0.875rem; color: var(--muted-foreground); margin-block: 1.5rem 0; }
.m-alert { padding: 12px 14px; border-radius: var(--radius); background: var(--muted); margin-block: 0 1.25rem; }
.m-alert-problem { color: var(--destructive); background: color-mix(in oklch, var(--destructive) 8%, var(--card)); }
.m-code { font: 500 1.5rem/1.2 var(--font-mono); letter-spacing: 0.08em; margin: 0 0 1.25rem; }
.m-field { display: grid; gap: 6px; margin-block-end: 1.25rem; }
.m-field label, .m-fieldset legend { font-weight: 600; }
.m-hint { font-size: 0.875rem; color: var(--muted-foreground); margin: 0; }
.m-field input { font: inherit; font-size: 1rem; min-block-size: 48px; padding: 0 14px; border: 1px solid var(--input); border-radius: var(--radius); background: var(--card); color: var(--card-foreground); inline-size: 100%; }
.m-code-input { font-family: var(--font-mono) !important; letter-spacing: 0.08em; }
.m-fieldset { border: 0; padding: 0; margin: 0 0 1.5rem; display: grid; gap: 8px; min-inline-size: 0; }
.m-fieldset legend { padding: 0; margin-block-end: 8px; }
.m-choice { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border: 1px solid var(--input); border-radius: var(--radius); background: var(--card); cursor: pointer; min-block-size: 48px; }
.m-choice:has(input:checked) { border-color: var(--primary); background: var(--accent); color: var(--accent-foreground); }
.m-choice input { accent-color: var(--primary); inline-size: 18px; block-size: 18px; margin: 3px 0 0; flex: none; }
.m-choice:has(input:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
@media (max-width: 720px) {
  .m-split { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .m-stage { min-block-size: 220px; padding: 24px; gap: 24px; }
  .m-stage .m-wordmark { block-size: 26px; }
  .m-art .m-arch { inline-size: 170px; block-size: 170px; inset-block-end: -30px; }
  .m-arch-back { inset-inline-end: 110px; }
  .m-dot { inline-size: 34px; block-size: 34px; inset-inline-end: 96px; inset-block-end: 150px; }
  .m-task { align-self: start; padding: 32px 20px; }
}
@media (max-width: 480px) {
  .m-header { padding: 20px; min-block-size: 0; }
  .m-panel-wrap { padding: 8px 12px 32px; }
  .m-panel { padding: 28px 20px; border-radius: 14px; }
  .m-notice { padding: 16px 20px 56px; }
  .m-footer { padding: 16px 20px; }
  .m-runs { margin-inline-start: 0; }
}
@media (prefers-reduced-motion: reduce) { .m-button { transition: background-color var(--state-ms) ease; } .m-button:active { transform: none; } }
@media (forced-colors: active) { .m-button, .m-choice, .m-panel { border-color: CanvasText; } .m-arch, .m-dot { forced-color-adjust: none; } }
`;
