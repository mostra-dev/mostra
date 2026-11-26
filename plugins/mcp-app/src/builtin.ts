/**
 * Mostra's built-in exports of a page's front end (D185 items 7 and 8, VR-07): `static`, a folder
 * that opens from disk and on any static host at any path, and `html`, one file with everything
 * inline. A snapshot is `static` with its frozen answers. Each carries the page's demos: in a
 * folder twice, as built (served at the export's base) and made to open from disk; in one file
 * when the demo's build is one graph of ES modules. The runtime runs these in a plugin child on a
 * version's client files, never on its server code (RT-02), with the facts it gathered (what the
 * page loses, its live values, a snapshot's answers) as options. They are not contributions: no
 * plugin can take their IDs (D172 item 5).
 */
import {
  defineExporter,
  type Exporter,
  type ExporterDefinition,
  type ExportResult,
  type FileTree,
} from "@mostra/contract-exporter";
import { bundleEntry, type ClientFiles, clientFiles, dataUrl, extensionOf } from "./bundle.ts";
import { moduleElements } from "./page.ts";

/** How a demo moves between its pages. */
type Routing = "history" | "hash";

/** The options the runtime gives a built-in exporter. */
export interface BuiltinOptions {
  /** What the page is told about its export (`#mostra-export`), less its demos. */
  readonly facts: Readonly<Record<string, unknown>>;
  /** A snapshot's frozen answers (`#mostra-snapshot`, `snapshot.json`). */
  readonly snapshot?: Readonly<Record<string, unknown>>;
  /** The version's demos, each with the base its kept build was made for. */
  readonly demos: readonly {
    readonly name: string;
    readonly routing: Routing;
    readonly base: string;
  }[];
}

/** What a built-in export reports, in `.mostra-report.json` (read and left out by the runtime). */
export interface BuiltinReport {
  readonly notInlined: readonly string[];
  readonly demos: readonly {
    readonly name: string;
    readonly routing: Routing;
    readonly carried: "full" | "root" | "folder-only";
  }[];
}

/** The report's file: the runtime reads it and never writes it out. */
export const REPORT_FILE = ".mostra-report.json";

/** The sentence a history-routed demo's frame shows from disk (M106). */
export const SERVER_SENTENCE =
  "Moving between pages needs this export to be opened through a web server, for example npx serve <folder> or any static host. This page works as is.";

/** Files whose text names other files of the build by path. */
const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".txt",
  ".svg",
  ".webmanifest",
  ".xml",
  ".map",
]);

/** JSON for inside a `<script>` element: no `<` can end it early. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** The URLs a stylesheet names: `url(x)`, `url("x")`, `url('x')`. */
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * A stylesheet with each file of the build it names given an address of `address`'s choosing
 * (a relative path, or a `data:` URL), and the absolute URLs it names, which need a network.
 */
async function rewriteStylesheet(
  css: string,
  files: ClientFiles,
  address: (urlPath: string) => Promise<string>,
): Promise<{ readonly css: string; readonly external: readonly string[] }> {
  const external = new Set<string>();
  const found = new Map<string, string>();
  for (const match of css.matchAll(CSS_URL)) {
    const url = match[2] as string;
    const path = url.split(/[?#]/)[0] ?? url;
    if (files.paths.has(path)) {
      if (!found.has(path)) found.set(path, await address(path));
    } else if (/^https?:\/\//i.test(url)) external.add(url);
  }
  return {
    css: css.replace(CSS_URL, (whole, _quote: string, url: string) => {
      const path = url.split(/[?#]/)[0] ?? url;
      const to = found.get(path);
      return to === undefined ? whole : `url("${to}")`;
    }),
    external: [...external],
  };
}

/** The module entry and stylesheets a built document loads, and the document without them. */
function splitDocument(html: string): {
  readonly entry: string | undefined;
  readonly stylesheets: readonly string[];
  readonly rest: string;
} {
  const entry = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/i.exec(
    html,
  )?.[1];
  const stylesheets = [
    ...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi),
  ].map((match) => match[1] as string);
  const rest = html
    .replace(/<script\b[^>]*\btype="module"[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/gi, "")
    .replace(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>\s*/gi, "");
  return { entry, stylesheets, rest };
}

/** `html` with `head` written right after its `<head>`, and `body` right before its `</body>`. */
function insert(html: string, head: string, body: string): string {
  const opening = /<head\b[^>]*>/i.exec(html);
  const withHead = opening
    ? `${html.slice(0, opening.index + opening[0].length)}${head}${html.slice(opening.index + opening[0].length)}`
    : `${head}${html}`;
  const closing = withHead.toLowerCase().lastIndexOf("</body>");
  return closing < 0
    ? `${withHead}${body}`
    : `${withHead.slice(0, closing)}${body}${withHead.slice(closing)}`;
}

/**
 * The script a history-routed demo's documents run first when they are opened from disk (M106):
 * Chromium and WebKit refuse moving to another path in a `file:` page, so a navigation there (a
 * link inside the demo, or the history API) shows, once per session, a notice saying what does,
 * in place of nothing happening. Hash-routed demos and Firefox never see it.
 */
function historyGuard(): string {
  const sentence = JSON.stringify(SERVER_SENTENCE);
  return `<script>(function () {
  // Only where the browser refuses moving to another path: a page opened from disk, or a
  // single file's demo at its own blob: address. Over a web server this does nothing.
  var refused = false;
  try {
    var here = location.href;
    history.replaceState(history.state, "", here.replace(/[^/]*$/, "mostra-probe"));
    history.replaceState(history.state, "", here);
  } catch (error) { refused = true; }
  if (!refused) return;
  function notice() {
    try { if (sessionStorage.getItem("mostra-demo-notice")) return; sessionStorage.setItem("mostra-demo-notice", "1"); } catch (error) {}
    var bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.setAttribute("data-mostra-demo-notice", "");
    bar.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-radius:8px;background:rgba(24,24,27,.92);color:#fafafa;font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif";
    var words = document.createElement("span");
    words.style.flex = "1";
    words.textContent = ${sentence};
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "\\u00d7";
    close.setAttribute("aria-label", "Dismiss");
    close.style.cssText = "border:0;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer";
    close.onclick = function () { bar.remove(); };
    bar.append(words, close);
    (document.body || document.documentElement).append(bar);
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var own = history[name];
    history[name] = function () {
      try { return own.apply(this, arguments); }
      catch (error) { if (error && error.name === "SecurityError") { notice(); return; } throw error; }
    };
  });
  addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    var href = link.getAttribute("href") || "";
    if (href.charAt(0) === "#" || /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return;
    var to = null;
    try { to = new URL(href, location.href); } catch (error) {}
    if (to && to.pathname === location.pathname) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    notice();
  }, true);
})();</script>`;
}

/**
 * The script a single file's demo runs first: its document lives at a `blob:` address, where
 * Chromium refuses loading the same address with another fragment (a link to `#/items/2`), yet
 * takes the history API's fragment change. A link to a fragment of the document moves there that
 * way and says so (`hashchange`), as a browser does, so a hash-routed demo moves between its pages
 * inside the single file in every engine.
 */
function fragmentShim(): string {
  return `<script>(function () {
  if (location.protocol !== "blob:") return;
  addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || link.target === "_blank") return;
    var href = link.getAttribute("href") || "";
    if (href.charAt(0) !== "#" || event.defaultPrevented) return;
    event.preventDefault();
    var before = location.href;
    history.pushState(history.state, "", href);
    dispatchEvent(new HashChangeEvent("hashchange", { oldURL: before, newURL: location.href }));
  });
})();</script>`;
}

/** The client files of one kept demo, by the URL paths its build uses. */
function demoFiles(all: ClientFiles, name: string, base: string): ClientFiles {
  const prefix = `/_mostra/demos/${name}/`;
  const paths = new Set<string>();
  for (const path of all.paths) {
    if (path.startsWith(prefix)) paths.add(`${base}${path.slice(prefix.length)}`);
  }
  return {
    paths,
    read: (urlPath) => all.read(`${prefix}${urlPath.slice(base.length)}`),
  };
}

/**
 * A demo as one document, everything inline, when its build is one graph of ES modules: its page,
 * its stylesheets and its modules joined, every file they name a `data:` URL; `undefined` for a
 * build that loads its scripts some other way.
 */
async function demoDocument(
  files: ClientFiles,
  base: string,
  routing: Routing,
  external: Set<string>,
): Promise<string | undefined> {
  const page = `${base}index.html`;
  if (!files.paths.has(page)) return undefined;
  const html = text(await files.read(page));
  // A classic script of the build is one Mostra can't join into a module.
  if (/<script\b(?![^>]*\btype="module")[^>]*\bsrc="(?!https?:)/i.test(html)) return undefined;
  const { entry, stylesheets, rest } = splitDocument(html);
  if (
    entry === undefined ||
    !files.paths.has(new URL(entry, `http://demo.invalid${base}`).pathname)
  ) {
    return undefined;
  }
  const inline = async (urlPath: string): Promise<string> =>
    dataUrl(urlPath, await files.read(urlPath));
  const css: string[] = [];
  for (const sheet of stylesheets) {
    const path = new URL(sheet, `http://demo.invalid${base}`).pathname;
    if (!files.paths.has(path)) {
      external.add(sheet);
      continue;
    }
    const rewritten = await rewriteStylesheet(text(await files.read(path)), files, inline);
    for (const url of rewritten.external) external.add(url);
    css.push(rewritten.css);
  }
  let bundled: Awaited<ReturnType<typeof bundleEntry>>;
  try {
    bundled = await bundleEntry(
      new URL(entry, `http://demo.invalid${base}`).pathname,
      files,
      () => false,
      (urlPath, client) => client.read(urlPath).then((bytes) => dataUrl(urlPath, bytes)),
    );
  } catch {
    return undefined;
  }
  const head = `${fragmentShim()}${routing === "history" ? historyGuard() : ""}<style>${css.join("\n").replace(/<\/(style)/gi, "<\\/$1")}</style><script>addEventListener("vite:preloadError", function (event) { event.preventDefault(); });</script>`;
  return insert(rest, head, `${moduleElements(bundled.code)}\n`);
}

/**
 * A demo's files made to open from disk, for a build Mostra can't join into one document: each
 * text file's base made relative, so the demo opens on its first page from its folder.
 */
async function relativeDemo(
  files: ClientFiles,
  base: string,
  routing: Routing,
): Promise<{ path: string; content: string | Uint8Array }[]> {
  const out: { path: string; content: string | Uint8Array }[] = [];
  for (const urlPath of [...files.paths].sort()) {
    const path = urlPath.slice(base.length);
    const bytes = await files.read(urlPath);
    const extension = extensionOf(path);
    if (!TEXT_EXTENSIONS.has(extension)) {
      out.push({ path, content: bytes });
      continue;
    }
    const depth = path.split("/").length - 1;
    // HTML and CSS resolve from where they are; scripts from the document they run in.
    const up = extension === ".html" || extension === ".htm" || extension === ".css" ? depth : 0;
    const prefix = up > 0 ? "../".repeat(up) : "./";
    let content = text(bytes).replaceAll(base, prefix);
    if ((extension === ".html" || extension === ".htm") && routing === "history") {
      content = insert(content, historyGuard(), "");
    }
    out.push({ path, content });
  }
  return out;
}

/** What both built-in exports read of the page. */
async function pageOf(
  files: FileTree,
  client: ClientFiles,
  address: (urlPath: string) => Promise<string>,
): Promise<{
  readonly rest: string;
  readonly css: string;
  readonly code: string;
  readonly external: readonly string[];
}> {
  const built = text(await client.read("/index.html"));
  const { entry, stylesheets, rest } = splitDocument(built);
  if (entry === undefined) throw new Error("the build's index.html names no module script");
  const external = new Set<string>();
  const css: string[] = [];
  const sheets = [
    ...stylesheets,
    ...[...client.paths].filter(
      (path) =>
        extensionOf(path) === ".css" &&
        !stylesheets.includes(path) &&
        !path.startsWith("/_mostra/"),
    ),
  ];
  for (const sheet of sheets) {
    if (!client.paths.has(sheet)) continue;
    const rewritten = await rewriteStylesheet(text(await client.read(sheet)), client, address);
    for (const url of rewritten.external) external.add(url);
    css.push(rewritten.css);
  }
  const bundled = await bundleEntry(
    entry,
    client,
    (path) => path.startsWith("/_mostra/"),
    (urlPath) => address(urlPath),
  );
  void files;
  return { rest, css: css.join("\n"), code: bundled.code, external: [...external] };
}

/** The exported page: the built document marked for its target, with its facts and its code. */
function exportedPage(
  rest: string,
  css: string,
  code: string,
  facts: Readonly<Record<string, unknown>>,
  snapshot: Readonly<Record<string, unknown>> | undefined,
  extra = "",
): string {
  const head = [
    "",
    '    <meta name="mostra-target" content="static" />',
    `    <script type="application/json" id="mostra-export">${scriptJson(facts)}</script>`,
    ...(snapshot
      ? [
          `    <script type="application/json" id="mostra-snapshot">${scriptJson(snapshot)}</script>`,
        ]
      : []),
    '    <script>addEventListener("vite:preloadError", function (event) { event.preventDefault(); });</script>',
    `    <style>${css.replace(/<\/(style)/gi, "<\\/$1")}</style>`,
    "",
  ].join("\n");
  return insert(rest, head, `${extra}${moduleElements(code)}\n`);
}

/** The README a folder holding a history-routed demo carries (M106, M107). */
function readme(title: string): string {
  return [
    `${title}: an export made with Mostra`,
    "",
    "Open index.html in a browser. The page works as is, opened straight from this folder.",
    "",
    "Its demos open on their first page from disk. Moving between a demo's pages needs a web",
    "server, because browsers don't allow it in a file opened from disk:",
    "",
    "- To look at it on this computer, serve the folder: npx serve <folder>",
    "- To host it at a subpath (a GitHub Pages project site, user.github.io/repo/), export it again",
    "  with that path, so its demos work fully there: mostra export <artifact> --as static --base /repo/",
    "",
  ].join("\n");
}

/** `static` (and a snapshot): a folder that opens from disk and on any static host. */
async function exportStatic(files: FileTree, options: BuiltinOptions): Promise<ExportResult> {
  const client = await clientFiles(files);
  const relative = async (urlPath: string): Promise<string> => `.${urlPath}`;
  const page = await pageOf(files, client, relative);
  const external = new Set(page.external);
  const out: { path: string; content: string | Uint8Array }[] = [];
  const report: BuiltinReport["demos"][number][] = [];
  const demoFacts: Record<string, unknown> = {};
  for (const demo of options.demos) {
    const kept = demoFiles(client, demo.name, demo.base);
    // As built, for the folder served at its base.
    for (const urlPath of kept.paths) {
      out.push({
        path: `_mostra/demos/${demo.name}/${urlPath.slice(demo.base.length)}`,
        content: await kept.read(urlPath),
      });
    }
    // For opening from disk: one document when it can be, else its files made relative.
    const single = await demoDocument(kept, demo.base, demo.routing, external);
    if (single !== undefined) out.push({ path: `demos/${demo.name}/index.html`, content: single });
    else {
      for (const file of await relativeDemo(kept, demo.base, demo.routing)) {
        out.push({ path: `demos/${demo.name}/${file.path}`, content: file.content });
      }
    }
    demoFacts[demo.name] = { root: `_mostra/demos/${demo.name}/`, disk: `demos/${demo.name}/` };
    report.push({
      name: demo.name,
      routing: demo.routing,
      carried: demo.routing === "hash" ? "full" : "root",
    });
  }
  // The page's other files, beside it under the same paths; its code is inline.
  for (const urlPath of client.paths) {
    if (urlPath === "/index.html" || urlPath.startsWith("/_mostra/")) continue;
    const extension = extensionOf(urlPath);
    if (extension === ".js" || extension === ".map" || extension === ".css") continue;
    out.push({ path: urlPath.slice(1), content: await client.read(urlPath) });
  }
  const facts = { ...options.facts, demos: demoFacts };
  out.push({
    path: "index.html",
    content: exportedPage(page.rest, page.css, page.code, facts, options.snapshot),
  });
  if (options.snapshot) {
    out.push({ path: "snapshot.json", content: `${JSON.stringify(options.snapshot, null, 2)}\n` });
  }
  if (options.demos.some((demo) => demo.routing === "history")) {
    out.push({
      path: "README.txt",
      content: readme(String(options.facts["title"] ?? "This page")),
    });
  }
  const builtinReport: BuiltinReport = { notInlined: [...external].sort(), demos: report };
  out.push({ path: REPORT_FILE, content: `${JSON.stringify(builtinReport)}\n` });
  return { files: out, entry: "index.html" };
}

/** `html`: one file, everything inline, with every demo that fits in it. */
async function exportHtml(files: FileTree, options: BuiltinOptions): Promise<ExportResult> {
  const client = await clientFiles(files);
  const inline = async (urlPath: string): Promise<string> =>
    dataUrl(urlPath, await client.read(urlPath));
  const page = await pageOf(files, client, inline);
  const external = new Set(page.external);
  const report: BuiltinReport["demos"][number][] = [];
  const demoFacts: Record<string, unknown> = {};
  const carriers: string[] = [];
  let history = false;
  for (const demo of options.demos) {
    const kept = demoFiles(client, demo.name, demo.base);
    const single = await demoDocument(kept, demo.base, demo.routing, external);
    if (single === undefined) {
      demoFacts[demo.name] = { missing: true };
      report.push({ name: demo.name, routing: demo.routing, carried: "folder-only" });
      continue;
    }
    const id = `mostra-demo-${demo.name}`;
    carriers.push(
      `    <script type="application/octet-stream" id="${id}">${Buffer.from(single, "utf8").toString("base64")}</script>\n`,
    );
    demoFacts[demo.name] = { document: id };
    if (demo.routing === "history") history = true;
    report.push({
      name: demo.name,
      routing: demo.routing,
      carried: demo.routing === "hash" ? "full" : "root",
    });
  }
  const facts = {
    ...options.facts,
    demos: demoFacts,
    ...(history ? { notice: SERVER_SENTENCE } : {}),
  };
  const html = exportedPage(
    page.rest,
    page.css,
    page.code,
    facts,
    options.snapshot,
    carriers.join(""),
  );
  const builtinReport: BuiltinReport = { notInlined: [...external].sort(), demos: report };
  return {
    files: [
      { path: "index.html", content: html },
      { path: REPORT_FILE, content: `${JSON.stringify(builtinReport)}\n` },
    ],
    entry: "index.html",
  };
}

const OPTIONS = { type: "object", additionalProperties: true } as const;

/** `static` and `snapshot`: a folder (D185 item 7). */
export const staticExporter: Exporter = defineExporter<ExporterDefinition>({
  id: "static",
  title: "Static page",
  description: "The page's front end as a folder that opens from disk and on any static host.",
  output: { mediaType: "text/html", layout: "directory" },
  options: OPTIONS,
  async export({ files, options }) {
    return exportStatic(files, options as unknown as BuiltinOptions);
  },
});

/** `html`: one file (D185 item 7). */
export const htmlExporter: Exporter = defineExporter<ExporterDefinition>({
  id: "html",
  title: "Single HTML file",
  description: "The page's front end as one file with everything inline.",
  output: { mediaType: "text/html", layout: "directory" },
  options: OPTIONS,
  async export({ files, options }) {
    return exportHtml(files, options as unknown as BuiltinOptions);
  },
});
