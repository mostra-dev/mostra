/**
 * Re-bundles a version's client build into one module (D175 item 2): the entry the build's
 * `index.html` loads, its static and dynamic imports inlined, every file of the build it names by
 * path (`"/assets/logo-H.png"`) as a `data:` URL, so the page needs nothing but itself.
 */
import type { FileTree } from "@mostra/contract-exporter";
import { rolldown } from "rolldown";

/** The media types of the files a page may name, by extension; anything else is octet-stream. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".css": "text/css",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Font files, which a chat host's default policy never loads (no `font-src`, VERIFIED_FACTS). */
export const FONT_EXTENSIONS: readonly string[] = [".woff", ".woff2", ".ttf", ".otf", ".eot"];

/** The extension of a path, lower case, with its dot. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** A file as a `data:` URL. */
export function dataUrl(path: string, bytes: Uint8Array): string {
  const type = MEDIA_TYPES[extensionOf(path)] ?? "application/octet-stream";
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The client build's files the page may name by URL (`/assets/x.png`), by that URL. */
export interface ClientFiles {
  /** Every file of `client/`, by its URL path (`/assets/index-H.js`). */
  readonly paths: ReadonlySet<string>;
  /** A file's bytes by its URL path. */
  read(urlPath: string): Promise<Uint8Array>;
}

/** The client build of a version's file tree, by URL path. */
export async function clientFiles(files: FileTree): Promise<ClientFiles> {
  const paths = new Set<string>();
  for (const path of await files.list()) {
    if (path.startsWith("client/")) paths.add(path.slice("client".length));
  }
  return { paths, read: (urlPath) => files.read(`client${urlPath}`) };
}

/** The characters a quoted URL path may hold, so a replacement never runs into code around it. */
const QUOTED_PATH = /(["'`])(\/[A-Za-z0-9._~\-/@%+]+)\1/g;

/**
 * Replaces each quoted URL path of a build file (`"/assets/logo-H.png"`) with its `data:` URL.
 * Only exact quoted paths of files the build holds change, never text that merely contains one.
 */
export async function inlineQuotedPaths(
  code: string,
  client: ClientFiles,
  skip: (urlPath: string) => boolean,
): Promise<{ readonly code: string; readonly inlined: readonly string[] }> {
  const found = new Map<string, string>();
  for (const match of code.matchAll(QUOTED_PATH)) {
    const path = match[2] as string;
    if (!client.paths.has(path) || skip(path) || found.has(path)) continue;
    found.set(path, dataUrl(path, await client.read(path)));
  }
  if (found.size === 0) return { code, inlined: [] };
  const replaced = code.replace(QUOTED_PATH, (whole, quote: string, path: string) => {
    const url = found.get(path);
    return url === undefined ? whole : `${quote}${url}${quote}`;
  });
  return { code: replaced, inlined: [...found.keys()] };
}

/** Resolves an import of a build module (`./chunk-H.js`, `/assets/x.js`) to its URL path. */
function resolveUrlPath(specifier: string, importer: string | undefined): string | undefined {
  if (specifier.startsWith("/")) return new URL(specifier, "http://page.invalid").pathname;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = importer ?? "/";
    return new URL(specifier, `http://page.invalid${base}`).pathname;
  }
  return undefined;
}

/** The prefix rolldown sees build modules under, so no path of this machine is ever read. */
const MODULE_PREFIX = "\0mostra-client:";

/** What {@link bundleEntry} produced. */
export interface Bundled {
  /** The one module's code. */
  readonly code: string;
  /** The build's modules it holds, by URL path. */
  readonly modules: readonly string[];
  /** The files it names by URL that became `data:` URLs. */
  readonly inlined: readonly string[];
}

/**
 * Bundles the build's module `entry` (a URL path) and everything it imports into one ES module.
 * Every module comes from the version's file tree: an import outside it (a bare specifier, a URL)
 * throws, since a built page imports only its own chunks.
 */
export async function bundleEntry(
  entry: string,
  client: ClientFiles,
  skipInline: (urlPath: string) => boolean,
): Promise<Bundled> {
  const modules: string[] = [];
  const inlined = new Set<string>();
  const build = await rolldown({
    input: `${MODULE_PREFIX}${entry}`,
    // The build is minified already; re-bundling only joins it.
    treeshake: false,
    logLevel: "silent",
    plugins: [
      {
        name: "mostra-client",
        resolveId(specifier, importer) {
          const from = importer?.startsWith(MODULE_PREFIX)
            ? importer.slice(MODULE_PREFIX.length)
            : undefined;
          const target = specifier.startsWith(MODULE_PREFIX)
            ? specifier.slice(MODULE_PREFIX.length)
            : resolveUrlPath(specifier, from);
          if (target === undefined || !client.paths.has(target)) {
            throw new Error(
              `the build's module ${from ?? entry} imports ${JSON.stringify(specifier)}, which isn't a file of the build`,
            );
          }
          return `${MODULE_PREFIX}${target}`;
        },
        async load(id) {
          if (!id.startsWith(MODULE_PREFIX)) return null;
          const path = id.slice(MODULE_PREFIX.length);
          modules.push(path);
          const text = new TextDecoder().decode(await client.read(path));
          // The build's source map comment names a file the page won't have.
          const code = text.replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, "\n");
          const done = await inlineQuotedPaths(code, client, (urlPath) => {
            if (skipInline(urlPath)) return true;
            // A module of the build is joined into the bundle, never inlined as a string.
            return extensionOf(urlPath) === ".js" || extensionOf(urlPath) === ".map";
          });
          for (const path of done.inlined) inlined.add(path);
          return { code: done.code, moduleType: "js" };
        },
      },
    ],
  });
  try {
    const { output } = await build.generate({
      format: "es",
      // One module: dynamic imports are inlined, never split into chunks.
      codeSplitting: false,
      sourcemap: false,
      comments: { legal: false },
    });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk?.type !== "chunk") throw new Error("re-bundling produced no module");
    return { code: chunk.code, modules, inlined: [...inlined] };
  } finally {
    await build.close();
  }
}
