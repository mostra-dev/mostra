/**
 * Which of the kit's files an artifact uses (ROUND-3 §1.1, D181): `@/…` and `@mostra/kit/<module>`
 * resolve to the artifact's own file first and the kit's registry for its base next, and a kit file
 * names others the same way. The build scans the classes of exactly those files, and the dependency
 * module installs the on-demand libraries they import (WP-19): one walk, plain files, no bundler.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { isUnder } from "../platform/index.ts";

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

/** The npm package a bare import names (`maplibre-gl`, `@deck.gl/core`), or `undefined`. */
export function packageOfSpecifier(specifier: string): string | undefined {
  if (/^(?:\.|\/|@\/|node:|\0)/.test(specifier)) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}

/**
 * The kit's on-demand libraries (D65, WP-19): the optional peers its `package.json` pins exactly,
 * which a kit module imports and an artifact that uses the module gets installed, at that version,
 * as if it had imported them itself.
 */
/**
 * The overrides the kit names for an installation of its on-demand libraries (`mostra-kit.overrides`
 * in its `package.json`, pnpm's `overrides`): a dependency of one of them with a known advisory,
 * taken at its fixed release, as the workspace that checks the kit takes it (WP-19).
 */
export function kitOverrides(kitDir: string): Readonly<Record<string, string>> {
  try {
    const manifest = JSON.parse(readFileSync(join(kitDir, "package.json"), "utf8")) as {
      "mostra-kit"?: { overrides?: Record<string, string> };
    };
    return Object.fromEntries(Object.entries(manifest["mostra-kit"]?.overrides ?? {}).sort());
  } catch {
    return {};
  }
}

export function kitPeers(kitDir: string): ReadonlyMap<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(join(kitDir, "package.json"), "utf8")) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      "mostra-kit"?: { pins?: Record<string, string> };
    };
    const peers = new Map<string, string>();
    for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[name]?.optional === true) peers.set(name, version);
    }
    // Libraries no kit module imports, which a page adds beside one (deck.gl's other layer
    // packages): pinned so they match what the module's libraries need, never installed with the
    // kit.
    for (const [name, version] of Object.entries(manifest["mostra-kit"]?.pins ?? {})) {
      if (!peers.has(name)) peers.set(name, version);
    }
    return peers;
  } catch {
    return new Map();
  }
}
