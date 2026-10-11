/**
 * The Vite plugins of the SPA build (D19 seams 1 and 2): MDX compilation, and the `"use server"`
 * client-stub transform, which replaces each server module in the client build with
 * `createServerReference` stubs so no server code reaches the browser (D54).
 */

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
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

/** Where an artifact's build may read from (VR-01: every input is covered by a digest). */
export interface BuildInputs {
  /** The artifact's snapshot (`sourceDigest`). */
  readonly sourceDir: string;
  /** Mostra's generated build files (`buildConfigDigest`), whose imports are checked like the artifact's. */
  readonly generatedDir: string;
  /** Real directories holding the warm set's packages and their dependencies (`lockDigest`). */
  readonly packageRoots: readonly string[];
}

/**
 * Keeps a build's inputs inside what the version's digests cover (VR-01, DATA_MODEL §2). A relative
 * or absolute import from an artifact file must resolve inside the artifact, and a package import
 * from an artifact file or a generated file must resolve into the warm set. Anything else (a file
 * beside the artifact, a stray `node_modules` above the home) would bring bytes into the build
 * that no digest covers, so a later change to them would go unnoticed.
 */
export function confinePlugin(inputs: BuildInputs): Plugin {
  const under = (file: string, dir: string): boolean => file.startsWith(`${dir}/`);
  const checked = (file: string): boolean =>
    under(file, inputs.sourceDir) || under(file, inputs.generatedDir);
  const real = (file: string): string => {
    try {
      return realpathSync.native(file);
    } catch {
      return file;
    }
  };
  return {
    name: "mostra:confine",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const from = importer?.split("?")[0];
      if (from === undefined || !checked(from) || source.startsWith("\0")) return null;
      const bare = !source.startsWith(".") && !source.startsWith("/");
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const id = resolved.id.split("?")[0] ?? resolved.id;
      // Virtual modules, browser stubs for Node built-ins and public URLs (`/logo.svg` from
      // `public/`) aren't files, so there is nothing outside to read.
      if (id.startsWith("\0") || !isAbsolute(id) || !existsSync(id)) return resolved;
      const file = real(id);
      if (under(file, inputs.sourceDir) || under(file, inputs.generatedDir)) return resolved;
      if (bare && inputs.packageRoots.some((root) => under(file, root))) return resolved;
      const where = relative(inputs.sourceDir, from);
      return this.error(
        bare
          ? `Could not resolve "${source}" from ${where}: it isn't in the warm set, and a version is built only from the artifact's own files and the warm set's packages.`
          : `Could not resolve "${source}" from ${where}: it is outside the artifact, and a version is built only from the artifact's own files.`,
      );
    },
  };
}
