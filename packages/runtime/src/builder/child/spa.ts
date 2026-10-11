/**
 * The SPA render mode's build (D19, ROUND-3 §7): one Vite 8 build of the client, and, when the
 * artifact has `"use server"` modules or `live.ts`, one build of the server bundle the worker
 * loads (WP-08). The build runs in a staging directory whose `node_modules` is a link to the warm
 * set (D91), so an artifact needs no `package.json` (AU-03). Nothing in the artifact runs.
 */
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type InlineConfig, type PluginOption } from "vite";
import type {
  BuildRequest,
  BuildResponse,
  ServerFunctionEntry,
  VersionRegistry,
} from "../types.ts";
import { mdxPlugin, serverClientStubPlugin } from "./plugins.ts";
import { type ScanResult, scanArtifact } from "./scan.ts";

/** Where generated build files live inside the staging directory (never in the snapshot). */
const GENERATED = ".mostra-build";

const html = (title: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${GENERATED}/entry.js"></script>
  </body>
</html>
`;

/** The client entry: mounts the page, or the `pages/` routes inside the entry's layout (D57). */
function clientEntry(request: BuildRequest, scan: ScanResult): string {
  const source = (file: string): string => JSON.stringify(`../source/${file}`);
  const lines = [
    `import "./styles.css";`,
    `import { createElement } from "react";`,
    `import { createRoot } from "react-dom/client";`,
  ];
  const mount = `createRoot(document.getElementById("root")).render`;
  if (scan.pages.length === 0) {
    lines.push(`import Page from ${source(request.entry)};`, `${mount}(createElement(Page));`);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `import { createBrowserRouter, Outlet } from "react-router";`,
    `import { RouterProvider } from "react-router/dom";`,
    request.entryHasDefault
      ? `import Layout from ${source(request.entry)};`
      : `import ${source(request.entry)};`,
  );
  for (const [index, page] of scan.pages.entries()) {
    lines.push(`import Page${index} from ${source(page.file)};`);
  }
  const routes = scan.pages
    .map(
      (page, index) =>
        `{ path: ${JSON.stringify(page.path)}, element: createElement(Page${index}) }`,
    )
    .join(", ");
  lines.push(`const routes = [${routes}];`);
  lines.push(
    request.entryHasDefault
      ? `const router = createBrowserRouter([{ element: createElement(Layout, null, createElement(Outlet)), children: routes }]);`
      : `const router = createBrowserRouter(routes);`,
    `${mount}(createElement(RouterProvider, { router }));`,
  );
  return `${lines.join("\n")}\n`;
}

/** The server entry: every server function by ID, and the live sources (loaded by WP-08's worker). */
function serverEntry(scan: ScanResult): string {
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
function diagnose(error: unknown, sourceDir: string): Diagnostic {
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
  const rawMessage = (first.message ?? String(error)).replaceAll(`${sourceDir}/`, "");
  const file = first.loc?.file ?? first.id;
  const inSource = file?.startsWith(sourceDir) ? relative(sourceDir, file) : undefined;
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

function baseConfig(
  request: BuildRequest,
  sourceDir: string,
  plugins: PluginOption[],
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
      alias: [{ find: /^@\//, replacement: `${sourceDir}/` }],
      dedupe: ["react", "react-dom"],
    },
    plugins,
  };
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
  await rm(join(request.stagingDir, "node_modules"), { force: true, recursive: true });
  await symlink(request.nodeModules, join(request.stagingDir, "node_modules"), "dir");
  await writeFile(join(request.stagingDir, "index.html"), html(request.manifest.title));
  await writeFile(join(generated, "entry.js"), clientEntry(request, scan));
  await writeFile(join(generated, "styles.css"), `@import "tailwindcss" source("../source");\n`);

  const serverModules = new Map<string, readonly ServerFunctionEntry[]>(
    [...scan.serverModules].map(([module, entries]) => [join(sourceDir, module), entries]),
  );
  try {
    await build({
      ...baseConfig(request, sourceDir, [
        mdxPlugin(),
        serverClientStubPlugin(serverModules),
        react(),
        tailwind(),
      ]),
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

  const server = scan.serverModules.size > 0 || scan.hasLive;
  if (server) {
    await writeFile(join(generated, "server-entry.js"), serverEntry(scan));
    try {
      await build({
        ...baseConfig(request, sourceDir, [mdxPlugin(), react()]),
        publicDir: false,
        ssr: { noExternal: true, external: ["@mostra/server"], target: "node" },
        build: {
          ssr: join(generated, "server-entry.js"),
          outDir: join(request.outDir, "server"),
          emptyOutDir: true,
          sourcemap: true,
          rolldownOptions: {
            // The worker provides @mostra/server (WP-08); everything else is bundled.
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
  };
  return { ok: true, registry, server };
}
