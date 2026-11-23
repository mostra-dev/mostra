/**
 * The SPA render mode's build (D19, ROUND-3 §7): one Vite 8 build of the client, and, when the
 * artifact has `"use server"` modules or `live.ts`, one build of the server bundle the worker
 * loads (WP-08). The build runs in a staging directory whose `node_modules` is a link to the warm
 * set (D91) or to the artifact's lock layout (D95), so an artifact needs no `package.json` (AU-03).
 * Nothing in the artifact runs.
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type InlineConfig, type PluginOption } from "vite";
import { isUnder, linkDirectory, pathKey } from "../../platform/index.ts";
import type { FieldCoverage } from "../coverage.ts";
import {
  type BuildRequest,
  type BuildResponse,
  LIVE_DECLARATION,
  type ServerFunctionEntry,
  STAGING_FILES,
  type VersionRegistry,
} from "../types.ts";
import { entryStylesheet, hostTokensElement, kitResolvePlugin, themeAttributes } from "./kit.ts";
import {
  type BuildInputs,
  confinePlugin,
  type FieldHookUse,
  fieldHookUsePlugin,
  mdxPlugin,
  serverClientStubPlugin,
} from "./plugins.ts";
import { type ScanResult, scanArtifact } from "./scan.ts";

/** Where generated build files live inside the staging directory (never in the snapshot). */
export const GENERATED = ".mostra-build";

export const html = (title: string, versionId: string, attributes = "", head = ""): string =>
  `<!doctype html>
<html lang="en"${attributes}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="mostra-version" content="${versionId}" />
    <title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>${head}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${GENERATED}/entry.js"></script>
  </body>
</html>
`;

/**
 * The client entry: hands the page, or the `pages/` routes inside the entry's layout (D57), to the
 * client runtime, which picks the history mode for its delivery target (D111), connects to the
 * shell over the bridge, reports the current page and `mostra/ready` (SH-04), and installs
 * `window.storage` (D53). A single page never loads React Router.
 */
export function clientEntry(
  request: Pick<BuildRequest, "entry" | "entryHasDefault">,
  scan: ScanResult,
): string {
  const source = (file: string): string => JSON.stringify(`../source/${file}`);
  const lines = [`import "./styles.css";`];
  if (scan.pages.length === 0) {
    lines.push(
      `import { mountArtifact } from "@mostra/react";`,
      `import Page from ${source(request.entry)};`,
      `mountArtifact({ page: Page });`,
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `import { mountRoutes } from "@mostra/react/router";`,
    request.entryHasDefault
      ? `import Layout from ${source(request.entry)};`
      : `import ${source(request.entry)};`,
  );
  for (const [index, page] of scan.pages.entries()) {
    lines.push(`import Page${index} from ${source(page.file)};`);
  }
  const routes = scan.pages
    .map((page, index) => `{ path: ${JSON.stringify(page.path)}, page: Page${index} }`)
    .join(", ");
  const layout = request.entryHasDefault ? ", layout: Layout" : "";
  lines.push(`mountRoutes({ routes: [${routes}]${layout} });`);
  return `${lines.join("\n")}\n`;
}

/** The field coverage, opened by every package outside the artifact that uses the field hooks. */
export function withPackageUses(
  fields: FieldCoverage,
  uses: readonly FieldHookUse[],
): FieldCoverage {
  const packageOf = (file: string): string => {
    const names = [...file.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
    return names.at(-1)?.[1] ?? file;
  };
  const openReasons = [
    ...fields.openReasons,
    ...[
      ...new Set(
        uses.filter((use) => use.reason === undefined).map((use) => packageOf(use.importer)),
      ),
    ].map((name) => ({ reason: `the package ${name} uses @mostra/react's field hooks` })),
    ...uses.flatMap((use) => (use.reason !== undefined ? [{ reason: use.reason }] : [])),
  ];
  return { ...fields, open: openReasons.length > 0, openReasons };
}

/** The server entry: every server function by ID, and the live sources (loaded by WP-08's worker). */
export function serverEntry(scan: ScanResult): string {
  const lines: string[] = [];
  const functions: string[] = [];
  [...scan.serverModules.entries()].forEach(([module, entries], index) => {
    lines.push(`import * as module${index} from ${JSON.stringify(`../source/${module}`)};`);
    for (const entry of entries) {
      functions.push(
        `  ${JSON.stringify(entry.id)}: module${index}[${JSON.stringify(entry.export)}],`,
      );
    }
  });
  lines.push(`export const functions = {\n${functions.join("\n")}\n};`);
  if (scan.hasLive) lines.push(`export * as live from "../source/live.ts";`);
  else lines.push("export const live = {};");
  return `${lines.join("\n")}\n`;
}

/** Turns a bundler error into a diagnostic with the file relative to the artifact. */
export function diagnose(error: unknown, sourceDir: string): Diagnostic {
  const failure = error as {
    message?: string;
    code?: string;
    id?: string;
    loc?: { file?: string; line?: number; column?: number };
    errors?: {
      message?: string;
      code?: string;
      id?: string;
      loc?: { file?: string; line?: number; column?: number };
    }[];
  };
  const first = failure.errors?.[0] ?? failure;
  // Bundler messages carry terminal colours; diagnostics are plain text.
  // Paths in the message as the bundler spells them (`/`-separated on Windows too).
  const rawMessage = stripVTControlCharacters(first.message ?? String(error))
    .replaceAll(`${sourceDir}/`, "")
    .replaceAll(`${sourceDir.replaceAll("\\", "/")}/`, "")
    .replaceAll(`${sourceDir}\\`, "");
  const file = first.loc?.file ?? first.id;
  const inSource =
    file !== undefined && isUnder(file, sourceDir)
      ? relative(sourceDir, file).replaceAll("\\", "/")
      : undefined;
  const location =
    inSource !== undefined
      ? { file: inSource, line: first.loc?.line ?? 1, column: (first.loc?.column ?? 0) + 1 }
      : undefined;
  const unresolved =
    first.code === "UNRESOLVED_IMPORT" || /\b(?:could not|failed to) resolve\b/i.test(rawMessage);
  return createDiagnostic(unresolved ? "MOSTRA_BUILD_UNRESOLVED" : "MOSTRA_BUILD_FAILED", {
    message: rawMessage.split("\n").slice(0, 6).join("\n"),
    ...(location ? { location } : {}),
  });
}

export function baseConfig(
  request: Pick<BuildRequest, "stagingDir" | "kit">,
  sourceDir: string,
  plugins: PluginOption[],
  /** Plugins that watch every import as written, so they run before the kit's resolution. */
  observers: PluginOption[] = [],
): InlineConfig {
  return {
    root: request.stagingDir,
    configFile: false,
    envDir: false,
    // Only variables with this prefix would reach the bundle; the builder's environment has none.
    envPrefix: "MOSTRA_ARTIFACT_PUBLIC_",
    logLevel: "warn",
    clearScreen: false,
    base: "/",
    mode: "production",
    resolve: {
      // `@/…` in a stylesheet (`@import`, `url()`) as in code: Vite resolves a stylesheet's
      // imports with its aliases and never a plugin (Opus review of WP-18, finding 4). The alias
      // hands code's `@/…` on as a path in the artifact's root, which the kit's resolution below
      // takes the same way, falling back to the kit's registry.
      // A theme's faces (`FACE_PREFIX`) come from the build's own packages, its warm set's or its
      // lockfile's, whichever package carried the theme.
      alias: [
        { find: /^@\//, replacement: `${sourceDir}/` },
        { find: /^@mostra:face\//, replacement: `${request.stagingDir}/node_modules/` },
      ],
      dedupe: ["react", "react-dom"],
    },
    // Settings given here are never searched for: no PostCSS config, from anywhere above the
    // home, is loaded or run (VR-01). Tailwind is a plugin of its own.
    css: { postcss: {} },
    // `@/…` is the artifact's root, then the kit's registry for its base (ROUND-3 §1.1).
    plugins: [...observers, kitResolvePlugin(sourceDir, request.kit), ...plugins],
  };
}

/**
 * The real directories the build's packages and their dependencies live in: for a package in a
 * pnpm store, the store (`.pnpm`) that holds it and its dependencies; otherwise the package's own
 * directory (a workspace link such as `@mostra/react`), followed by the packages it depends on in
 * turn (`@mostra/protocol`, say).
 */
export async function packageRoots(nodeModules: string): Promise<string[]> {
  const roots = new Set<string>();
  const visit = async (modules: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(modules, { withFileTypes: true });
    } catch {
      return;
    }
    roots.add(await realpath(modules));
    const packages: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(join(modules, entry.name))) {
          packages.push(join(modules, entry.name, scoped));
        }
      } else packages.push(join(modules, entry.name));
    }
    for (const link of packages) {
      let dir: string;
      try {
        dir = await realpath(link);
      } catch {
        continue; // A dangling link brings nothing in.
      }
      // pnpm's store, found however the platform spells separators (the key keeps the length).
      const store = pathKey(dir).lastIndexOf("/.pnpm/");
      const root = store === -1 ? dir : dir.slice(0, store + "/.pnpm".length);
      if (roots.has(root)) continue;
      roots.add(root);
      if (store === -1) await visit(join(dir, "node_modules"));
    }
  };
  await visit(nodeModules);
  return [...roots];
}

/** Runs the SPA build of `request`. */
export async function buildSpa(input: BuildRequest): Promise<BuildResponse> {
  // Bundler paths are real paths; staging may sit behind a symbolic link (macOS /tmp).
  const request = { ...input, stagingDir: await realpath(input.stagingDir) };
  const sourceDir = join(request.stagingDir, "source");
  const scan = await scanArtifact(sourceDir);
  if (scan.diagnostics.length > 0) return { ok: false, diagnostics: scan.diagnostics };
  if (!request.entryHasDefault && scan.pages.length === 0) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("MOSTRA_ARTIFACT_NO_PAGE", {
          message: `${request.entry} has no default export and the artifact has no pages/ folder.`,
          location: { file: request.entry, line: 1, column: 1 },
        }),
      ],
    };
  }

  const generated = join(request.stagingDir, GENERATED);
  await mkdir(generated, { recursive: true });
  for (const [name, text] of Object.entries(STAGING_FILES)) {
    await writeFile(join(request.stagingDir, name), text);
  }
  const inputs: BuildInputs = {
    sourceDir,
    generatedDir: generated,
    packageRoots: await packageRoots(request.nodeModules),
  };
  await rm(join(request.stagingDir, "node_modules"), { force: true, recursive: true });
  await linkDirectory(request.nodeModules, join(request.stagingDir, "node_modules"));
  await writeFile(
    join(request.stagingDir, "index.html"),
    html(
      request.manifest.title,
      request.versionId,
      themeAttributes(request.kit),
      hostTokensElement(request.kit),
    ),
  );
  await writeFile(join(generated, "entry.js"), clientEntry(request, scan));
  await writeFile(join(generated, "theme.css"), request.kit.themeCss);
  await writeFile(
    join(generated, "styles.css"),
    entryStylesheet(generated, sourceDir, request.kit),
  );
  if (scan.hasLive) await writeFile(join(generated, "mostra-env.d.ts"), LIVE_DECLARATION);

  const serverModules = new Map<string, readonly ServerFunctionEntry[]>(
    [...scan.serverModules].map(([module, entries]) => [pathKey(join(sourceDir, module)), entries]),
  );
  // Packages that use the field hooks themselves open the version's coverage (D109).
  const hookUses: FieldHookUse[] = [];
  let runtimeDir: string | undefined;
  try {
    runtimeDir = await realpath(join(request.nodeModules, "@mostra", "react"));
  } catch {
    runtimeDir = undefined;
  }
  let kitDir: string | undefined;
  try {
    kitDir = await realpath(join(request.nodeModules, "@mostra", "kit"));
  } catch {
    kitDir = undefined;
  }
  try {
    await build({
      ...baseConfig(
        request,
        sourceDir,
        [
          confinePlugin(inputs),
          mdxPlugin(),
          serverClientStubPlugin(serverModules, sourceDir),
          react(),
          tailwind(),
        ],
        [
          fieldHookUsePlugin(
            {
              sourceDir,
              generatedDir: generated,
              ...(runtimeDir ? { runtimeDir } : {}),
              ...(kitDir ? { kitDir } : {}),
            },
            hookUses,
          ),
        ],
      ),
      // The artifact's public/ is served as-is at the root (INTERFACES §2.1).
      publicDir: join(sourceDir, "public"),
      build: {
        outDir: join(request.outDir, "client"),
        emptyOutDir: true,
        sourcemap: true,
        reportCompressedSize: false,
      },
    });
  } catch (error) {
    return { ok: false, diagnostics: [diagnose(error, sourceDir)] };
  }
  // Served frames (WP-20, ARCHITECTURE §8): every other HTML page of the version carries the
  // review agent, so comments on a frame that shows one anchor in its content.
  const reviewAgent = runtimeDir
    ? await injectReviewAgent(
        join(request.outDir, "client"),
        join(runtimeDir, "dist", "review-agent.js"),
      )
    : undefined;

  const server = scan.serverModules.size > 0 || scan.hasLive;
  if (server) {
    await writeFile(join(generated, "server-entry.js"), serverEntry(scan));
    try {
      await build({
        ...baseConfig(request, sourceDir, [confinePlugin(inputs), mdxPlugin(), react()]),
        publicDir: false,
        // Packages stay external (Vite's default for a server build, D135): the worker resolves
        // them from the layout this build resolved them in (the warm set's, or the lockfile's,
        // whose digest the version's identity covers), so each runs from its own directory with
        // its native addons and its own files, and React exists once. The artifact's own code is
        // bundled; a package Vite can't run unbundled (a linked one, or one whose entry isn't
        // JavaScript) is bundled too.
        ssr: { external: ["@mostra/server"], target: "node" },
        build: {
          ssr: join(generated, "server-entry.js"),
          outDir: join(request.outDir, "server"),
          emptyOutDir: true,
          sourcemap: true,
          rolldownOptions: {
            // The worker provides @mostra/server (WP-08), its own copy, so the two share context.
            external: ["@mostra/server"],
            output: { entryFileNames: "entry.mjs", format: "es" },
          },
        },
      });
    } catch (error) {
      return { ok: false, diagnostics: [diagnose(error, sourceDir)] };
    }
  }

  const registry: VersionRegistry = {
    schemaVersion: 1,
    entry: request.entry,
    actions: [...scan.serverModules.values()].flat(),
    liveSources: scan.liveSources,
    pages: scan.pages,
    terminals: Object.keys(request.manifest.terminals ?? {}).sort(),
    demos: Object.keys(request.manifest.demos ?? {}).sort(),
    fields: withPackageUses(scan.fields, hookUses),
    ...(reviewAgent !== undefined ? { reviewAgent } : {}),
  };
  return { ok: true, registry, server };
}

/**
 * Adds the review agent to every HTML page of a client build but its own `index.html` (WP-20):
 * the agent is copied into `assets/` under a name its content decides, and each page loads it
 * before its own scripts. Answers the agent's path in the build, or `undefined` when the build
 * has no other page or the runtime carries no agent.
 */
export async function injectReviewAgent(
  clientDir: string,
  agentFile: string,
): Promise<string | undefined> {
  const pages: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.html?$/i.test(entry.name) && path !== join(clientDir, "index.html"))
        pages.push(path);
    }
  };
  await walk(clientDir);
  if (pages.length === 0) return undefined;
  let agent: Buffer;
  try {
    agent = await readFile(agentFile);
  } catch {
    return undefined;
  }
  const name = `assets/mostra-review-agent-${createHash("sha256").update(agent).digest("hex").slice(0, 10)}.js`;
  await mkdir(join(clientDir, "assets"), { recursive: true });
  await writeFile(join(clientDir, name), agent);
  // Inline in each page: a frame the artifact sandboxes has an opaque origin, whose requests carry
  // no session, so it couldn't fetch the agent; its own document still loads, the agent with it.
  // The file stays for what loads it by name (WP-24's proxied demos).
  // An agent whose text an HTML parser would end early (never the case today) goes by name.
  const code = agent.toString("utf8");
  const tag = /<\/script|<!--/i.test(code)
    ? `<script src="/${name}"></script>`
    : `<script>${code}</script>`;
  for (const page of pages) {
    const html = await readFile(page, "utf8");
    const head = /<head[^>]*>/i.exec(html);
    const injected = head
      ? `${html.slice(0, head.index + head[0].length)}${tag}${html.slice(head.index + head[0].length)}`
      : `${tag}${html}`;
    await writeFile(page, injected);
  }
  return name;
}
