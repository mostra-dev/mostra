/**
 * What a build takes of the kit (ROUND-3 §1.1, D181): `@/…` resolving to the artifact's own copy
 * first and the kit's registry for its base next, and the stylesheet the client entry imports,
 * which puts the theme stack inside the build's one Tailwind run.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { HOST_TOKENS } from "@mostra/themes";
import type { Plugin } from "vite";
import { isUnder, pathKey } from "../../platform/index.ts";
import {
  findUnder,
  kitFilesUsed,
  kitModulePath,
  kitPeers,
  packageOfSpecifier,
} from "../kit-files.ts";
import type { KitBuild } from "../types.ts";

export { findUnder, kitFilesUsed, kitModulePath };

/**
 * `@/…` as an artifact means it (ROUND-3 §1.1): the artifact's own file when it has one, else the
 * kit's copy of that registry item for the artifact's base, read in place, so a page imports
 * `@/components/ui/button` with nothing installed and `mostra add button` makes the copy that then
 * wins. The kit's own files resolve `@/…` the same way, so a copied `button.tsx` is the button a
 * kit dialog uses too. A kit module (`@mostra/kit/questionnaire`) resolves by the same rule, from
 * `components/mostra/`, so `mostra add mostra-questionnaire` makes a copy the page then uses.
 */
export function kitResolvePlugin(sourceDir: string, kit: KitBuild): Plugin {
  return {
    name: "mostra:kit-resolve",
    enforce: "pre",
    resolveId(source) {
      // A query (`?raw`, `?url`, `?inline`, `?worker`) says how the file is taken: it stays on
      // what this resolves to (Opus review of WP-18, finding 3).
      const at = source.indexOf("?");
      const [path, query] = at === -1 ? [source, ""] : [source.slice(0, at), source.slice(at)];
      const rest = kitRest(sourceDir, path);
      if (rest === undefined) return null;
      const own = findUnder(sourceDir, rest);
      if (own !== undefined) return own + query;
      if (kit.registry !== undefined) {
        const kitFile = findUnder(kit.registry, rest);
        if (kitFile !== undefined) return kitFile + query;
      }
      return null;
    },
  };
}

/**
 * The kit's on-demand libraries as the artifact has them (D65, WP-19): a kit module that imports
 * MapLibre or three.js takes the copy the artifact's lockfile installed (the dependency module
 * adds the kit's pin to it when the artifact uses the module), never one beside the kit, so the
 * build is the same from the runtime bundle as from this repository, and the version's lockfile
 * digest covers it. `buildRoot` is the build's root, whose `node_modules` is the artifact's layout.
 */
export function kitPeersPlugin(
  buildRoot: string,
  /**
   * The real directories of the build's packages (the warm set and the artifact's lockfile): a
   * peer found anywhere else, such as a `node_modules` above the home, is refused, as
   * `confinePlugin` refuses the artifact's own imports (Opus review of WP-19, finding 1).
   */
  packageRoots: readonly string[],
): Plugin {
  let kit: { readonly dir: string; readonly peers: ReadonlyMap<string, string> } | undefined;
  const load = (): typeof kit => {
    if (kit === undefined) {
      const link = join(buildRoot, "node_modules", "@mostra", "kit");
      const dir = existsSync(link) ? realpathSync(link) : "";
      kit = { dir, peers: dir === "" ? new Map() : kitPeers(dir) };
    }
    return kit;
  };
  return {
    name: "mostra:kit-peers",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || source.startsWith("\0")) return null;
      const name = packageOfSpecifier(source);
      if (name === undefined) return null;
      const { dir, peers } = load() ?? { dir: "", peers: new Map() };
      if (dir === "" || !peers.has(name)) return null;
      const from = importer.split("?")[0] ?? importer;
      const real = existsSync(from) ? realpathSync(from) : from;
      if (!isUnder(real, dir)) return null;
      // As if the artifact's own root imported it: from the layout its lockfile installed, and
      // from nowhere else (VR-01: every byte of a version is covered by its digests).
      const resolved = await this.resolve(source, join(buildRoot, "index.html"), {
        ...options,
        skipSelf: true,
      });
      const id = resolved?.id.split("?")[0];
      if (resolved && (resolved.external || id === undefined || id.startsWith("\0"))) {
        return resolved;
      }
      if (resolved && id !== undefined && isAbsolute(id) && existsSync(id)) {
        const file = realpathSync.native(id);
        if (packageRoots.some((root) => isUnder(file, root))) return resolved;
      }
      const module = relative(dir, real).split("\\").join("/");
      const pin = peers.get(name);
      return this.error(
        `Could not resolve "${source}" from the kit's ${module}: ${name} isn't in the artifact's lockfile, and a version is built only from the warm set and its lockfile's packages; add it with \`mostra add ${name}${pin ? `@${pin}` : ""}\`.`,
      );
    },
  };
}

/** One set of files a kit peer loads at run time from the page's origin (`mostra-kit.assets`). */
interface KitAsset {
  /** The package whose files they are (`@excalidraw/excalidraw`). */
  readonly package: string;
  /** Their directory in the package (`dist/prod/fonts`). */
  readonly from: string;
  /** Where the page finds them, under `/kit-assets/` (`excalidraw/fonts`). */
  readonly to: string;
  /** Directories under `from` left out. */
  readonly skip?: readonly string[];
}

/** The files of one asset set, by their path under it. */
function assetFiles(dir: string, skip: ReadonlySet<string>, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skip.has(path)) files.push(...assetFiles(join(dir, entry.name), skip, path));
    } else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

/**
 * The files a kit peer fetches at run time from the page's own origin (WP-19): Excalidraw's fonts,
 * say, which it loads by URL rather than through the bundler. The kit names them in its
 * `package.json` (`mostra-kit.assets`); a build whose graph includes that package carries them at
 * `/kit-assets/<to>/`, byte for byte, so the version's output digest covers them and the page
 * needs no CDN; `mostra dev` serves them from the package. A build that doesn't use the package
 * carries nothing.
 */
export function kitAssetsPlugin(buildRoot: string): Plugin {
  let sets: { readonly asset: KitAsset; readonly root: string; readonly dir: string }[] | undefined;
  const load = (): NonNullable<typeof sets> => {
    if (sets !== undefined) return sets;
    sets = [];
    const link = join(buildRoot, "node_modules", "@mostra", "kit");
    if (!existsSync(link)) return sets;
    let declared: readonly KitAsset[] = [];
    try {
      const manifest = JSON.parse(
        readFileSync(join(realpathSync(link), "package.json"), "utf8"),
      ) as {
        readonly "mostra-kit"?: { readonly assets?: readonly KitAsset[] };
      };
      declared = manifest["mostra-kit"]?.assets ?? [];
    } catch {
      declared = [];
    }
    for (const asset of declared) {
      const packageDir = join(buildRoot, "node_modules", asset.package);
      if (!existsSync(packageDir)) continue;
      const root = realpathSync(packageDir);
      const dir = join(root, asset.from);
      if (existsSync(dir)) sets.push({ asset, root, dir });
    }
    return sets;
  };
  return {
    name: "mostra:kit-assets",
    generateBundle() {
      const ids = [...this.getModuleIds()].map((id) => id.split("?")[0] ?? id);
      for (const { asset, root, dir } of load()) {
        if (!ids.some((id) => isAbsolute(id) && isUnder(id, root))) continue;
        for (const file of assetFiles(dir, new Set(asset.skip ?? []))) {
          this.emitFile({
            type: "asset",
            fileName: `kit-assets/${asset.to}/${file}`,
            source: readFileSync(join(dir, file)),
          });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let path: string;
        try {
          path = decodeURIComponent((request.url ?? "").split("?")[0] ?? "");
        } catch {
          return next();
        }
        if (!path.startsWith("/kit-assets/")) return next();
        for (const { asset, dir } of load()) {
          const prefix = `/kit-assets/${asset.to}/`;
          if (!path.startsWith(prefix)) continue;
          const file = join(dir, path.slice(prefix.length));
          // Only a file inside the asset's directory, as its real path says (no link out of it).
          if (!isUnder(file, dir) || !existsSync(file)) break;
          const real = realpathSync(file);
          if (!isUnder(real, realpathSync(dir)) || !statSync(real).isFile()) break;
          response.setHeader(
            "content-type",
            real.endsWith(".woff2") ? "font/woff2" : "application/octet-stream",
          );
          response.end(readFileSync(real));
          return;
        }
        next();
      });
    },
  };
}

/**
 * The artifact-relative path an import names under `@/…`: written so (`@/components/ui/button`),
 * as a kit module (`@mostra/kit/questionnaire`), or as the `@/` alias rewrote it, an absolute path
 * in the artifact's root (the alias is there for stylesheets, whose `@import` and `url()` Vite
 * resolves without plugins). `undefined` for any other import.
 */
export function kitRest(sourceDir: string, path: string): string | undefined {
  const module = kitModulePath(path);
  if (module !== undefined) return module;
  if (path.startsWith("@/")) return path.slice(2);
  if (isAbsolute(path) && isUnder(path, sourceDir) && pathKey(path) !== pathKey(sourceDir)) {
    return relative(sourceDir, path).split("\\").join("/");
  }
  return undefined;
}

/** A path for a CSS `@import` from the generated directory. */
const importPath = (from: string, to: string): string => {
  const path = relative(from, to).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
};

/**
 * The stylesheet every client entry imports: Tailwind over the artifact's source and the kit's
 * registry for its base, then, unless the stack is `"none"`, the kit's CSS, the theme the stack
 * makes and the artifact's own layers in their order, all in the one Tailwind run, so a layer's
 * `@theme` and `@apply` work (D181 item 2). The theme's file is written beside it.
 */
export function entryStylesheet(
  generatedDir: string,
  sourceDir: string,
  kit: KitBuild,
  /**
   * `used` for a build: the classes of the kit files the page uses. `all` for `mostra dev`, whose
   * source changes under it: the whole registry's, so a part imported later is styled at once.
   */
  scan: "used" | "all" = "used",
): string {
  const lines = [
    `@import "tailwindcss" source(${JSON.stringify(importPath(generatedDir, sourceDir))});`,
  ];
  if (kit.registry !== undefined) {
    // The kit's parts are read in place, so the classes of those the page uses are scanned there.
    const files = scan === "all" ? [kit.registry] : kitFilesUsed(sourceDir, kit.registry);
    for (const file of files) {
      lines.push(`@source ${JSON.stringify(importPath(generatedDir, file))};`);
    }
  }
  if (kit.themeId !== undefined) {
    lines.push('@import "@mostra/kit/css/kit.css";', '@import "./theme.css";');
    for (const file of kit.themeFiles) {
      lines.push(`@import ${JSON.stringify(importPath(generatedDir, join(sourceDir, file)))};`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The attributes the page's `<html>` carries for its theme (D181 items 2 and 5). */
export function themeAttributes(kit: KitBuild): string {
  const attributes: string[] = [];
  if (kit.themeId !== undefined) attributes.push(`data-theme="${kit.themeId}"`);
  if (kit.host !== undefined) attributes.push(`data-host-look="${kit.host}"`);
  return attributes.map((attribute) => ` ${attribute}`).join("");
}

/**
 * The table of which host variables each token reads (`HOST_TOKENS`), as data in the page, when
 * the stack names `"host"` (D181 item 5): the client runtime maps a host's look onto the tokens
 * with it, in the shell as inline in an MCP Apps host. JSON's own escape for `<`, so nothing in it
 * can end the element.
 */
export function hostTokensElement(kit: KitBuild): string {
  if (kit.host === undefined) return "";
  const table = JSON.stringify(HOST_TOKENS).replaceAll("<", "\\u003c");
  return `\n    <script type="application/json" id="mostra-host-tokens">${table}</script>`;
}
