/**
 * The Vite plugins of the SPA build (D19 seams 1 and 2): MDX compilation, and the `"use server"`
 * client-stub transform, which replaces each server module in the client build with
 * `createServerReference` stubs so no server code reaches the browser (D54).
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";
import { compile } from "@mdx-js/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { Plugin } from "vite";
import type { ServerFunctionEntry } from "../types.ts";

/** Compiles `.mdx` files to JavaScript with React's JSX runtime, frontmatter removed (MDX 3). */
export function mdxPlugin(): Plugin {
  return {
    name: "mostra:mdx",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!file.endsWith(".mdx")) return null;
      const compiled = await compile(
        { value: code, path: file },
        {
          jsxImportSource: "react",
          remarkPlugins: [remarkFrontmatter, remarkGfm],
          development: false,
        },
      );
      return { code: String(compiled.value), map: null, moduleType: "js" };
    },
  };
}

/** The client stub of one `"use server"` module. */
export function serverStub(entries: readonly ServerFunctionEntry[]): string {
  const lines = ['import { createServerReference } from "@mostra/react";'];
  // `export { local as "name" }` covers default and string export names alike (ES2022).
  entries.forEach((entry, index) => {
    lines.push(
      `const reference${index} = createServerReference(${JSON.stringify(entry.id)});`,
      `export { reference${index} as ${JSON.stringify(entry.export)} };`,
    );
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Replaces `"use server"` modules with their client stubs. `modules` maps each module's absolute
 * path to its exports, from the scan.
 */
export function serverClientStubPlugin(
  modules: ReadonlyMap<string, readonly ServerFunctionEntry[]>,
): Plugin {
  return {
    name: "mostra:use-server-client",
    enforce: "pre",
    load(id) {
      const entries = modules.get(id.split("?")[0] ?? id);
      return entries === undefined ? null : { code: serverStub(entries), moduleType: "js" };
    },
  };
}

/**
 * Keeps an artifact's imports inside its snapshot (VR-01): a relative or absolute import from an
 * artifact file that resolves outside the artifact would bring bytes into the build that neither
 * `sourceDigest` nor `envDigest` covers, so a later change to them would go unnoticed. Packages
 * (bare imports) resolve from the warm set, which `envDigest` covers.
 */
export function confinePlugin(sourceDir: string): Plugin {
  const inside = (file: string): boolean => file.startsWith(`${sourceDir}/`);
  return {
    name: "mostra:confine",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const from = importer?.split("?")[0];
      if (from === undefined || !inside(from)) return null;
      if (!source.startsWith(".") && !source.startsWith("/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const file = resolved.id.split("?")[0] ?? resolved.id;
      // Virtual modules and public URLs (`/logo.svg` from `public/`) aren't files outside the artifact.
      if (file.startsWith("\0") || inside(file) || !existsSync(file)) return resolved;
      return this.error(
        `Could not resolve "${source}" from ${relative(sourceDir, from)}: it is outside the artifact, and a version is built only from the artifact's own files.`,
      );
    },
  };
}
