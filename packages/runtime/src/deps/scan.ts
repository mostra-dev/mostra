/**
 * The static import scan (D95): which npm packages an artifact's snapshot imports, found by
 * parsing, never by running anything (RT-02). It reads every script (static, dynamic and
 * `require` imports, `export … from` and `@jsxImportSource` pragmas), the ESM blocks of MDX files, and the `@import`,
 * `@plugin` and `@reference` rules of CSS files. Type-only imports are skipped: the build erases
 * them. What the scan misses (a computed `import()`, say) still meets the build, which refuses a
 * package outside the warm set and the lockfile, and `deps/add` adds it explicitly.
 */

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import type * as Oxc from "oxc-parser";
import { packageOf } from "./specifier.ts";

let oxc: typeof Oxc | undefined;
/** Loads the native parser on first use, so the platform gate answers first (RT-07). */
function parser(): typeof Oxc {
  oxc ??= createRequire(import.meta.url)("oxc-parser") as typeof Oxc;
  return oxc;
}

/** Where an import is, inside the artifact. */
export interface ImportSite {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

const SCRIPT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

function langOf(file: string): "ts" | "tsx" | "js" | "jsx" {
  const ext = extname(file);
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx" || ext === ".mdx") return "jsx";
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  return "js";
}

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const newline = before.lastIndexOf("\n");
  return { line: before.split("\n").length, column: offset - newline };
}

/** A string literal's value, or `undefined` for anything computed. */
function literal(source: string): string | undefined {
  const quote = source[0];
  if ((quote !== '"' && quote !== "'" && quote !== "`") || source.at(-1) !== quote)
    return undefined;
  const body = source.slice(1, -1);
  if (quote === "`" && body.includes("${")) return undefined;
  return body;
}

/** The specifiers a script imports, with their offsets in `text`. */
function scriptImports(file: string, text: string): { specifier: string; offset: number }[] {
  const parsed = parser().parseSync(file, text, { lang: langOf(file), sourceType: "module" });
  if (parsed.errors.length > 0 && !parsed.program) return [];
  const found: { specifier: string; offset: number }[] = [];
  const { module } = parsed;
  for (const entry of module.staticImports) {
    if (entry.entries.length > 0 && entry.entries.every((item) => item.isType)) continue;
    found.push({ specifier: entry.moduleRequest.value, offset: entry.moduleRequest.start });
  }
  for (const entry of module.staticExports) {
    for (const item of entry.entries) {
      if (!item.moduleRequest || (item as { isType?: boolean }).isType) continue;
      found.push({ specifier: item.moduleRequest.value, offset: item.moduleRequest.start });
    }
  }
  for (const entry of module.dynamicImports) {
    const value = literal(text.slice(entry.moduleRequest.start, entry.moduleRequest.end));
    if (value !== undefined) found.push({ specifier: value, offset: entry.moduleRequest.start });
  }
  // A JSX pragma makes the compiled file import `<package>/jsx-runtime`.
  for (const comment of parsed.comments) {
    const pragma = /@jsxImportSource\s+(\S+)/.exec(comment.value);
    if (pragma?.[1]) found.push({ specifier: pragma[1], offset: comment.start });
  }
  // `require("x")` in CommonJS files and in code that keeps it.
  if (text.includes("require")) {
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (node === null || typeof node !== "object") return;
      const current = node as Node;
      if (current.type === "CallExpression") {
        const callee = current["callee"] as Node | undefined;
        const [first] = (current["arguments"] as Node[] | undefined) ?? [];
        if (
          callee?.type === "Identifier" &&
          (callee as unknown as { name: string }).name === "require" &&
          first?.type === "Literal" &&
          typeof (first as unknown as { value: unknown }).value === "string"
        ) {
          found.push({
            specifier: (first as unknown as { value: string }).value,
            offset: first.start,
          });
        }
      }
      for (const [key, value] of Object.entries(current)) {
        if (key !== "type" && key !== "start" && key !== "end" && typeof value === "object") {
          visit(value);
        }
      }
    };
    visit(parsed.program);
  }
  return found;
}

/**
 * The ESM blocks of an MDX file (MDX 3): paragraphs outside code fences and frontmatter whose
 * first line starts with `import` or `export`, each running to the next blank line.
 */
function mdxImports(file: string, text: string): { specifier: string; offset: number }[] {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  const found: { specifier: string; offset: number }[] = [];
  let index = 0;
  if (lines[0]?.trim() === "---") {
    index = lines.findIndex((line, i) => i > 0 && line.trim() === "---") + 1;
    if (index === 0) return found;
  }
  let fence: string | undefined;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      index++;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      index++;
      continue;
    }
    if (/^(import|export)\b/.test(line)) {
      let end = index;
      while (end + 1 < lines.length && (lines[end + 1] ?? "").trim() !== "") end++;
      const start = offsets[index] ?? 0;
      const block = lines.slice(index, end + 1).join("\n");
      try {
        for (const entry of scriptImports(`${file}.jsx`, block)) {
          found.push({ specifier: entry.specifier, offset: start + entry.offset });
        }
      } catch {
        // Not ESM after all: the MDX compiler reports it.
      }
      index = end + 1;
      continue;
    }
    index++;
  }
  return found;
}

/** The packages a CSS file loads: `@import`, Tailwind's `@plugin` and `@reference`. */
function cssImports(text: string): { specifier: string; offset: number }[] {
  const found: { specifier: string; offset: number }[] = [];
  const rule = /@(?:import|plugin|reference)\s+(?:url\(\s*)?(["'])([^"'\n]+)\1/g;
  for (const match of text.matchAll(rule)) {
    found.push({
      specifier: match[2] ?? "",
      offset: (match.index ?? 0) + match[0].indexOf(match[1] ?? ""),
    });
  }
  return found;
}

async function listFiles(dir: string, prefix: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // `public/` is served as-is and never bundled (INTERFACES §2.1).
    if (entry.isDirectory()) {
      if (path !== "public") await listFiles(join(dir, entry.name), path, out);
    } else if (entry.isFile()) out.push(path);
  }
}

/**
 * The npm packages the artifact in `sourceDir` imports, each with its first import site, sorted by
 * name. Warm packages are included; the caller tells them apart.
 */
export async function scanImports(sourceDir: string): Promise<Map<string, ImportSite>> {
  const files: string[] = [];
  await listFiles(sourceDir, "", files);
  files.sort();
  const found = new Map<string, ImportSite>();
  for (const file of files) {
    const ext = extname(file);
    // Declaration files hold types only; the build never loads them.
    if (/\.d\.[cm]?ts$/.test(file)) continue;
    const kind = SCRIPT.has(ext) ? "script" : ext === ".mdx" ? "mdx" : ext === ".css" ? "css" : "";
    if (kind === "") continue;
    const text = await readFile(join(sourceDir, file), "utf8");
    let imports: { specifier: string; offset: number }[];
    try {
      imports =
        kind === "script"
          ? scriptImports(file, text)
          : kind === "mdx"
            ? mdxImports(file, text)
            : cssImports(text);
    } catch {
      // A file that doesn't parse is the build's to report.
      continue;
    }
    for (const { specifier, offset } of imports) {
      const name = packageOf(specifier);
      if (name !== undefined && !found.has(name)) {
        found.set(name, { file, ...position(text, offset) });
      }
    }
  }
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : 1)));
}
