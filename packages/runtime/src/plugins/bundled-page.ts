/**
 * A version's MCP App page made by Mostra's bundled exporter (D175 items 2, 3, 8), for a process
 * with no process manager of its own: a remote server's hosted homes. The exporter runs in a
 * plugin child started for the one task behind the platform's gate (D150), never in the calling
 * process (RT-02), on the version's own client files, which it parses and never runs (D117). The
 * child ends with its task, and with its parent: its IPC channel closing ends it.
 *
 * An instance makes its pages through `plugin/export` (`app/page`, the plugins module's methods),
 * where an artifact's or the home's own exporter may take the bundled one's place; a hosted home
 * has neither, so it makes its own pages from the files its operator reviews, and never keeps a
 * page anyone sent it (review findings R01-2, R01-9, R02-17).
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type AppPageResult,
  createDiagnostic,
  McpAppResourceMeta,
  mcpAppUri,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { PLUGIN_CONTRACTS } from "@mostra/protocol/plugin";
import type { Log } from "../log.ts";
import { launch } from "../platform/index.ts";
import { artifactEnvironment } from "../processes/index.ts";
import { EXPORT_METHOD, type ExportRequest, type ExportResponse } from "./child-protocol.ts";
import { childEntry, locateBundledPlugins } from "./plugins.ts";

/** The exporter Mostra carries for MCP Apps (D175 item 2). */
const MCP_APP_PACKAGE = "@mostra/plugin-mcp-app";
const MCP_APP_EXPORTER = "mcp-app";

/** The longest one page may take to make. */
const PAGE_TIMEOUT_MS = 120_000;

/** What a page is made from: the version's directory and the facts its record keeps. */
export interface BundledPageInput {
  /** The version's directory: `manifest.json`, `registry.json` and `client/`. */
  readonly versionDir: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly number: number;
  readonly publishedAt: string;
  /** This runtime's version, as the exporter's context says it. */
  readonly mostraVersion: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Log;
  /** The longest the child may take; two minutes by default. */
  readonly timeoutMs?: number;
}

function failed(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_PLUGIN_FAILED", { message }));
}

/** The bundled MCP App exporter's entry: its directory, file and export. */
async function bundledExporter(
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ dir: string; file: string; export: string }> {
  for (const dir of locateBundledPlugins(env)) {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name?: string;
      mostra?: { contributes?: { exporters?: { id: string; entry: string; export?: string }[] } };
    };
    if (pkg.name !== MCP_APP_PACKAGE) continue;
    const exporter = pkg.mostra?.contributes?.exporters?.find(
      (item) => item.id === MCP_APP_EXPORTER,
    );
    if (exporter === undefined) continue;
    return { dir, file: resolve(dir, exporter.entry), export: exporter.export ?? "default" };
  }
  throw new RpcError(
    createDiagnostic("MOSTRA_PLUGIN_EXPORTER_UNKNOWN", {
      message: `This runtime carries no ${MCP_APP_PACKAGE}, so it makes no MCP App pages.`,
    }),
  );
}

/** One file an exporter returned. */
type ExportedFile = Extract<ExportResponse, { files: unknown }>["files"][number];

/** One file of an export, as text. */
function textOf(file: ExportedFile): string {
  return "text" in file ? file.text : Buffer.from(file.base64, "base64").toString("utf8");
}

/** Makes a version's page with the bundled exporter, in a child of its own. */
export async function bundledAppPage(input: BundledPageInput): Promise<AppPageResult> {
  const exporter = await bundledExporter(input.env);
  const manifest = JSON.parse(await readFile(join(input.versionDir, "manifest.json"), "utf8")) as {
    artifactId?: unknown;
    versionId?: unknown;
    server?: unknown;
    manifest?: { title?: unknown; description?: unknown };
  };
  if (manifest.artifactId !== input.artifactId || manifest.versionId !== input.versionId) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_INTEGRITY", {
        message: `Version ${input.versionId}'s record isn't the version it names.`,
      }),
    );
  }
  const registry = await readFile(join(input.versionDir, "registry.json"), "utf8")
    .then((text) => JSON.parse(text) as Record<string, unknown>)
    .catch(() => ({}));
  const title = manifest.manifest?.title;
  const description = manifest.manifest?.description;
  const request: ExportRequest = {
    file: exporter.file,
    export: exporter.export,
    id: MCP_APP_EXPORTER,
    implemented: PLUGIN_CONTRACTS.exporter.implements,
    versionDir: input.versionDir,
    version: {
      artifactId: input.artifactId,
      versionId: input.versionId,
      number: input.number,
      title: typeof title === "string" ? title : input.artifactId,
      ...(typeof description === "string" ? { description } : {}),
      manifest: manifest.manifest ?? {},
      registry,
      server: manifest.server === true,
      publishedAt: input.publishedAt,
    },
    options: {},
    mostraVersion: input.mostraVersion,
  };
  const launched = launch(
    {
      kind: "plugin",
      command: process.execPath,
      args: [childEntry()],
      cwd: exporter.dir,
      env: artifactEnvironment(input.env),
      extra: "ipc",
    },
    (event, fields) => input.log.warn(event, fields),
  );
  // No ledger records this child: it lives for one answer, and ends with its parent.
  launched.release();
  const child = launched.process;
  child.stdout?.resume();
  child.stderr?.resume();
  const peer = new RpcPeer({ send: (message) => void child.send(message as never) });
  child.on("message", (message) => peer.receive(message));
  const ended = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) =>
      reject(failed(`The MCP App exporter's child ended (${signal ?? code}) before it answered.`)),
    );
    child.once("error", (error) =>
      reject(failed(`The MCP App exporter's child failed: ${error.message}`)),
    );
  });
  let answer: ExportResponse;
  try {
    answer = (await Promise.race([
      peer.request(EXPORT_METHOD, request as unknown as Record<string, unknown>, {
        timeoutMs: input.timeoutMs ?? PAGE_TIMEOUT_MS,
      }),
      ended,
    ])) as ExportResponse;
  } catch (problem) {
    if (problem instanceof RpcError && problem.diagnostic.code === "MOSTRA_PLUGIN_FAILED")
      throw problem;
    throw failed(
      `The MCP App of version ${input.versionId} couldn't be made: ${problem instanceof Error ? problem.message : String(problem)}`,
    );
  } finally {
    peer.close();
    await launched.end(2000, []);
  }
  if ("refused" in answer) {
    throw failed(`The MCP App exporter wasn't run: ${answer.refused.message}.`);
  }
  const error = (answer.findings as readonly { severity?: unknown; message?: unknown }[]).find(
    (finding) => finding.severity === "error",
  );
  if (error !== undefined) {
    throw failed(
      `The MCP App of version ${input.versionId} couldn't be made: ${String(error.message)}`,
    );
  }
  const page = answer.files.find((file) => file.path === "index.html");
  const described = answer.files.find((file) => file.path === "mcp-app.json");
  if (page === undefined || described === undefined) {
    throw failed("The MCP App exporter wrote no index.html and mcp-app.json.");
  }
  const resource = JSON.parse(textOf(described)) as { _meta?: { ui?: unknown } };
  const meta = McpAppResourceMeta.safeParse(resource._meta?.ui ?? {});
  if (!meta.success)
    throw failed("The MCP App exporter described its page with metadata no host reads.");
  return {
    artifactId: input.artifactId,
    uri: mcpAppUri(input.versionId),
    html: textOf(page),
    meta: meta.data,
  };
}
