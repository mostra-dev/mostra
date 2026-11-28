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
import { KIT_FIELD_MODULES } from "./fields.ts";
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
  /** Why the version's coverage is open, when it isn't the package's own use of the hooks. */
  readonly reason?: string;
}

/**
 * Records every module outside the artifact that imports `@mostra/react` or `@mostra/react/form`
 * (D109): such a package may name fields the artifact's scan can't see, so the version's coverage
 * is open. `@mostra/react` itself and Mostra's generated files don't count. Nor does the kit, whose
 * fields the scan reads from the `id`s the artifact gives its parts (WP-18), but only where the
 * scan saw how its parts are used: a kit module with field hooks that is reached any other way (an
 * `import()`, a path into the kit's registry, a package that wraps it) opens the coverage too
 * (Opus review of WP-18, finding 2). It resolves nothing for the build.
 */
export function fieldHookUsePlugin(
  roots: {
    readonly sourceDir: string;
    readonly generatedDir: string;
    readonly runtimeDir?: string;
    readonly kitDir?: string;
  },
  uses: FieldHookUse[],
): Plugin {
  const inside = (file: string, dir: string | undefined): boolean =>
    dir !== undefined && isUnder(file, dir);
  const real = (file: string): string => (existsSync(file) ? realpathSync(file) : file);
  // The kit's modules that use the field hooks, and every import that reached a kit module.
  const kitHookModules = new Set<string>();
  const kitImports: { importer: string; source: string; kind: string; target: string }[] = [];
  // An import as the artifact wrote it: the `@/` alias hands `@/…` on as a path in its root.
  const specifierOf = (source: string): string => {
    const path = source.split("?")[0] ?? source;
    if (!isAbsolute(path) || !inside(path, roots.sourceDir)) return path;
    const rest = relative(roots.sourceDir, path).replaceAll("\\", "/");
    return `@/${rest.replace(/\.(tsx|ts|jsx|js)$/, "")}`;
  };
  return {
    name: "mostra:field-hook-use",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || importer.startsWith("\0")) return null;
      const from = real(importer.split("?")[0] ?? importer);
      if (source === "@mostra/react" || source === "@mostra/react/form") {
        if (inside(from, roots.kitDir)) {
          kitHookModules.add(pathKey(from));
          return null;
        }
        if (
          inside(from, roots.sourceDir) ||
          inside(from, roots.generatedDir) ||
          inside(from, roots.runtimeDir)
        )
          return null;
        if (!uses.some((use) => pathKey(use.importer) === pathKey(from)))
          uses.push({ importer: from });
        return null;
      }
      if (roots.kitDir === undefined || source.startsWith("\0")) return null;
      // Only an import that can name the kit is followed (`@mostra/kit…`, `@/…`, or the `@/`
      // alias's path in the artifact's root); any other is the build's own to resolve, and its
      // refusal (a confined import, a missing package) the build's own to report.
      const path = source.split("?")[0] ?? source;
      const mayReachKit =
        path.startsWith("@mostra/kit") ||
        path.startsWith("@/") ||
        (isAbsolute(path) && inside(path, roots.sourceDir));
      if (!mayReachKit) return null;
      let resolved: Awaited<ReturnType<typeof this.resolve>>;
      try {
        resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      } catch {
        return null;
      }
      const id = resolved?.id.split("?")[0];
      if (id === undefined || id.startsWith("\0") || !isAbsolute(id)) return null;
      const target = real(id);
      if (inside(target, roots.kitDir)) {
        const kind = (options as { readonly kind?: string }).kind ?? "import-statement";
        kitImports.push({ importer: from, source, kind, target: pathKey(target) });
      }
      return null;
    },
    buildEnd() {
      for (const edge of kitImports) {
        if (!kitHookModules.has(edge.target)) continue;
        // The kit's own modules reach each other; the scan follows the artifact's imports.
        if (inside(edge.importer, roots.kitDir)) continue;
        const seen =
          inside(edge.importer, roots.sourceDir) &&
          edge.kind === "import-statement" &&
          KIT_FIELD_MODULES.has(specifierOf(edge.source));
        if (seen) continue;
        const where = inside(edge.importer, roots.sourceDir)
          ? relative(roots.sourceDir, edge.importer).replaceAll("\\", "/")
          : edge.importer;
        const kitModule = `@mostra/kit/${(edge.target.split("/").pop() ?? "").replace(/\.[a-z]+$/, "")}`;
        const how =
          edge.kind === "dynamic-import"
            ? "imports it with import()"
            : KIT_FIELD_MODULES.has(specifierOf(edge.source))
              ? "isn't one of the artifact's own files"
              : `imports it as "${specifierOf(edge.source)}", not as ${kitModule}`;
        if (!uses.some((use) => use.reason !== undefined && use.importer === edge.importer)) {
          uses.push({
            importer: edge.importer,
            reason: `${where} uses ${kitModule} where the field scan can't see its ids (it ${how})`,
          });
        }
      }
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
      // Mostra's own generated entry names a plugin's anchor provider by its file in the layout
      // (WP-20): a package's file, which the lockfile's digest covers.
      if (under(from, inputs.generatedDir) && packaged(file)) return resolved;
      const where = relative(inputs.sourceDir, from);
      return this.error(
        bare
          ? `Could not resolve "${source}" from ${where}: it isn't in the warm set or the artifact's lockfile, and a version is built only from the artifact's own files and those packages; add it with \`mostra add\`.`
          : `Could not resolve "${source}" from ${where}: it is outside the artifact, and a version is built only from the artifact's own files.`,
      );
    },
  };
}
