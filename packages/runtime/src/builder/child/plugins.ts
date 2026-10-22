/**
 * The Vite plugins of the SPA build (D19 seams 1 and 2): MDX compilation, and the `"use server"`
 * client-stub transform, which replaces each server module in the client build with
 * `createServerReference` stubs so no server code reaches the browser (D54).
 */

import { existsSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative } from "node:path";
import { compile } from "@mdx-js/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { Plugin } from "vite";
import { isUnder, pathKey } from "../../platform/index.ts";
import type { ServerFunctionEntry } from "../types.ts";
import { SCRIPT, startsWithUseServer } from "./scan.ts";

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

/** Where packages outside the artifact use the client runtime's field hooks (D109). */
export interface FieldHookUse {
  /** The importing module's path, relative to the build's `node_modules` when it is a package. */
  readonly importer: string;
}

/**
 * Records every module outside the artifact that imports `@mostra/react` or `@mostra/react/form`
 * (D109): such a package may name fields the artifact's scan can't see, so the version's coverage
 * is open. `@mostra/react` itself and Mostra's generated files don't count. It resolves nothing.
 */
export function fieldHookUsePlugin(
  roots: {
    readonly sourceDir: string;
    readonly generatedDir: string;
    readonly runtimeDir?: string;
  },
  uses: FieldHookUse[],
): Plugin {
  const inside = (file: string, dir: string | undefined): boolean =>
    dir !== undefined && isUnder(file, dir);
  return {
    name: "mostra:field-hook-use",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@mostra/react" && source !== "@mostra/react/form") return null;
      if (importer === undefined || importer.startsWith("\0")) return null;
      const file = existsSync(importer) ? realpathSync(importer) : importer;
      if (
        inside(file, roots.sourceDir) ||
        inside(file, roots.generatedDir) ||
        inside(file, roots.runtimeDir)
      )
        return null;
      if (!uses.some((use) => pathKey(use.importer) === pathKey(file)))
        uses.push({ importer: file });
      return null;
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

/** The ID prefix of the virtual stub modules that stand in for server modules in the client. */
const STUB_PREFIX = "\0mostra-server-reference:";

/**
 * Replaces `"use server"` modules with their client stubs. `modules` maps each module's absolute
 * path, as its {@link pathKey}, to its exports, from the scan: bundlers spell Windows paths with
 * `/`, the file system with `\\`.
 */
export function serverClientStubPlugin(
  modules: ReadonlyMap<string, readonly ServerFunctionEntry[]>,
  sourceDir: string,
): Plugin {
  return {
    name: "mostra:use-server-client",
    enforce: "pre",
    // Server modules resolve to a virtual stub module whose ID ends in `.mjs`: the bundler reads a
    // `.cts` or `.cjs` file name as CommonJS, and the stub is an ES module.
    async resolveId(source, importer, options) {
      if (source.startsWith(STUB_PREFIX)) return source;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const file = resolved?.id.split("?")[0];
      return file !== undefined && modules.has(pathKey(file))
        ? `${STUB_PREFIX}${pathKey(file)}.mjs`
        : null;
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const entries = modules.get(id.slice(STUB_PREFIX.length, -".mjs".length));
      return entries === undefined ? null : { code: serverStub(entries), moduleType: "js" };
    },
    // Fails closed (D54): a module of the artifact that reaches the client build with the
    // directive, but without a stub, would ship its server code to every viewer.
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!isUnder(file, sourceDir) || modules.has(pathKey(file))) return null;
      if (!SCRIPT.has(extname(file))) return null;
      if (startsWithUseServer(file, code) !== true) return null;
      return this.error(
        `${relative(sourceDir, file)} starts with "use server" but has no client stub, so its server code would reach the browser; give it one of the extensions ${[...SCRIPT].join(", ")}.`,
      );
    },
  };
}

/** Where an artifact's build may read from (VR-01: every input is covered by a digest). */
export interface BuildInputs {
  /** The artifact's snapshot (`sourceDigest`). */
  readonly sourceDir: string;
  /** Mostra's generated build files (`buildConfigDigest`), whose imports are checked like the artifact's. */
  readonly generatedDir: string;
  /** Real directories holding the build's packages and their dependencies (`lockDigest`). */
  readonly packageRoots: readonly string[];
}

/**
 * Keeps a build's inputs inside what the version's digests cover (VR-01, DATA_MODEL §2). A relative
 * or absolute import from an artifact file must resolve inside the artifact, and a package import
 * from an artifact file or a generated file must resolve into the build's packages (the warm set
 * and the artifact's lockfile). An import from inside a package must stay among those packages
 * too: a package that imports a dependency it doesn't declare would otherwise find it in any
 * `node_modules` above the home. Anything else (a file beside the artifact, a stray
 * `node_modules` above the home) would bring bytes into the build that no digest covers, so a
 * later change to them would go unnoticed.
 */
export function confinePlugin(inputs: BuildInputs): Plugin {
  const under = (file: string, dir: string): boolean => isUnder(file, dir);
  const ours = (file: string): boolean =>
    under(file, inputs.sourceDir) || under(file, inputs.generatedDir);
  const packaged = (file: string): boolean => inputs.packageRoots.some((root) => under(file, root));
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
      if (from === undefined || source.startsWith("\0")) return null;
      const fromPackage = !ours(from);
      if (fromPackage && !packaged(from)) return null;
      const bare = !source.startsWith(".") && !source.startsWith("/") && !isAbsolute(source);
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const id = resolved.id.split("?")[0] ?? resolved.id;
      // Virtual modules, browser stubs for Node built-ins and public URLs (`/logo.svg` from
      // `public/`) aren't files, so there is nothing outside to read.
      if (id.startsWith("\0") || !isAbsolute(id) || !existsSync(id)) return resolved;
      const file = real(id);
      if (fromPackage) {
        if (packaged(file)) return resolved;
        return this.error(
          `Could not resolve "${source}" from the package file ${from}: it isn't among the build's packages (the warm set and the artifact's lockfile), and a package can't take a dependency it doesn't declare from elsewhere.`,
        );
      }
      if (ours(file)) return resolved;
      if (bare && packaged(file)) return resolved;
      const where = relative(inputs.sourceDir, from);
      return this.error(
        bare
          ? `Could not resolve "${source}" from ${where}: it isn't in the warm set or the artifact's lockfile, and a version is built only from the artifact's own files and those packages; add it with \`mostra add\`.`
          : `Could not resolve "${source}" from ${where}: it is outside the artifact, and a version is built only from the artifact's own files.`,
      );
    },
  };
}
