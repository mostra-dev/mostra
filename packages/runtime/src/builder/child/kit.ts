/**
 * What a build takes of the kit (ROUND-3 §1.1, D179): `@/…` resolving to the artifact's own copy
 * first and the kit's registry for its base next, and the stylesheet the client entry imports,
 * which puts the theme stack inside the build's one Tailwind run.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { HOST_TOKENS } from "@mostra/themes";
import type { Plugin } from "vite";
import { isUnder } from "../../platform/index.ts";
import type { KitBuild } from "../types.ts";

/** The extensions `@/…` tries, in the order Vite tries them for a relative import. */
const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".mts", ".json"];

/** The file `@/<rest>` names inside `root`, as a bundler finds it, or `undefined`. */
export function findUnder(root: string, rest: string): string | undefined {
  const base = join(root, rest);
  if (!isUnder(base, root)) return undefined;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const extension of EXTENSIONS.slice(1)) {
    const candidate = join(base, `index${extension}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/**
 * The kit module a specifier names (`@mostra/kit/questionnaire`), as the path its file has in an
 * artifact and in the kit's registry (`components/mostra/questionnaire`), or `undefined`.
 */
export function kitModulePath(source: string): string | undefined {
  const match = /^@mostra\/kit\/([a-z][a-z0-9-]*)$/.exec(source.split("?")[0] ?? "");
  return match ? `components/mostra/${match[1] as string}` : undefined;
}

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
      const module = kitModulePath(source);
      if (!source.startsWith("@/") && module === undefined) return null;
      const rest = module ?? source.slice(2).split("?")[0] ?? "";
      const own = findUnder(sourceDir, rest);
      if (own !== undefined) return own;
      if (kit.registry !== undefined) {
        const kitFile = findUnder(kit.registry, rest);
        if (kitFile !== undefined) return kitFile;
      }
      return null;
    },
  };
}

/** A path for a CSS `@import` from the generated directory. */
const importPath = (from: string, to: string): string => {
  const path = relative(from, to).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
};

/** The files whose imports can name `@/…`. */
const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".mdx"]);
/** `@/…` or a kit module (`@mostra/kit/<name>`) in an import or export, static or dynamic. */
const KIT_IMPORT = /(?:from|import)\s*\(?\s*["'](@\/[^"'\s]+|@mostra\/kit\/[a-z][a-z0-9-]*)["']/g;

function codeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...codeFiles(path));
    else if (CODE.has(extname(entry.name))) found.push(path);
  }
  return found;
}

/**
 * The kit's files a page uses: every `@/…` the artifact's code names that the artifact has no
 * copy of, and in turn the kit files those name. Only their classes are generated, so a page
 * carries the CSS of the parts it uses, never the whole registry's.
 */
export function kitFilesUsed(sourceDir: string, registry: string): string[] {
  const used = new Set<string>();
  const visit = (file: string): void => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    for (const match of text.matchAll(KIT_IMPORT)) {
      const specifier = match[1] as string;
      const rest = kitModulePath(specifier) ?? specifier.slice(2);
      if (findUnder(sourceDir, rest) !== undefined) continue;
      const kitFile = findUnder(registry, rest);
      if (kitFile === undefined || used.has(kitFile)) continue;
      used.add(kitFile);
      visit(kitFile);
    }
  };
  for (const file of codeFiles(sourceDir)) visit(file);
  return [...used].sort();
}

/**
 * The stylesheet every client entry imports: Tailwind over the artifact's source and the kit's
 * registry for its base, then, unless the stack is `"none"`, the kit's CSS, the theme the stack
 * makes and the artifact's own layers in their order, all in the one Tailwind run, so a layer's
 * `@theme` and `@apply` work (D179 item 2). The theme's file is written beside it.
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
    lines.push('@import "@mostra/kit/kit.css";', '@import "./theme.css";');
    for (const file of kit.themeFiles) {
      lines.push(`@import ${JSON.stringify(importPath(generatedDir, join(sourceDir, file)))};`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The attributes the page's `<html>` carries for its theme (D179 items 2 and 5). */
export function themeAttributes(kit: KitBuild): string {
  const attributes: string[] = [];
  if (kit.themeId !== undefined) attributes.push(`data-theme="${kit.themeId}"`);
  if (kit.host !== undefined) attributes.push(`data-host-look="${kit.host}"`);
  return attributes.map((attribute) => ` ${attribute}`).join("");
}

/**
 * The table of which host variables each token reads (`HOST_TOKENS`), as data in the page, when
 * the stack names `"host"` (D179 item 5): the client runtime maps a host's look onto the tokens
 * with it, in the shell as inline in an MCP Apps host. JSON's own escape for `<`, so nothing in it
 * can end the element.
 */
export function hostTokensElement(kit: KitBuild): string {
  if (kit.host === undefined) return "";
  const table = JSON.stringify(HOST_TOKENS).replaceAll("<", "\\u003c");
  return `\n    <script type="application/json" id="mostra-host-tokens">${table}</script>`;
}
