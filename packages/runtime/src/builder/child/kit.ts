/**
 * What a build takes of the kit (ROUND-3 §1.1, D181): `@/…` resolving to the artifact's own copy
 * first and the kit's registry for its base next, and the stylesheet the client entry imports,
 * which puts the theme stack inside the build's one Tailwind run.
 */
import { existsSync, realpathSync } from "node:fs";
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
export function kitPeersPlugin(buildRoot: string): Plugin {
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
      // As if the artifact's own root imported it: from the layout its lockfile installed.
      return this.resolve(source, join(buildRoot, "index.html"), { ...options, skipSelf: true });
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
