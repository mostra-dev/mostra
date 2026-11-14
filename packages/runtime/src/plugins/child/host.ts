/**
 * The plugin child's entry (`dist/plugins/child/host.js`, D30): the process that loads a plugin's
 * Node.js modules, so the supervisor never runs plugin code (RT-02). The supervisor starts one per
 * task through the process manager, in the plugin's package directory with the artifact
 * environment, and stops it after the answer. It exits with its supervisor.
 *
 * - `plugin/inspect` loads entries and answers what each exports: the stamp `define*` put on it,
 *   and its ID, so the supervisor checks contracts without trusting the manifest alone.
 * - `plugin/export` runs an exporter on a version's files and answers the files it returned.
 */
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { connectToSupervisor } from "../../processes/index.ts";
import {
  EXPORT_METHOD,
  type ExportRequest,
  type ExportResponse,
  INSPECT_METHOD,
  type InspectedEntry,
  type InspectRequest,
} from "../child-protocol.ts";

/** A module's export, by name (`default` for the default export). */
async function load(file: string, name: string): Promise<unknown> {
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return module[name];
}

async function inspect(request: InspectRequest): Promise<InspectedEntry[]> {
  const answers: InspectedEntry[] = [];
  for (const entry of request.entries) {
    try {
      const value = await load(entry.file, entry.export);
      if (typeof value !== "object" || value === null) {
        answers.push({
          ok: false,
          error: `exports ${entry.export === "default" ? "no default" : `no ${entry.export}`} definition (found ${value === null ? "null" : typeof value})`,
        });
        continue;
      }
      const record = value as Record<string, unknown>;
      answers.push({
        ok: true,
        stamp: record["contract"] ?? null,
        ...(typeof record["id"] === "string" ? { id: record["id"] } : {}),
        ...(Array.isArray(record["path"])
          ? { path: (record["path"] as unknown[]).map((word) => String(word)) }
          : {}),
        functions: Object.keys(record).filter((key) => typeof record[key] === "function"),
      });
    } catch (error) {
      answers.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return answers;
}

/** A version's files, read-only, as the exporter contract's `FileTree`. */
function tree(root: string) {
  const inside = async (path: string): Promise<string> => {
    const full = await realpath(join(root, ...path.split("/")));
    const from = relative(await realpath(root), full);
    if (from.startsWith("..") || from.split(sep).includes("..")) {
      throw new Error(`${path} isn't a file of the version.`);
    }
    return full;
  };
  const walk = async (dir: string, prefix: string): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) found.push(...(await walk(join(dir, entry.name), path)));
      else if (entry.isFile()) found.push(path);
    }
    return found;
  };
  return {
    list: async () => (await walk(root, "")).filter((path) => !path.startsWith("server/")).sort(),
    read: async (path: string) => {
      if (path.startsWith("server/"))
        throw new Error("Server code isn't part of an export's input.");
      return new Uint8Array(await readFile(await inside(path)));
    },
    readText: async (path: string) => {
      if (path.startsWith("server/"))
        throw new Error("Server code isn't part of an export's input.");
      return readFile(await inside(path), "utf8");
    },
  };
}

async function runExport(request: ExportRequest): Promise<ExportResponse> {
  const exporter = (await load(request.file, request.export)) as {
    export(
      input: unknown,
      context: unknown,
    ): Promise<{
      files?: readonly { path: unknown; content: unknown }[];
      entry?: unknown;
      findings?: unknown;
    }>;
  };
  const controller = new AbortController();
  const lines: string[] = [];
  const result = await exporter.export(
    { version: request.version, files: tree(request.versionDir), options: request.options },
    {
      signal: controller.signal,
      log: (message: string) => {
        if (lines.length < 1000) lines.push(String(message).slice(0, 4000));
      },
      mostraVersion: request.mostraVersion,
    },
  );
  const files = (result?.files ?? []).map((file) => {
    if (typeof file.path !== "string") throw new Error("An exported file has no path.");
    if (typeof file.content === "string") return { path: file.path, text: file.content };
    if (file.content instanceof Uint8Array) {
      return { path: file.path, base64: Buffer.from(file.content).toString("base64") };
    }
    throw new Error(`${file.path}'s content is neither text nor bytes.`);
  });
  return {
    files,
    ...(typeof result?.entry === "string" ? { entry: result.entry } : {}),
    findings: Array.isArray(result?.findings) ? (result.findings as unknown[]) : [],
    log: lines,
  };
}

connectToSupervisor({
  onRequest: async (method, params) => {
    if (method === INSPECT_METHOD) return inspect(params as unknown as InspectRequest);
    if (method === EXPORT_METHOD) return runExport(params as unknown as ExportRequest);
    throw new Error(`The plugin child doesn't serve ${method}.`);
  },
});
