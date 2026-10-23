/**
 * `mostra dev`'s server (D140 item 12, VR-08): Vite in middleware mode over the dev root, whose
 * `source/` the supervisor keeps a mirror of the artifact's source, with the SPA build's own
 * plugins, so a page in dev is built as its published version would be. It listens on a loopback
 * port the operating system picks and answers only requests that carry the session's secret,
 * which only the dev sandbox's gateway sends: a browser reaches it only through the gateway's
 * route table (Host, Origin, session), never directly, and never through a capability URL of the
 * home. Its HMR WebSocket is served through the same check, on Vite's own token and allowed hosts.
 *
 * When the source changes, Vite updates client modules in place (HMR). When the artifact has
 * server code, the server bundle and `registry.json` are built again and the supervisor told
 * (`builder/dev.server`); once it runs the new bundle, it asks the child to reload every page.
 * When `pages/`, `"use server"` modules or `live.ts` change, the generated entry is written again.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { parseSync } from "oxc-parser";
import { build, createServer, type Plugin, type ViteDevServer } from "vite";
import { linkDirectory, pathKey } from "../../platform/index.ts";
import type { SupervisorConnection } from "../../processes/index.ts";
import {
  DEV_SECRET_HEADER,
  DEV_SERVER_NOTIFICATION,
  DEV_UPDATE_NOTIFICATION,
  type DevChange,
  type DevReady,
  type DevRequest,
  type DevServerBuild,
  LIVE_DECLARATION,
  type ServerFunctionEntry,
  STAGING_FILES,
  type VersionRegistry,
} from "../types.ts";
import { type BuildInputs, confinePlugin, mdxPlugin, serverClientStubPlugin } from "./plugins.ts";
import { type ScanResult, scanArtifact } from "./scan.ts";
import {
  baseConfig,
  clientEntry,
  diagnose,
  GENERATED,
  html,
  packageRoots,
  serverEntry,
} from "./spa.ts";

/** A running dev server. */
export interface DevServer {
  readonly ready: DevReady;
  /** The supervisor changed these files of the mirror: update the pages, rebuild what depends on them. */
  changed(changes: readonly DevChange[]): Promise<void>;
  /** Tells every page to load again. */
  reload(): void;
  close(): Promise<void>;
}

/** The custom HMR event a dev page sends with the time it was served. */
const LOADED_EVENT = "mostra:dev.loaded";

/** Whether a request carries the session's secret (compared in constant time). */
function hasSecret(headers: IncomingMessage["headers"], secret: string): boolean {
  const given = headers[DEV_SECRET_HEADER];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the server entry depends on: which server modules, functions and live sources exist. */
function serverShape(scan: ScanResult): string {
  return JSON.stringify({
    modules: [...scan.serverModules].map(([module, entries]) => [module, entries.map((e) => e.id)]),
    live: scan.hasLive,
  });
}

/** What the client entry depends on: the pages. */
const pageShape = (scan: ScanResult): string => JSON.stringify(scan.pages);

/** Starts the dev server for `request`. */
export async function startDev(
  request: DevRequest,
  supervisor: SupervisorConnection,
): Promise<DevServer> {
  const root = request.root;
  const sourceDir = join(root, "source");
  const generated = join(root, GENERATED);
  await mkdir(generated, { recursive: true });
  for (const [name, text] of Object.entries(STAGING_FILES)) await writeFile(join(root, name), text);
  await rm(join(root, "node_modules"), { force: true, recursive: true });
  await linkDirectory(request.nodeModules, join(root, "node_modules"));
  await writeFile(join(generated, "styles.css"), `@import "tailwindcss" source("../source");\n`);
  await mkdir(request.outDir, { recursive: true });
  // Vite's pre-bundled dependencies live in the session's root (`cacheDir` below); they are
  // packages the build may import, as the layout they were bundled from is.
  const viteCache = join(root, ".vite");
  const inputs: BuildInputs = {
    sourceDir,
    generatedDir: generated,
    packageRoots: [...(await packageRoots(request.nodeModules)), viteCache],
  };

  let scan = await scanArtifact(sourceDir);
  // The client stubs read this map on every transform, so a new "use server" export is stubbed
  // once the map is refreshed and the module invalidated.
  const serverModules = new Map<string, readonly ServerFunctionEntry[]>();
  const refreshServerModules = (): void => {
    serverModules.clear();
    for (const [module, entries] of scan.serverModules)
      serverModules.set(pathKey(join(sourceDir, module)), entries);
  };
  refreshServerModules();
  const writeEntry = async (): Promise<void> => {
    await writeFile(join(generated, "entry.js"), clientEntry(request, scan));
    if (scan.hasLive) await writeFile(join(generated, "mostra-env.d.ts"), LIVE_DECLARATION);
  };
  await writeEntry();
  await writeFile(
    join(generated, "dev-loaded.js"),
    `const served = Number(document.querySelector('meta[name="mostra-dev-served"]')?.content);\nimport.meta.hot?.send(${JSON.stringify(LOADED_EVENT)}, served);\n`,
  );
  const indexHtml = html(request.manifest.title, request.versionId);

  /** Builds the server bundle and `registry.json` into the dev version's directory. */
  let lastBundle = "";
  const buildServer = async (): Promise<DevServerBuild> => {
    if (scan.diagnostics.length > 0 || scan.unparsed.length > 0)
      return { ok: false, diagnostics: [...scan.diagnostics, ...scan.unparsed] };
    const server = scan.serverModules.size > 0 || scan.hasLive;
    if (server) {
      await writeFile(join(generated, "server-entry.js"), serverEntry(scan));
      try {
        await build({
          ...baseConfig({ stagingDir: root }, sourceDir, [
            confinePlugin(inputs),
            mdxPlugin(),
            react(),
          ]),
          mode: "development",
          publicDir: false,
          ssr: { external: ["@mostra/server"], target: "node" },
          build: {
            ssr: join(generated, "server-entry.js"),
            outDir: join(request.outDir, "server"),
            emptyOutDir: true,
            sourcemap: true,
            rolldownOptions: {
              external: ["@mostra/server"],
              output: { entryFileNames: "entry.mjs", format: "es" },
            },
          },
        });
      } catch (error) {
        return { ok: false, diagnostics: [diagnose(error, sourceDir)] };
      }
    } else {
      await rm(join(request.outDir, "server"), { recursive: true, force: true });
    }
    lastBundle = await bundleDigest(join(request.outDir, "server"));
    const registry: VersionRegistry = {
      schemaVersion: 1,
      entry: request.entry,
      actions: [...scan.serverModules.values()].flat(),
      liveSources: scan.liveSources,
      pages: scan.pages,
      terminals: Object.keys(request.manifest.terminals ?? {}).sort(),
      demos: Object.keys(request.manifest.demos ?? {}).sort(),
      // Dev serves whatever the source names; nothing is ever orphaned in a preview.
      fields: { ...scan.fields, open: true, openReasons: [{ reason: "a development preview" }] },
    };
    await writeFile(
      join(request.outDir, "registry.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
    );
    return { ok: true, registry, server };
  };

  const firstBuild = await buildServer();

  // Vite's HMR WebSocket attaches to this server, which never listens: the real server hands it
  // only upgrades that carry the secret.
  const hmrServer = createHttpServer();
  const vite: ViteDevServer = await createServer({
    ...baseConfig({ stagingDir: root }, sourceDir, [
      confinePlugin(inputs),
      mdxPlugin(),
      serverClientStubPlugin(serverModules, sourceDir),
      manifestExportPlugin(join(sourceDir, request.entry)),
      react(),
      tailwind(),
    ]),
    mode: "development",
    appType: "custom",
    // Vite's pre-bundled dependencies stay in the session's own root, never in the shared warm
    // set or a lock layout behind `node_modules`, which other sessions and builds read.
    cacheDir: viteCache,
    publicDir: join(sourceDir, "public"),
    server: {
      middlewareMode: true,
      ws: { server: hmrServer },
      // Vite watches nothing: the supervisor, which keeps the mirror, says what changed (and a
      // watcher would walk the whole package layout behind node_modules).
      watch: null,
      // Requests arrive from the gateway's artifact origin on loopback; any other Host (a DNS
      // rebinding) is refused by Vite as well as by the gateway.
      allowedHosts: ["127.0.0.1", "localhost"],
      cors: false,
      fs: { strict: true, allow: [root, ...inputs.packageRoots] },
    },
    optimizeDeps: { entries: [`${GENERATED}/entry.js`] },
  });

  // A page reports when it was served once its modules have run; one served before the last
  // change (that update reached it before its modules accepted updates, or before its socket
  // opened, as after a new dev server) loads again. Vite's own client drops such updates. Times,
  // not a counter, so a page a previous dev server of the session served compares too.
  let changedAt = 0;
  vite.ws.on(LOADED_EVENT, (served: unknown, client) => {
    if (typeof served === "number" && served <= changedAt) client.send({ type: "full-reload" });
  });
  const serveHtml = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The time is a meta tag the report module reads: an inline module would be cached by Vite
    // (and by the browser, behind its ETag) with the first page's time. The report runs after the
    // entry's module graph has run (module scripts run in document order, each after its
    // imports), so every module that accepts updates has said so: an update that arrived before
    // that was dropped by Vite's client, and the report makes the page load again.
    const served = `<meta name="mostra-dev-served" content="${Date.now()}" />`;
    const report = `<script type="module" src="/${GENERATED}/dev-loaded.js"></script>`;
    const page = await vite.transformIndexHtml(
      req.url ?? "/",
      indexHtml
        .replace("</head>", `  ${served}\n  </head>`)
        .replace("</body>", `  ${report}\n  </body>`),
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(page);
  };
  const http = createHttpServer((req, res) => {
    if (!hasSecret(req.headers, request.secret)) {
      res.writeHead(403).end();
      return;
    }
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const navigation =
      req.headers["sec-fetch-dest"] === "document" ||
      req.headers["sec-fetch-dest"] === "iframe" ||
      path === "/" ||
      path === "/index.html";
    if ((req.method === "GET" || req.method === "HEAD") && navigation) {
      serveHtml(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
      });
      return;
    }
    vite.middlewares(req, res, () => {
      // A deep link inside the artifact's routes gets its page (D57).
      if (req.headers.accept?.includes("text/html")) {
        serveHtml(req, res).catch(() => res.writeHead(500).end());
        return;
      }
      res.writeHead(404).end();
    });
  });
  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!hasSecret(req.headers, request.secret)) {
      socket.destroy();
      return;
    }
    hmrServer.emit("upgrade", req, socket, head);
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const port = (http.address() as { port: number }).port;

  // Changes in the mirror: Vite updates the client modules (HMR); rescan; write the entry again
  // when the pages changed; rebuild the server bundle when the artifact has server code.
  let running: Promise<void> = Promise.resolve();
  const settle = async (changes: readonly DevChange[]): Promise<void> => {
    const files = changes.map((change) => change.file);
    changedAt = Date.now();
    for (const change of changes)
      vite.watcher.emit(change.kind, join(sourceDir, ...change.file.split("/")));
    const before = { pages: pageShape(scan), server: serverShape(scan) };
    scan = await scanArtifact(sourceDir);
    const serverChanged = before.server !== serverShape(scan);
    const pagesChanged = before.pages !== pageShape(scan);
    if (pagesChanged || serverChanged) {
      refreshServerModules();
      await writeEntry();
      // Vite watches nothing, so it hears of the rewritten entry from here: the route table
      // (or the server stubs) it imports changed, and every page loads it again.
      vite.watcher.emit("change", join(generated, "entry.js"));
      if (serverChanged) vite.moduleGraph.invalidateAll();
    }
    if (pagesChanged && !serverChanged) vite.ws.send({ type: "full-reload" });
    const hasServer = scan.serverModules.size > 0 || scan.hasLive || scan.unparsed.length > 0;
    if (hasServer || serverChanged) {
      // The server bundle is built again; only a bundle that changed restarts the worker and
      // loads the pages again. A client edit stays a hot update.
      const before = lastBundle;
      const built = await buildServer();
      if (!built.ok || serverChanged || lastBundle !== before) {
        supervisor.notify(DEV_SERVER_NOTIFICATION, { build: built, files });
        return;
      }
    }
    supervisor.notify(DEV_UPDATE_NOTIFICATION, { files });
  };
  return {
    ready: { port, build: firstBuild },
    changed: (changes) => {
      running = running.then(() => settle(changes)).catch(() => {});
      return running;
    },
    reload: () => vite.ws.send({ type: "full-reload" }),
    close: async () => {
      await running;
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
      await vite.close();
    },
  };
}

/**
 * Keeps React Fast Refresh working on the entry (D140 item 12): the entry exports its manifest
 * (`export const artifact = defineArtifact(…)`, D51), and a module that exports anything but
 * components can't be refreshed in place, so every edit of a single-file artifact would load the
 * page again. In dev only, the `export` keyword of that one declaration becomes spaces (positions
 * and source maps stay exact); nothing imports the manifest at run time, since Mostra reads it
 * statically.
 */
export function manifestExportPlugin(entryFile: string): Plugin {
  return {
    name: "mostra:dev-manifest-export",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== entryFile || !/\.[jt]sx$/.test(entryFile)) return null;
      const parsed = parseSync(entryFile, code, {
        lang: entryFile.endsWith(".tsx") ? "tsx" : "jsx",
      });
      if (parsed.errors.length > 0) return null;
      for (const statement of parsed.program.body) {
        if (statement.type !== "ExportNamedDeclaration") continue;
        const declaration = statement.declaration;
        if (declaration?.type !== "VariableDeclaration" || declaration.declarations.length !== 1)
          continue;
        const id = declaration.declarations[0]?.id;
        if (id?.type !== "Identifier" || id.name !== "artifact") continue;
        const blank = " ".repeat(declaration.start - statement.start);
        return {
          code: code.slice(0, statement.start) + blank + code.slice(declaration.start),
          map: null,
        };
      }
      return null;
    },
  };
}

/** A digest of the server bundle's files, to tell a rebuild that changed nothing. */
export async function bundleDigest(dir: string): Promise<string> {
  const hash = createHash("sha256");
  let names: string[];
  try {
    names = (await readdir(dir, { recursive: true })).sort();
  } catch {
    return "";
  }
  for (const name of names) {
    if (name.endsWith(".map")) continue;
    const text = await readFile(join(dir, name)).catch(() => undefined);
    if (text === undefined) continue;
    hash.update(name).update("\u0000").update(text).update("\u0000");
  }
  return hash.digest("hex");
}
