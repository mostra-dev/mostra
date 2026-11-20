/**
 * Builds the kit's per-base registry packs (KT-03, D27, D179) from the shadcn items it pins: each
 * item as shadcn's registry serves it (`upstream/shadcn/<style>/<item>.json`) and its files as
 * shadcn 4.23.0's own CLI wrote them into a project with `rsc: true` and lucide icons
 * (`upstream/shadcn/<style>/installed/`), all checked against `upstream/shadcn/lock.json`.
 *
 * For each base (`base`: Base UI, from `base-nova`; `radix`: Radix, from `radix-nova`) it writes
 * `registry/<base>/<item>.json` (a shadcn registry item whose files sit beside it, with a `mostra`
 * block naming the base) and the files under `registry/<base>/{ui,lib,hooks}/`. Then it applies
 * the kit's own changes, the same for both bases: `studio.ts` maps class strings to the kit's token contract, so every theme
 * reshapes every part (KT-04).
 *
 *   node --conditions @mostra/source packages/kit/scripts/generate.ts [--check]
 *
 * `--check` writes nothing and fails when a file differs from what it would write.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGE_KEYS, FILE_CHANGES, restyle } from "./studio.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const UPSTREAM = join(ROOT, "upstream/shadcn");
const REGISTRY = join(ROOT, "registry");
const check = process.argv.includes("--check");

/** The kit's bases and the shadcn style each is read from. */
export const BASES = { base: "base-nova", radix: "radix-nova" } as const;
type Base = keyof typeof BASES;

/** The item types the kit carries: components, their helpers and hooks. */
const TYPES = new Set(["registry:ui", "registry:lib", "registry:hook"]);

/**
 * Where shadcn places each file type in a project with the default aliases, which is also where
 * the kit keeps it: `registry/<base>/` mirrors an artifact's root, so `@/components/ui/button`
 * finds the artifact's own copy first and the kit's next, by one path rule (ROUND-3 §1.1).
 */
const FOLDER: Record<string, string> = {
  "registry:ui": "components/ui",
  "registry:lib": "lib",
  "registry:hook": "hooks",
};
/**
 * The kit's own modules, as registry items too: `@mostra/kit/<module>` resolves to the artifact's
 * `components/mostra/<module>.tsx` when it has one, else to the kit's, so `mostra add <name>` makes
 * the copy that then wins (ROUND-3 §1.1, KT-10).
 */
const KIT_ITEMS = [
  {
    name: "mostra-questionnaire",
    module: "questionnaire",
    title: "Questionnaire",
    description:
      "Questions people answer, each answer a field: choices, scales, rankings, text, comments, sections and progress.",
  },
] as const;

/** The packages a file imports, by package name, without React. */
function packagesOf(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/from "([^".][^"]*)"/g)) {
    const specifier = match[1] as string;
    if (specifier.startsWith("@/")) continue;
    const parts = specifier.split("/");
    names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string));
  }
  return [...names].filter((name) => name !== "react" && name !== "react-dom").sort();
}

/** Where the vendored project holds each folder (`src/components/ui` was copied as `ui`). */
const INSTALLED: Record<string, string> = { "components/ui": "ui", lib: "lib", hooks: "hooks" };

interface UpstreamFile {
  path: string;
  type: string;
  content: string;
  target?: string;
}
interface UpstreamItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: UpstreamFile[];
  [key: string]: unknown;
}

function verifyLock(): void {
  const lock = JSON.parse(readFileSync(join(UPSTREAM, "lock.json"), "utf8")) as {
    files: Record<string, string>;
  };
  for (const [file, digest] of Object.entries(lock.files)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(UPSTREAM, file)))
      .digest("hex");
    if (actual !== digest) throw new Error(`${file} isn't the item pinned in lock.json.`);
  }
}

const written = new Map<string, string>();
function emit(path: string, text: string): void {
  written.set(path, text);
}

const usedClasses = new Map<string, number>();
const usedFiles = new Set<string>();

verifyLock();
for (const [base, style] of Object.entries(BASES) as [Base, string][]) {
  const items: UpstreamItem[] = readdirSync(join(UPSTREAM, style))
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(UPSTREAM, style, file), "utf8")) as UpstreamItem)
    .filter((item) => TYPES.has(item.type) && (item.files?.length ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const index: { name: string; type: string; title?: string; description?: string }[] = [];
  for (const item of items) {
    const imported = new Set<string>();
    const files = (item.files ?? []).map((file) => {
      const folder = FOLDER[file.type] ?? FOLDER[item.type] ?? "lib";
      const name = posix.basename(file.path);
      const path = `${folder}/${name}`;
      // What shadcn 4.23.0 itself wrote for this file: icons, imports and style markers resolved.
      let content = readFileSync(
        join(UPSTREAM, style, "installed", INSTALLED[folder] ?? folder, name),
        "utf8",
      );
      content = restyle(content, `${folder}/${name}`, usedClasses);
      const change = FILE_CHANGES[`${folder}/${name}`];
      if (change !== undefined) {
        content = change(content, base);
        usedFiles.add(`${folder}/${name}`);
      }
      emit(join(base, path), content);
      for (const match of content.matchAll(/from "([^".][^"]*)"/g)) {
        const specifier = match[1] as string;
        if (specifier.startsWith("@/")) continue;
        const parts = specifier.split("/");
        imported.add(
          specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string),
        );
      }
      return { path, type: file.type === "registry:file" ? item.type : file.type };
    });
    // Exactly the packages its files import (shadcn lists some in its style item instead), without
    // version pins: versions come from the warm set the artifact builds with (D91).
    const dependencies = [...imported].filter((d) => d !== "react" && d !== "react-dom").sort();
    const out = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: item.name,
      type: item.type,
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(dependencies.length > 0 ? { dependencies } : {}),
      ...(item.registryDependencies?.length
        ? { registryDependencies: item.registryDependencies }
        : {}),
      files,
      mostra: { base },
    };
    emit(join(base, `${item.name}.json`), `${JSON.stringify(out, null, 2)}\n`);
    index.push({
      name: item.name,
      type: item.type,
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.description !== undefined ? { description: item.description } : {}),
    });
  }
  // The kit's own modules (`@mostra/kit/<name>`), the same in every base: an item each, its file
  // at `components/mostra/<name>.tsx`, where `@mostra/kit/<name>` finds the artifact's copy first.
  for (const own of KIT_ITEMS) {
    const content = readFileSync(join(ROOT, "src", `${own.module}.tsx`), "utf8");
    const path = `components/mostra/${own.module}.tsx`;
    emit(join(base, path), content);
    const item = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: own.name,
      type: "registry:component",
      title: own.title,
      description: own.description,
      dependencies: packagesOf(content),
      files: [{ path, type: "registry:component", target: path }],
      mostra: { base },
    };
    emit(join(base, `${own.name}.json`), `${JSON.stringify(item, null, 2)}\n`);
    index.push({
      name: own.name,
      type: "registry:component",
      title: own.title,
      description: own.description,
    });
  }
  emit(
    join(base, "registry.json"),
    `${JSON.stringify(
      {
        $schema: "https://ui.shadcn.com/schema/registry.json",
        name: `mostra-${base}`,
        homepage: "https://github.com/mostra-dev/mostra/tree/main/packages/kit",
        items: index,
      },
      null,
      2,
    )}\n`,
  );
}

// The items are shadcn/ui's, under its MIT license, which travels with them.
emit("LICENSE.md", readFileSync(join(UPSTREAM, "LICENSE.md"), "utf8"));

// The variants and utilities shadcn's items use (`data-open:`, `scroll-fade`), as the `shadcn`
// 4.23.0 package ships them in `dist/tailwind.css`; the kit's CSS imports them.
const SHADCN_CSS = join(ROOT, "css", "shadcn.css");
const shadcnCss = `/* shadcn/ui's Tailwind variants and utilities, from the shadcn 4.23.0 package (MIT; registry/LICENSE.md). Generated by @mostra/kit's scripts/generate.ts. */\n${readFileSync(join(UPSTREAM, "tailwind.css"), "utf8")}`;

const unused = CHANGE_KEYS.filter((key) => !usedClasses.has(key));
const unusedFiles = Object.keys(FILE_CHANGES).filter((file) => !usedFiles.has(file));
if (unused.length > 0 || unusedFiles.length > 0) {
  throw new Error(
    `The kit's changes no longer find their place in the pinned items (update studio.ts):\n${[...unused, ...unusedFiles].map((s) => `- ${s}`).join("\n")}`,
  );
}

if (check) {
  const stale: string[] = [];
  const walk = (dir: string, prefix = ""): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    );
  for (const path of walk(REGISTRY)) {
    if (!written.has(path.split("/").join(sep))) stale.push(`${path} (not generated)`);
  }
  for (const [path, text] of written) {
    let current: string | undefined;
    try {
      current = readFileSync(join(REGISTRY, path), "utf8");
    } catch {
      current = undefined;
    }
    if (current !== text) stale.push(path);
  }
  let currentCss: string | undefined;
  try {
    currentCss = readFileSync(SHADCN_CSS, "utf8");
  } catch {
    currentCss = undefined;
  }
  if (currentCss !== shadcnCss) stale.push("../css/shadcn.css");
  if (stale.length > 0) {
    console.error(`The kit's registry is stale; run its generate script:\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log(`registry: ${written.size} files current`);
} else {
  rmSync(REGISTRY, { recursive: true, force: true });
  for (const [path, text] of written) {
    mkdirSync(dirname(join(REGISTRY, path)), { recursive: true });
    writeFileSync(join(REGISTRY, path), text);
  }
  writeFileSync(SHADCN_CSS, shadcnCss);
  console.log(`wrote ${written.size} files in registry/`);
}
