/**
 * The look of the pages the gateway and the remote server draw themselves (D171): a refusal a
 * person's navigation meets, and on a remote server its API origin's sign-in, device and consent
 * pages. They are `@mostra/themes`' pages, in the theme and under the name the server's operator
 * configured, with their stylesheet, faces and marks served by the page's own origin under
 * `/_mostra/theme/`, so no page needs a script, an inline style or a third party.
 */
import { readFileSync } from "node:fs";
import {
  type Appearance,
  createPages,
  type FooterLink,
  html,
  mostra,
  type PageAsset,
  type Pages,
  studio,
} from "@mostra/themes";

/** Where a page's theme files are served, on every origin that draws one. */
export const THEME_BASE = "/_mostra/theme/";

/** Where "Make pages like this" goes from a page that runs on Mostra. */
export const MADE_WITH_HREF = "https://mostradev.com";

/**
 * How a server's own pages look and name themselves (INTERFACES §18.1 `appearance`): Studio and
 * the name Mostra unless the operator says otherwise.
 */
export interface AppearanceConfig {
  /** `studio` (the default), or `mostra`, Mostra's own brand. */
  readonly theme?: "studio" | "mostra" | undefined;
  /** The name pages speak of: `Mostra` by default, another name, or `null` for none. */
  readonly name?: string | null | undefined;
  /** An image the server serves as its mark: a file it reads at start. */
  readonly logo?: LogoConfig | undefined;
  /** A line on the `mostra` theme's stage. */
  readonly stageLine?: string | undefined;
  /** The appearance a person who never chose gets. */
  readonly default?: Appearance | undefined;
  /** Links in every page's footer: terms, privacy, help. */
  readonly footer?: readonly FooterLink[] | undefined;
}

/** An operator's mark: an SVG, PNG or WebP file of at most 256 KiB, and the size it shows at. */
export interface LogoConfig {
  readonly file: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

/** The kinds of image a logo may be, by extension. */
export const LOGO_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** A server's own pages, and the bytes of every file they load. */
export interface ServerPages {
  readonly pages: Pages;
  /** The theme the operator dressed its pages in. */
  readonly theme: "studio" | "mostra";
  /** The name its pages speak of, or `null` for none. */
  readonly name: string | null;
  /** The appearance a person who never chose gets. */
  readonly defaultAppearance: Appearance;
  /** The answer for a theme file (`path` after `THEME_BASE`), or `undefined` for none. */
  asset(path: string): ThemeFile | undefined;
}

/** One file a page loads: its headers and its bytes. */
export interface ThemeFile {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | string;
}

const extensionOf = (file: string): string => file.slice(file.lastIndexOf(".")).toLowerCase();

/**
 * Makes a server's pages. A logo is read now, so a missing or unusable one stops the server at its
 * start (the caller reports `MOSTRA_REMOTE_CONFIG_INVALID`) rather than at a person's page.
 */
export function serverPages(
  config: AppearanceConfig = {},
  options: { readonly appearanceAction?: string } = {},
): ServerPages {
  const logo = config.logo;
  let logoAsset: PageAsset | undefined;
  let logoBytes: Uint8Array | undefined;
  if (logo) {
    const type = LOGO_TYPES[extensionOf(logo.file)];
    if (!type) throw new Error(`The logo ${logo.file} isn't an SVG, PNG or WebP file.`);
    logoBytes = readFileSync(logo.file);
    if (logoBytes.length > 256 * 1024) throw new Error(`The logo ${logo.file} is over 256 KiB.`);
    logoAsset = {
      path: `logo${extensionOf(logo.file)}`,
      contentType: type,
      body: { text: "" },
      immutable: false,
    };
  }
  const pages = createPages({
    theme: config.theme === "mostra" ? mostra : studio,
    identity: {
      name: config.name === undefined ? "Mostra" : config.name,
      ...(logo && logoAsset
        ? {
            logo: {
              src: `${THEME_BASE}${logoAsset.path}`,
              alt: logo.alt,
              width: logo.width,
              height: logo.height,
            },
          }
        : {}),
      ...(config.stageLine !== undefined ? { stageLine: config.stageLine } : {}),
    },
    assetBase: THEME_BASE,
    madeWithHref: MADE_WITH_HREF,
    ...(config.footer ? { footer: config.footer } : {}),
    ...(options.appearanceAction ? { appearanceAction: options.appearanceAction } : {}),
    ...(config.default ? { defaultAppearance: config.default } : {}),
  });
  const files = new Map<string, ThemeFile>();
  for (const asset of pages.assets) {
    const body = "text" in asset.body ? asset.body.text : readFileSync(new URL(asset.body.fileUrl));
    files.set(asset.path, {
      headers: {
        "content-type": asset.contentType,
        "cache-control": asset.immutable
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
        // An image served alone (an SVG mark opened as its own page) runs nothing.
        ...(asset.contentType === "image/svg+xml"
          ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
          : {}),
      },
      body,
    });
  }
  if (logoAsset && logoBytes) {
    files.set(logoAsset.path, {
      headers: {
        "content-type": logoAsset.contentType,
        "cache-control": "public, max-age=3600",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
      body: logoBytes,
    });
  }
  return {
    pages,
    theme: config.theme ?? "studio",
    name: config.name === undefined ? "Mostra" : config.name,
    defaultAppearance: config.default ?? "system",
    asset: (path) => files.get(path),
  };
}

let standard: ServerPages | undefined;

/** The pages of a server that configured nothing: Studio, named Mostra. Made once. */
export function defaultPages(): ServerPages {
  standard ??= serverPages();
  return standard;
}

/** What a refused navigation says: its message, the way on if there is one, and its code. */
export interface RefusalWords {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly code: string;
}

/**
 * A page for a refused navigation, in the server's theme: no script, nothing of the artifact, and
 * the diagnostic's code in small print, for whoever the person asks for help.
 */
export function refusalDocument(pages: Pages, words: RefusalWords): string {
  // A person who meets one of these at a link reads the page's own words, as the shell would say
  // them; anything else keeps the diagnostic's message and hint.
  const said = PAGE_REFUSALS[words.code] ?? words;
  return pages.render({
    kind: "notice",
    tone: "problem",
    title: said.title,
    body: html`${said.detail ? html`<p>${said.detail}</p>` : ""}<p class="m-fine"><code translate="no">${words.code}</code></p>`,
  });
}

/**
 * What a refused navigation says to a person who opened a link (UX-01: the same words the shell
 * uses for these refusals, `packages/shell/src/messages.ts`, kept equal by a test). Neutral, naming
 * nobody (FAILURE_MODEL §11.3).
 */
export const PAGE_REFUSALS: Readonly<
  Record<string, { readonly title: string; readonly detail: string }>
> = {
  MOSTRA_HYGIENE_TOKEN_REVOKED: {
    title: "This link was revoked or has expired",
    detail: "Ask whoever shared it for a new link.",
  },
  MOSTRA_HYGIENE_SESSION_MISSING: {
    title: "Open the full link to view this artifact",
    detail: "This page needs the link you were given, including everything after the #.",
  },
  MOSTRA_HYGIENE_TOKEN_INVALID: {
    title: "This link doesn't work",
    detail: "It may be incomplete or belong to another artifact. Copy the whole link again.",
  },
  MOSTRA_REMOTE_UNDER_REVIEW: {
    title: "This page is under review",
    detail: "The people who run this server are looking at it. Try again later.",
  },
  MOSTRA_REMOTE_HOME_SUSPENDED: {
    title: "This page isn't available",
    detail: "The account that shared it is suspended on this server.",
  },
  MOSTRA_REMOTE_HOME_MOVING: { title: "This page is moving", detail: "Try again in a minute." },
  MOSTRA_REMOTE_LIMIT_REACHED: {
    title: "This page isn't available right now",
    detail: "Try again later.",
  },
  MOSTRA_HYGIENE_HOST_REFUSED: {
    title: "There's no page here",
    detail: "Check the link you were given: this address doesn't serve one.",
  },
};

/** The `Content-Security-Policy` of a theme page that `frameAncestors` may frame. */
export function themePageCsp(pages: Pages, frameAncestors = "'none'", formAction?: string): string {
  return [
    pages.csp.replace("frame-ancestors 'none'", `frame-ancestors ${frameAncestors}`),
    ...(formAction ? [`form-action ${formAction}`] : ["form-action 'none'"]),
  ].join("; ");
}
