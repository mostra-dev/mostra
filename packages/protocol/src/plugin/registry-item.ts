/**
 * Source packs (D30, ROUND-3 §6.3, EX-03): copy-source items in a superset of the shadcn registry
 * format. An item is a shadcn `registry-item.json` (verified against shadcn 4.23.0, VERIFIED_FACTS
 * WP-16) with an optional `mostra` block, so any shadcn item installs in Mostra unchanged, and a
 * Mostra pack installs through shadcn too: shadcn's own schema drops the `mostra` key it doesn't
 * know. Every object here is open, so an item a later shadcn release writes still reads.
 */
import * as z from "zod";
import { LicenseClass } from "../plugins.ts";
import { pluginManifestRegistry } from "./manifest.ts";

/** One file of an item. */
export interface RegistryFile {
  /** Its path in the registry (where `content` came from, or where to read it). */
  readonly path: string;
  /** Its text; a GitHub registry's item and a local item may leave it to `path`. */
  readonly content?: string;
  /** `registry:ui`, `registry:lib`, `registry:hook`, `registry:component`, `registry:page`, `registry:file` … */
  readonly type: string;
  /** Where it goes in the project; required for `registry:page` and `registry:file`. */
  readonly target?: string;
}

/** CSS variables an item adds, by where they go. */
export interface RegistryCssVars {
  /** Into Tailwind 4's `@theme`. */
  readonly theme?: Readonly<Record<string, string>>;
  /** Variables for the light theme. */
  readonly light?: Readonly<Record<string, string>>;
  /** Variables for the dark theme. */
  readonly dark?: Readonly<Record<string, string>>;
}

/** A CSS value: a declaration's value, or a nested block (selectors, at-rules). */
export type RegistryCssValue =
  | string
  | readonly (string | Readonly<Record<string, string>>)[]
  | { readonly [key: string]: RegistryCssValue };

/** A font a `registry:font` item installs. */
export interface RegistryFont {
  /** The font family. */
  readonly family: string;
  /** Where the font comes from: `google` for Google Fonts. */
  readonly provider: string;
  /** The name its provider's import takes: `Inter`. */
  readonly import: string;
  /** The CSS variable that names it: `--font-sans`. */
  readonly variable: string;
  /** The weights it installs. */
  readonly weight?: readonly string[];
  /** The character subsets it installs. */
  readonly subsets?: readonly string[];
  /** The CSS selector it applies to; `html` when absent. */
  readonly selector?: string;
  /** The npm package that carries it outside Next.js: `@fontsource-variable/inter`. */
  readonly dependency?: string;
}

/** The `mostra` block a Mostra pack adds to its item (ROUND-3 §6.3). */
export interface PackMostraBlock {
  /** The kit base its components are written for (D27): `base` (Base UI) or `radix`. */
  readonly base?: "base" | "radix";
  /** The same item for the other base, by base: an address `mostra add` takes instead. */
  readonly variants?: Readonly<Partial<Record<"base" | "radix", string>>>;
  /** The field IDs its components introduce (D52), shown at install. */
  readonly fields?: readonly string[];
  /** Its verify baselines, a path in its registry. */
  readonly baselines?: string;
  /** The pack's own license, an SPDX expression; shadcn items carry none. */
  readonly license?: string;
  /** For a `LicenseRef-` license: `source-available` or `proprietary`. */
  readonly licenseClass?: LicenseClass;
}

/** A registry item: shadcn's `registry-item.json`, plus `mostra`. */
export interface RegistryItem {
  /** The JSON Schema it follows. */
  readonly $schema?: string;
  /** Its name, unique in its registry. */
  readonly name: string;
  /** Its shadcn item type: `registry:ui`, `registry:block`, `registry:lib`, `registry:file` and the rest. */
  readonly type: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** Who wrote it. */
  readonly author?: string;
  /** npm packages it needs: `name` or `name@version`. */
  readonly dependencies?: readonly string[];
  /** npm packages it needs while developing. */
  readonly devDependencies?: readonly string[];
  /** Other items it needs, by address. */
  readonly registryDependencies?: readonly string[];
  /** Its files. */
  readonly files?: readonly RegistryFile[];
  /** Tailwind 3's configuration; Tailwind 4 projects use `cssVars.theme`. */
  readonly tailwind?: Readonly<Record<string, unknown>>;
  /** CSS variables it adds: to `@theme`, and for the light and dark themes. */
  readonly cssVars?: RegistryCssVars;
  /** CSS rules it adds, by selector or at-rule. */
  readonly css?: { readonly [key: string]: RegistryCssValue };
  /** Example environment variables; Mostra's server code reads secrets instead (D44). */
  readonly envVars?: Readonly<Record<string, string>>;
  /** Anything else the item's author records. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** A note shown after it installs. */
  readonly docs?: string;
  /** Categories for listings. */
  readonly categories?: readonly string[];
  /** The item it builds on (`none` for a base that starts afresh). */
  readonly extends?: string;
  /** The font a `registry:font` item installs. */
  readonly font?: RegistryFont;
  /** What a Mostra pack adds: its base, variants, fields, baselines and license. */
  readonly mostra?: PackMostraBlock;
}

const RegistryFileSchema: z.ZodType<RegistryFile> = z
  .looseObject({
    path: z.string().min(1),
    content: z.string().exactOptional(),
    type: z.string().min(1),
    target: z.string().exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "RegistryFile" });

const stringRecord = z.record(z.string(), z.string());

const RegistryCssValueSchema: z.ZodType<RegistryCssValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.array(z.union([z.string(), stringRecord])).readonly(),
    z.record(z.string(), RegistryCssValueSchema),
  ]),
);

const PackMostraBlockSchema: z.ZodType<PackMostraBlock> = z
  .looseObject({
    base: z.enum(["base", "radix"]).exactOptional(),
    variants: z.partialRecord(z.enum(["base", "radix"]), z.string().min(1)).exactOptional(),
    fields: z.array(z.string().min(1)).readonly().exactOptional(),
    baselines: z.string().min(1).exactOptional(),
    license: z.string().min(1).max(512).exactOptional(),
    licenseClass: LicenseClass.exactOptional(),
  })
  .register(pluginManifestRegistry, {
    id: "PackMostraBlock",
    description:
      "What a Mostra pack adds to a shadcn registry item: its base, variants, fields, baselines and license.",
  });

/** The Zod schema of the `RegistryItem` type: shadcn's item, open, with the `mostra` block. */
export const RegistryItemSchema: z.ZodType<RegistryItem> = z
  .looseObject({
    $schema: z.string().exactOptional(),
    name: z.string().min(1),
    type: z.string().min(1),
    title: z.string().exactOptional(),
    description: z.string().exactOptional(),
    author: z.string().exactOptional(),
    dependencies: z.array(z.string().min(1)).readonly().exactOptional(),
    devDependencies: z.array(z.string().min(1)).readonly().exactOptional(),
    registryDependencies: z.array(z.string().min(1)).readonly().exactOptional(),
    files: z.array(RegistryFileSchema).readonly().exactOptional(),
    tailwind: z.record(z.string(), z.unknown()).exactOptional(),
    cssVars: z
      .looseObject({
        theme: stringRecord.exactOptional(),
        light: stringRecord.exactOptional(),
        dark: stringRecord.exactOptional(),
      })
      .exactOptional(),
    css: z.record(z.string(), RegistryCssValueSchema).exactOptional(),
    envVars: stringRecord.exactOptional(),
    meta: z.record(z.string(), z.unknown()).exactOptional(),
    docs: z.string().exactOptional(),
    categories: z.array(z.string()).readonly().exactOptional(),
    extends: z.string().exactOptional(),
    font: z
      .looseObject({
        family: z.string(),
        provider: z.string(),
        import: z.string(),
        variable: z.string(),
        weight: z.array(z.string()).readonly().exactOptional(),
        subsets: z.array(z.string()).readonly().exactOptional(),
        selector: z.string().exactOptional(),
        dependency: z.string().exactOptional(),
      })
      .exactOptional(),
    mostra: PackMostraBlockSchema.exactOptional(),
  })
  .register(pluginManifestRegistry, {
    id: "RegistryItem",
    description:
      "A source pack item (D30): shadcn's registry-item.json, which installs unchanged, plus an optional mostra block.",
  });

/** A registry (`registry.json`): its items, or files that hold them (`include`). */
export interface Registry {
  /** Its name, unique in its registry. */
  readonly name?: string;
  /** Where people read about it. */
  readonly homepage?: string;
  /** Other `registry.json` files whose items it includes. */
  readonly include?: readonly string[];
  /** Its items. */
  readonly items?: readonly RegistryItem[];
}

/** The Zod schema of the `Registry` type. */
export const RegistrySchema: z.ZodType<Registry> = z
  .looseObject({
    name: z.string().exactOptional(),
    homepage: z.string().exactOptional(),
    include: z.array(z.string().min(1)).readonly().exactOptional(),
    items: z.array(RegistryItemSchema).readonly().exactOptional(),
  })
  .register(pluginManifestRegistry, { id: "Registry" });

/**
 * Where an item comes from, as `mostra add` reads an address (shadcn's forms, D30):
 * - `url`: an `https:` (or loopback `http:`) URL of an item's JSON;
 * - `file`: a local item, a path ending in `.json` (or starting with `./`, `../`, `/`);
 * - `github`: `owner/repo/item[#ref]`, read from the repository's root `registry.json`;
 * - `namespace`: `@namespace/item`, through the artifact's `components.json` `registries`;
 * - `name`: a bare name, from the default registry (shadcn's own);
 * - `plugin`: `plugin:<package>/<item>`, a pack an installed plugin carries (`contributes.packs`,
 *   by the item's `name`), Mostra's own form.
 */
export type PackAddress =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "github";
      readonly owner: string;
      readonly repo: string;
      readonly item: string;
      readonly ref?: string;
    }
  | { readonly kind: "namespace"; readonly namespace: string; readonly item: string }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "plugin"; readonly package: string; readonly item: string };

const GITHUB_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/**
 * Reads an item address, or answers `undefined` for text that is none of shadcn's forms (an npm
 * package spec, for `mostra add` to install as a package).
 */
export function parsePackAddress(text: string): PackAddress | undefined {
  const plugin = /^plugin:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)\/([^\s/#]+)$/.exec(
    text,
  );
  if (plugin) return { kind: "plugin", package: plugin[1] as string, item: plugin[2] as string };
  if (/^https?:\/\//i.test(text)) return { kind: "url", url: text };
  if (/^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(text) || /\.json$/i.test(text)) {
    return { kind: "file", path: text };
  }
  const namespaced = /^(@[a-z0-9][a-z0-9-_.]*)\/([^\s#]+)$/i.exec(text);
  if (namespaced)
    return { kind: "namespace", namespace: namespaced[1] as string, item: namespaced[2] as string };
  const [address, ref] = text.split("#", 2) as [string, string | undefined];
  const parts = address.split("/");
  if (
    parts.length >= 3 &&
    GITHUB_PART.test(parts[0] as string) &&
    GITHUB_PART.test(parts[1] as string) &&
    parts.slice(2).every((part) => /^[A-Za-z0-9._-]+$/.test(part))
  ) {
    return {
      kind: "github",
      owner: parts[0] as string,
      repo: parts[1] as string,
      item: parts.slice(2).join("/"),
      ...(ref !== undefined && ref !== "" ? { ref } : {}),
    };
  }
  return undefined;
}
