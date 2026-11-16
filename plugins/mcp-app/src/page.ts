/**
 * The MCP App's document (D175 item 2): one HTML5 page holding the version's whole client build,
 * marked for the `mcp-app` target, with the token table the runtime applies to the host's context
 * and the origins its own code names, declared for the host's policy.
 */
import type { FileTree } from "@mostra/contract-exporter";
import { HOST_TOKENS } from "@mostra/themes";
import { type ClientFiles, dataUrl, extensionOf, FONT_EXTENSIONS } from "./bundle.ts";

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Text that goes inside an element whose content isn't parsed as HTML (`<script>`, `<style>`).
 * In a script, `</script`, `<script` and `<!--` change where HTML ends it, so their `<` is
 * written `\x3C`: the same character to JavaScript in a string, a template or a regular
 * expression, and impossible elsewhere in a module. In a stylesheet `</style` ends it, written
 * `<\/style` (CSS reads `\/` as `/`).
 */
export function rawText(text: string, tag: "script" | "style"): string {
  return tag === "script"
    ? text.replace(/<(\/script|script|!--)/gi, "\\x3C$1")
    : text.replace(/<\/(style)/gi, "<\\/$1");
}

/** What the build's `index.html` names: its module entry and stylesheets, its language. */
export interface BuiltPage {
  readonly entry: string;
  readonly stylesheets: readonly string[];
  readonly lang: string;
}

/** Reads the build's `index.html` (the builder's own, INTERFACES §11). */
export function readBuiltPage(html: string): BuiltPage {
  const entry = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1];
  if (entry === undefined) throw new Error("the build's index.html names no module script");
  const stylesheets = [
    ...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi),
  ].map((match) => match[1] as string);
  const lang = /<html\b[^>]*\blang="([^"]*)"/i.exec(html)?.[1] ?? "en";
  return { entry, stylesheets, lang };
}

/** The URLs a stylesheet names: `url(x)`, `url("x")`, `url('x')`. */
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * A stylesheet for the page: each file of the build it names as a `data:` URL, its `@font-face`
 * rules for the build's own faces left out (a chat host's policy loads no font, VERIFIED_FACTS,
 * WP-17; the host's faces take their place, D141 item 4), and the absolute `https:` origins it
 * names.
 */
export async function inlineStylesheet(
  css: string,
  client: ClientFiles,
): Promise<{ readonly css: string; readonly origins: readonly string[]; readonly fonts: number }> {
  let fonts = 0;
  const withoutFaces = css.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const named = [...rule.matchAll(CSS_URL)].map((match) => match[2] as string);
    const ours =
      named.length > 0 && named.every((url) => client.paths.has(url.split(/[?#]/)[0] ?? url));
    if (!ours) return rule;
    fonts += 1;
    return "";
  });
  const origins = new Set<string>();
  const urls = new Map<string, string>();
  for (const match of withoutFaces.matchAll(CSS_URL)) {
    const url = match[2] as string;
    const path = url.split(/[?#]/)[0] ?? url;
    if (client.paths.has(path) && !FONT_EXTENSIONS.includes(extensionOf(path))) {
      if (!urls.has(path)) urls.set(path, dataUrl(path, await client.read(path)));
      continue;
    }
    const origin = httpsOrigin(url);
    if (origin !== undefined) origins.add(origin);
  }
  const inlined = withoutFaces.replace(CSS_URL, (whole, _quote: string, url: string) => {
    const path = url.split(/[?#]/)[0] ?? url;
    const data = urls.get(path);
    return data === undefined ? whole : `url("${data}")`;
  });
  return { css: inlined, origins: [...origins], fonts };
}

/** The origin of an absolute `https:` URL, or `undefined`. */
export function httpsOrigin(url: string): string | undefined {
  if (!/^https:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "" ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
}

/** Absolute `https:` URLs in code. */
const HTTPS_URL = /https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?/g;

/**
 * The `https:` origins the artifact's own code names, from the build's source maps: only the
 * sources the artifact wrote (under its `source/` directory, never a package's), since packages'
 * documentation links (react.dev, json-schema.org) are never fetched. A build without source maps
 * declares every origin its modules name.
 */
export async function ownOrigins(
  files: FileTree,
  modules: readonly string[],
): Promise<readonly string[]> {
  const origins = new Set<string>();
  const listed = new Set(await files.list());
  for (const module of modules) {
    const map = `client${module}.map`;
    if (!listed.has(map)) {
      for (const match of (await files.readText(`client${module}`)).matchAll(HTTPS_URL)) {
        const origin = httpsOrigin(match[0]);
        if (origin) origins.add(origin);
      }
      continue;
    }
    const parsed = JSON.parse(await files.readText(map)) as {
      sources?: (string | null)[];
      sourcesContent?: (string | null)[];
    };
    for (const [index, source] of (parsed.sources ?? []).entries()) {
      if (source === null || !isOwnSource(source)) continue;
      const content = parsed.sourcesContent?.[index];
      if (typeof content !== "string") continue;
      for (const match of content.matchAll(HTTPS_URL)) {
        const origin = httpsOrigin(match[0]);
        if (origin) origins.add(origin);
      }
    }
  }
  return [...origins].sort();
}

/** Whether a source map's source is the artifact's own file, not a package's or Mostra's. */
export function isOwnSource(source: string): boolean {
  const path = source.replaceAll("\\", "/");
  return /(^|\/)source\//.test(path) && !path.includes("/node_modules/");
}

/** The page's parts. */
export interface PageParts {
  readonly title: string;
  readonly lang: string;
  readonly versionId: string;
  readonly css: string;
  readonly code: string;
}

/**
 * The document. The module runs last, after the stylesheet; a dynamic import's preload of a
 * stylesheet or chunk the page already holds is told not to fail (Vite's `vite:preloadError`).
 */
export function pageHtml(parts: PageParts): string {
  // JSON's own escape for `<`, so no sequence in it can end the script element.
  const tokens = JSON.stringify(HOST_TOKENS).replaceAll("<", "\\u003c");
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(parts.lang)}">`,
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <meta name="mostra-version" content="${escapeHtml(parts.versionId)}" />`,
    '    <meta name="mostra-target" content="mcp-app" />',
    `    <title>${escapeHtml(parts.title)}</title>`,
    `    <script type="application/json" id="mostra-host-tokens">${tokens}</script>`,
    '    <script>addEventListener("vite:preloadError", function (event) { event.preventDefault(); });</script>',
    `    <style>${rawText(parts.css, "style")}</style>`,
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    `    <script type="module">${rawText(parts.code, "script")}</script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}
