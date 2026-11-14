/**
 * Source packs (D30, ROUND-3 §6.3, EX-03): `pack/add`, which `mostra add` calls. It copies shadcn
 * registry items (with or without a `mostra` block) into an artifact's source, as shadcn's own
 * `add` would into a project, so any shadcn item installs unchanged:
 *
 * 1. every item is read with its registry dependencies (`read.ts`), before anything is written;
 * 2. each file's place is found as shadcn finds it (`target`, `~/`, the `@components/`, `@ui/`,
 *    `@lib/` and `@hooks/` aliases, else the directory of its type), checked against the artifact
 *    (`checkArtifactPath`, no link out of it, no name differing from another only in case), and
 *    `@/registry/<style>/…` imports point at the aliases;
 * 3. CSS (`cssVars`, `css`) joins one stylesheet in a block per item, replaced when the item is
 *    added again: `components.json`'s `tailwind.css`, else a stylesheet the entry imports, else a
 *    new `styles.css`;
 * 4. npm packages (the items' `dependencies` and any plain specs) are added as `deps/add` adds
 *    them, and the licenses the items' packages bring are disclosed and acknowledged as a
 *    plugin's are (D31), all in one change of the working lockfile;
 * 5. only then are the files written, each through a temporary file renamed into place, and
 *    every one restored when any fails.
 *
 * What an artifact has no place for (`envVars`, Tailwind 3's `tailwind.config`, `next/font`, a
 * design system's `registry:base`) is listed as notes, never applied half-way.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, sep } from "node:path";
import {
  checkArtifactPath,
  createDiagnostic,
  type Diagnostic,
  type LicenseDisclosure,
  type PackAddResult,
  type PackFileChange,
  type PackItemSummary,
  RpcError,
} from "@mostra/protocol";
import {
  parsePackAddress,
  type RegistryCssValue,
  type RegistryItem,
} from "@mostra/protocol/plugin";
import type { Dependencies, DependencyTarget } from "../deps/index.ts";
import { isOffline } from "../deps/index.ts";
import type { RequestKey } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import type { Plugins } from "../plugins/index.ts";
import { type ReadItem, readComponentsJson, readItems } from "./read.ts";

export { type ComponentsJson, readComponentsJson, readItems } from "./read.ts";

/** Options for {@link createPacks}. */
export interface PacksOptions {
  readonly dependencies: Dependencies;
  readonly plugins: Plugins;
  readonly log: Log;
  readonly env: Environment;
  /** GitHub's API and raw-file origins, for tests' local fakes (`MOSTRA_TEST_GITHUB_*`). */
  readonly github?: { readonly api: string; readonly raw: string };
}

/** The packs of one instance. */
export interface Packs {
  /** `pack/add`, for an artifact the publisher resolved and holds the queue of. */
  add(input: {
    readonly target: DependencyTarget;
    /** The artifact's directory, and whether it is a directory artifact (a single file takes none). */
    readonly root: string;
    readonly kind: "file" | "dir";
    /** The entry, relative to `root`. */
    readonly entry: string;
    readonly specs: readonly string[];
    readonly overwrite: boolean;
    readonly accept: readonly string[];
    readonly request?: RequestKey | undefined;
    /** Where relative item files are read from (the caller's working directory). */
    readonly cwd: string;
  }): Promise<PackAddResult>;
}

/** The default aliases, as `npx shadcn init` writes them, with `@/` the artifact's root. */
const DEFAULT_ALIASES = {
  components: "components",
  ui: "components/ui",
  lib: "lib",
  hooks: "hooks",
  utils: "lib/utils",
} as const;

/** Names a pack never writes: the artifact's packages and Mostra's own state. */
const RESERVED = new Set(["node_modules", ".mostra", ".git"]);

const fail = (code: Parameters<typeof createDiagnostic>[0], message: string): RpcError =>
  new RpcError(createDiagnostic(code, { message }));

/** One file a pack writes. */
interface PlannedFile {
  /** `/`-separated, inside the artifact. */
  readonly path: string;
  readonly content: string;
  readonly item: string;
}

/** An alias of `components.json` as a path inside the artifact (`@/components/ui` → `components/ui`). */
function aliasPath(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return value.replace(/^@\//, "").replace(/^~\//, "").replace(/\/+$/, "") || fallback;
}

/** Where a file of an item goes, as shadcn's `resolveFilePath` places it (shadcn 4.23.0). */
export function placeFile(
  file: { readonly path: string; readonly type: string; readonly target?: string },
  aliases: {
    readonly components: string;
    readonly ui: string;
    readonly lib: string;
    readonly hooks: string;
  },
  /** The artifact has `pages/` (D57): a page goes there; without it a page has no place. */
  pages = true,
): string | undefined {
  const target = file.target;
  if (target !== undefined) {
    if (target.startsWith("~/")) return target.slice(2);
    const alias = /^@(components|ui|lib|hooks)\/(.+)$/.exec(target);
    if (alias) {
      const root = aliases[alias[1] as keyof typeof aliases];
      const placed = posix.normalize(posix.join(root, alias[2] as string));
      if (placed !== root && !placed.startsWith(`${root}/`)) {
        throw fail(
          "MOSTRA_PACK_TARGET_INVALID",
          `The target ${target} leaves the ${alias[1]} alias's directory.`,
        );
      }
      return placed;
    }
    // Any other `@name/…` is a plain path, as shadcn reads it.
    const plain = target.replace(/^@([^/]+)\//, "$1/").replace(/^src\//, "");
    if (file.type === "registry:page") {
      // Next.js's `app/<route>/page.tsx` is Mostra's `pages/<route>.tsx` (D57), as shadcn maps it
      // for the pages router; an artifact without `pages/` has no routes, so, as shadcn does for
      // a framework without them, the page isn't written.
      if (!pages) return undefined;
      return plain.replace(/^app\//, "pages/").replace(/\/page(\.[jt]sx?)$/, "$1");
    }
    return plain;
  }
  const dir =
    file.type === "registry:ui"
      ? aliases.ui
      : file.type === "registry:lib"
        ? aliases.lib
        : file.type === "registry:hook"
          ? aliases.hooks
          : aliases.components;
  // The part of the item's path after the segment that names the directory (`ui` of
  // `registry/new-york/ui/button.tsx`), else its file name.
  const segments = file.path.replace(/^\/|\/$/g, "").split("/");
  const last = dir.split("/").at(-1);
  const at = segments.indexOf(last ?? "");
  const rest = at === -1 ? (segments.at(-1) as string) : segments.slice(at + 1).join("/");
  return posix.join(dir, rest);
}

/** Points `@/registry/<style>/<kind>/…` imports at the artifact's aliases, as shadcn rewrites them. */
export function rewriteImports(
  content: string,
  aliases: {
    readonly components: string;
    readonly ui: string;
    readonly lib: string;
    readonly hooks: string;
  },
  placed: ReadonlyMap<string, string> = new Map(),
): string {
  const exact = content.replace(
    /(["'])@\/(registry\/[^"']+)(["'])/g,
    (whole, open: string, path: string, close: string) => {
      const target = placed.get(path.replace(/\.[jt]sx?$/, ""));
      return target === undefined ? whole : `${open}@/${target.replace(/\.[jt]sx?$/, "")}${close}`;
    },
  );
  return exact.replace(
    /(["'])@\/registry\/[^/"']+\/(ui|lib|hooks|components|blocks|examples)\//g,
    (_, quote: string, kind: string) => {
      const root =
        kind === "ui"
          ? aliases.ui
          : kind === "lib"
            ? aliases.lib
            : kind === "hooks"
              ? aliases.hooks
              : aliases.components;
      return `${quote}@/${root}/`;
    },
  );
}

/** Serializes an item's `css` the way shadcn writes it into a stylesheet. */
export function cssText(css: { readonly [key: string]: RegistryCssValue }, indent = ""): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(css)) {
    if (typeof value === "string") {
      lines.push(`${indent}${key}: ${value};`);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") lines.push(`${indent}${key}: ${entry};`);
        else {
          lines.push(`${indent}${key} {`);
          lines.push(cssText(entry as Record<string, RegistryCssValue>, `${indent}  `));
          lines.push(`${indent}}`);
        }
      }
    } else if (Object.keys(value as object).length === 0 && key.startsWith("@")) {
      // An at-rule without a block: `@plugin "x"`, `@import "y"`.
      lines.push(`${indent}${key};`);
    } else {
      lines.push(`${indent}${key} {`);
      lines.push(cssText(value as Record<string, RegistryCssValue>, `${indent}  `));
      lines.push(`${indent}}`);
    }
  }
  return lines.filter((line) => line !== "").join("\n");
}

/** The CSS an item adds: its variables and its rules. */
export function itemCss(item: RegistryItem): string | undefined {
  const parts: string[] = [];
  const vars = (selector: string, record: Readonly<Record<string, string>> | undefined) => {
    const entries = Object.entries(record ?? {});
    if (entries.length === 0) return;
    parts.push(
      `${selector} {\n${entries.map(([name, value]) => `  --${name.replace(/^--/, "")}: ${value};`).join("\n")}\n}`,
    );
  };
  vars("@theme inline", item.cssVars?.theme);
  vars(":root", item.cssVars?.light);
  vars(".dark", item.cssVars?.dark);
  if (item.css !== undefined && Object.keys(item.css).length > 0) parts.push(cssText(item.css));
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** `css` with the block of `item` set to `block` (added at the end the first time). */
export function withCssBlock(css: string, item: string, block: string): string {
  const begin = `/* mostra add ${item}: begin */`;
  const end = `/* mostra add ${item}: end */`;
  const text = `${begin}\n${block}\n${end}`;
  const start = css.indexOf(begin);
  const stop = css.indexOf(end);
  if (start !== -1 && stop > start)
    return `${css.slice(0, start)}${text}${css.slice(stop + end.length)}`;
  return `${css.replace(/\s*$/, "")}${css.trim() === "" ? "" : "\n\n"}${text}\n`;
}

/** The stylesheets an entry imports, relative to the root (`import "./styles.css"`). */
function importedStylesheets(entryText: string, entry: string): string[] {
  const found: string[] = [];
  for (const match of entryText.matchAll(/import\s+(?:[^"';]+\s+from\s+)?["']([^"']+\.css)["']/g)) {
    const specifier = match[1] as string;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      found.push(posix.normalize(posix.join(posix.dirname(entry), specifier)));
    } else if (specifier.startsWith("@/")) found.push(specifier.slice(2));
  }
  return found;
}

/** Creates the packs of one instance. */
export function createPacks(options: PacksOptions): Packs {
  const { dependencies, plugins, log } = options;
  return {
    async add(input) {
      if (input.kind === "file") {
        throw fail(
          "MOSTRA_PACK_TARGET_INVALID",
          `${input.target.artifactPath} is a single-file artifact, which holds no other files: move it into a directory (as index.tsx) to add items to it.`,
        );
      }
      const components = await readComponentsJson(input.root);
      // `@scope/name` is an item only where the artifact's components.json registers `@scope`, as
      // shadcn reads it; anywhere else it is the scoped npm package it looks like.
      const isItem = (spec: string): boolean => {
        const address = parsePackAddress(spec);
        if (address === undefined) return false;
        if (address.kind !== "namespace") return true;
        return components?.registries?.[address.namespace] !== undefined;
      };
      const itemSpecs = input.specs.filter(isItem);
      const plainSpecs = input.specs.filter((spec) => !isItem(spec));
      const items: ReadItem[] =
        itemSpecs.length === 0
          ? []
          : await readItems(
              itemSpecs,
              {
                ...(components !== undefined ? { components } : {}),
                env: options.env,
                offline: isOffline(options.env),
                pluginItem: (pkg, name) => plugins.packItem(input.target, pkg, name),
                ...(options.github !== undefined ? { github: options.github } : {}),
              },
              input.cwd,
            );
      const aliases = {
        components: aliasPath(components?.aliases?.["components"], DEFAULT_ALIASES.components),
        ui: aliasPath(components?.aliases?.["ui"], DEFAULT_ALIASES.ui),
        lib: aliasPath(components?.aliases?.["lib"], DEFAULT_ALIASES.lib),
        hooks: aliasPath(components?.aliases?.["hooks"], DEFAULT_ALIASES.hooks),
      };
      const notes: Diagnostic[] = [];
      const note = (message: string) =>
        notes.push(createDiagnostic("MOSTRA_PACK_NOT_APPLIED", { message }));

      // 2. Every file's place, checked, and what it would do.
      const planned = new Map<string, PlannedFile>();
      const hasPages = existsSync(join(input.root, "pages"));
      const places: { read: ReadItem; index: number; path: string }[] = [];
      const placedByRegistryPath = new Map<string, string>();
      for (const read of items) {
        (read.item.files ?? []).forEach((file, index) => {
          const placed = placeFile(file, aliases, hasPages);
          if (placed === undefined) {
            note(
              `${read.item.name}'s page ${file.target ?? file.path} wasn't written: the artifact has no pages/ (D57). Add pages/ to make it multi-page, then add the item again.`,
            );
            return;
          }
          const check = checkArtifactPath(placed);
          if (!check.ok) {
            throw fail(
              "MOSTRA_PACK_TARGET_INVALID",
              check.reason === "outside"
                ? `${read.item.name}'s file ${file.path} would land at ${placed}, outside the artifact.`
                : `${read.item.name}'s file ${file.path} would land at ${placed}, whose name "${check.segment}" not every system can hold.`,
            );
          }
          const top = check.path.split("/")[0] as string;
          if (RESERVED.has(top)) {
            throw fail(
              "MOSTRA_PACK_TARGET_INVALID",
              `${read.item.name}'s file ${file.path} would land in ${top}/, which an artifact's source never holds.`,
            );
          }
          places.push({ read, index, path: check.path });
          placedByRegistryPath.set(
            file.path.replace(/^\//, "").replace(/\.[jt]sx?$/, ""),
            check.path,
          );
        });
      }
      for (const { read, index, path } of places) {
        const file = (read.item.files ?? [])[index] as { type: string };
        const content =
          file.type === "registry:file" || file.type === "registry:item"
            ? (read.contents[index] as string)
            : rewriteImports(read.contents[index] as string, aliases, placedByRegistryPath);
        const key = path.toLowerCase();
        const earlier = planned.get(key);
        if (earlier !== undefined && earlier.path !== path) {
          throw fail(
            "MOSTRA_PACK_TARGET_INVALID",
            `${earlier.path} and ${path} differ only in case, which not every system can hold apart.`,
          );
        }
        // A later item's file wins over an earlier one's, as shadcn writes them in order.
        planned.set(key, { path, content, item: read.item.name });
      }
      for (const read of items) {
        if (read.item.envVars !== undefined && Object.keys(read.item.envVars).length > 0) {
          note(
            `${read.item.name} asks for environment variables (${Object.keys(read.item.envVars).join(", ")}); an artifact's server code reads secrets instead: mostra secret set NAME --artifact <path>.`,
          );
        }
        if (read.item.tailwind !== undefined && Object.keys(read.item.tailwind).length > 0) {
          note(
            `${read.item.name} carries a Tailwind 3 configuration (tailwind.config), which Tailwind 4 doesn't read; move its theme into your stylesheet's @theme.`,
          );
        }
        if (read.item.font !== undefined) {
          note(
            `${read.item.name} installs the font ${read.item.font.family} through ${read.item.font.provider}; load it yourself (${read.item.font.dependency ?? "a @fontsource package"}) and set ${read.item.font.variable}.`,
          );
        }
        if (read.item.type === "registry:base" || read.item.type === "registry:style") {
          note(
            `${read.item.name} is a ${read.item.type}, a project configuration an artifact doesn't take; its CSS and files were added.`,
          );
        }
      }

      // 3. CSS: into one stylesheet.
      const cssBlocks = items
        .map((read) => ({ name: read.item.name, css: itemCss(read.item) }))
        .filter((entry): entry is { name: string; css: string } => entry.css !== undefined);
      let stylesheet: { path: string; before: string | undefined; after: string } | undefined;
      if (cssBlocks.length > 0) {
        const entryText = await readFile(join(input.root, input.entry), "utf8").catch(() => "");
        const imported = importedStylesheets(entryText, input.entry);
        const configured = components?.tailwind?.css;
        const path = configured
          ? aliasPath(configured, configured).replace(/^\.\//, "")
          : (imported[0] ?? "styles.css");
        const check = checkArtifactPath(path);
        if (!check.ok) {
          throw fail(
            "MOSTRA_PACK_TARGET_INVALID",
            `The stylesheet ${path} isn't a path inside the artifact.`,
          );
        }
        const before = await readFile(join(input.root, check.path), "utf8").catch(() => undefined);
        let after = before ?? '@import "tailwindcss";\n';
        for (const block of cssBlocks) after = withCssBlock(after, block.name, block.css);
        stylesheet = { path: check.path, before, after };
        if (!imported.includes(check.path)) {
          notes.push(
            createDiagnostic("MOSTRA_PACK_CSS_UNIMPORTED", {
              message: `The items' CSS is in ${check.path}, which ${input.entry} doesn't import yet: add import "./${check.path}"; to it.`,
            }),
          );
        }
      }

      // What each file does; nothing is written yet.
      const changes: (PackFileChange & { content: string })[] = [];
      const clashes: string[] = [];
      for (const file of planned.values()) {
        if (stylesheet !== undefined && file.path === stylesheet.path) {
          throw fail(
            "MOSTRA_PACK_TARGET_INVALID",
            `${file.item} writes ${file.path}, the stylesheet the items' CSS joins.`,
          );
        }
        await checkPlace(input.root, file.path);
        const existing = await readFile(join(input.root, file.path), "utf8").catch(() => undefined);
        if (existing === undefined)
          changes.push({ path: file.path, action: "created", content: file.content });
        else if (existing === file.content)
          changes.push({ path: file.path, action: "unchanged", content: file.content });
        else if (input.overwrite)
          changes.push({ path: file.path, action: "overwritten", content: file.content });
        else clashes.push(file.path);
      }
      if (clashes.length > 0) {
        throw new RpcError(
          createDiagnostic("MOSTRA_PACK_FILE_EXISTS", {
            message: `The artifact already has ${clashes.join(", ")}, with other content. Nothing was written.`,
            fix: {
              kind: "command",
              command: `mostra add ${input.specs.join(" ")} --artifact ${shellWord(input.target.artifactPath)} --overwrite`,
            },
          }),
        );
      }
      if (stylesheet !== undefined) {
        await checkPlace(input.root, stylesheet.path);
        if (stylesheet.before !== stylesheet.after) {
          changes.push({
            path: stylesheet.path,
            action: stylesheet.before === undefined ? "created" : "updated",
            content: stylesheet.after,
          });
        }
      }

      // 4. npm packages and licenses, then 5. the files, all or nothing.
      const itemPackages = [
        ...new Set(items.flatMap((read) => [...(read.item.dependencies ?? [])])),
      ];
      const packages = [...new Set([...itemPackages, ...plainSpecs])];
      const summaries: PackItemSummary[] = items.map((read) => ({
        name: read.item.name,
        type: read.item.type,
        address: read.address,
        source: read.source,
        ...(read.requiredBy !== undefined ? { requiredBy: read.requiredBy } : {}),
        ...(read.item.mostra?.fields !== undefined ? { fields: [...read.item.mostra.fields] } : {}),
      }));
      const devDependencies = [
        ...new Set(items.flatMap((read) => [...(read.item.devDependencies ?? [])])),
      ];
      if (devDependencies.length > 0) {
        note(
          `The items name development packages (${devDependencies.join(", ")}), which an artifact's build doesn't use; add any the page imports with mostra add.`,
        );
      }
      const files = changes.map(({ path, action }) => ({ path, action }));
      if (packages.length === 0) {
        await writeAll(input.root, changes);
        log.info("packs.added", { items: summaries.map((item) => item.name), files: files.length });
        return { items: summaries, files, packages: [], licenses: [], notes };
      }
      const names = itemPackages.map(packageName);
      return dependencies.change<PackAddResult>(
        { ...input.target, add: packages, request: input.request },
        async (staged) => {
          let disclosures: readonly LicenseDisclosure[] = [];
          let record = { ...(staged.previous?.licenses ?? {}) };
          if (names.length > 0) {
            const licenses = await plugins.disclosePackages({
              nodeModules: staged.nodeModules,
              packages: names,
              previous: staged.previous?.licenses,
              accept: input.accept,
              command: `mostra add ${input.specs.join(" ")} --artifact ${shellWord(input.target.artifactPath)}`,
            });
            disclosures = licenses.disclosures;
            record = { ...record, ...licenses.record };
          }
          await writeAll(input.root, changes);
          log.info("packs.added", {
            items: summaries.map((item) => item.name),
            files: files.length,
            packages: staged.added.map((pkg) => pkg.name),
          });
          return {
            plugins: staged.previous?.plugins ?? [],
            licenses: record,
            result: (lockDigest) => ({
              items: summaries,
              files,
              packages: [...staged.added],
              licenses: [...disclosures],
              lockDigest,
              notes,
            }),
          };
        },
      );
    },
  };
}

/** An npm spec's package name (`@scope/name@1` → `@scope/name`). */
function packageName(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

/**
 * Refuses a place that leads out of the artifact or onto something that isn't a file: a link or
 * a file where a directory is needed, a link or a directory where the file goes, or a name that
 * differs from one already there only in case.
 */
async function checkPlace(root: string, path: string): Promise<void> {
  const segments = path.split("/");
  let at = root;
  for (const [index, segment] of segments.entries()) {
    let entries: string[];
    try {
      entries = await readdir(at);
    } catch {
      return; // The rest is created.
    }
    const exact = entries.includes(segment);
    const folded = entries.find(
      (entry) => entry !== segment && entry.toLowerCase() === segment.toLowerCase(),
    );
    if (!exact && folded !== undefined) {
      throw fail(
        "MOSTRA_PACK_TARGET_INVALID",
        `${path} differs only in case from ${[...segments.slice(0, index), folded].join("/")}, which the artifact already has.`,
      );
    }
    at = join(at, segment);
    if (!exact) return;
    const info = await lstat(at);
    const last = index === segments.length - 1;
    if (info.isSymbolicLink()) {
      throw fail(
        "MOSTRA_PACK_TARGET_INVALID",
        `${segments.slice(0, index + 1).join("/")} is a link; a pack writes only inside the artifact.`,
      );
    }
    if (last ? !info.isFile() : !info.isDirectory()) {
      throw fail(
        "MOSTRA_PACK_TARGET_INVALID",
        `${segments.slice(0, index + 1).join("/")} is ${last ? "not a file" : "a file, not a folder"}.`,
      );
    }
  }
}

/** Writes every change, each through a temporary file; restores everything when one fails. */
async function writeAll(
  root: string,
  changes: readonly (PackFileChange & { readonly content: string })[],
): Promise<void> {
  const token = randomBytes(6).toString("hex");
  const done: { path: string; backup?: string }[] = [];
  const createdDirs: string[] = [];
  try {
    for (const change of changes) {
      if (change.action === "unchanged") continue;
      const file = join(root, ...change.path.split("/"));
      let dir = dirname(file);
      const missing: string[] = [];
      while (!existsSync(dir) && dir.length > root.length) {
        missing.unshift(dir);
        dir = dirname(dir);
      }
      for (const created of missing) {
        await mkdir(created);
        createdDirs.push(created);
      }
      const temporary = join(dirname(file), `.${basename(file)}.mostra-${token}.tmp`);
      await writeFile(temporary, change.content);
      let backup: string | undefined;
      if (existsSync(file)) {
        backup = join(dirname(file), `.${basename(file)}.mostra-${token}.old`);
        await rename(file, backup);
      }
      try {
        await rename(temporary, file);
      } catch (error) {
        if (backup !== undefined) await rename(backup, file);
        await rm(temporary, { force: true });
        throw error;
      }
      done.push({ path: file, ...(backup !== undefined ? { backup } : {}) });
    }
  } catch (error) {
    for (const entry of done.reverse()) {
      await rm(entry.path, { force: true });
      if (entry.backup !== undefined) await rename(entry.backup, entry.path);
    }
    for (const created of createdDirs.reverse())
      await rm(created, { recursive: true, force: true });
    throw fail(
      "MOSTRA_PACK_TARGET_INVALID",
      `Writing the items' files failed (${error instanceof Error ? error.message : String(error)}); nothing was changed.`,
    );
  }
  for (const entry of done) if (entry.backup !== undefined) await rm(entry.backup, { force: true });
}

/** A path as a shell word for a fix command. */
function shellWord(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The directory separator, for tests that build paths. */
export const SEP: string = sep;
