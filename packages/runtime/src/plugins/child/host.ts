/**
 * The plugin child's entry (`dist/plugins/child/host.js`, D30): the process that loads a plugin's
 * Node.js modules, so the supervisor never runs plugin code (RT-02). The supervisor starts one per
 * task through the process manager, in the plugin's package directory with the artifact
 * environment, and stops it after the answer. It exits with its supervisor.
 *
 * - `plugin/inspect` loads entries and answers what each exports: the stamp `define*` put on it,
 *   and its ID, so the supervisor checks contracts without trusting the manifest alone.
 * - `plugin/export` loads an exporter, checks it is one this runtime serves and that the options
 *   fit its schema, then runs it on a version's files and answers the files it returned.
 */
import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { checkArtifactPath } from "@mostra/protocol";
import { stampServed } from "@mostra/protocol/plugin";
import * as z from "zod";
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

/** `inner` is `outer` or inside it (both real paths), judged by whole segments. */
function isInside(outer: string, inner: string): boolean {
  const from = relative(outer, inner);
  return from === "" || (from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from));
}

/** Whether a path inside the version names its server code (case-folded: some systems fold). */
const isServer = (relativePath: string): boolean =>
  (relativePath.split(/[/\\]/)[0] ?? "").toLowerCase() === "server";

/**
 * A version's files, read-only, as the exporter contract's `FileTree`: every file but its server
 * code. A path is judged after it is normalized and its links resolved, so `./server/x`,
 * `client/../server/x` and `SERVER/x` name server code too.
 */
function tree(root: string) {
  const file = async (path: string): Promise<string> => {
    const check = checkArtifactPath(path);
    if (!check.ok) throw new Error(`${path} isn't a file of the version.`);
    if (isServer(check.path)) throw new Error("Server code isn't part of an export's input.");
    const realRoot = await realpath(root);
    const full = await realpath(join(root, ...check.path.split("/")));
    if (!isInside(realRoot, full)) throw new Error(`${path} isn't a file of the version.`);
    if (isServer(relative(realRoot, full))) {
      throw new Error("Server code isn't part of an export's input.");
    }
    return full;
  };
  const walk = async (dir: string, prefix: string): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (prefix === "" && isServer(entry.name)) continue;
      if (entry.isDirectory()) found.push(...(await walk(join(dir, entry.name), path)));
      else if (entry.isFile()) found.push(path);
    }
    return found;
  };
  return {
    list: async () => (await walk(root, "")).sort(),
    read: async (path: string) => new Uint8Array(await readFile(await file(path))),
    readText: async (path: string) => readFile(await file(path), "utf8"),
  };
}

/** Why an options schema refuses `options`, in one line. */
function optionProblems(schema: unknown, options: Readonly<Record<string, unknown>>): string {
  const parsed = z
    .fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
    .safeParse(options);
  if (parsed.success) return "";
  return parsed.error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "options"}: ${issue.message}`)
    .join("; ");
}

async function runExport(request: ExportRequest): Promise<ExportResponse> {
  const value = await load(request.file, request.export);
  const refuse = (
    code:
      | "MOSTRA_PLUGIN_ENTRY_INVALID"
      | "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED"
      | "MOSTRA_PLUGIN_OPTIONS_INVALID",
    message: string,
  ): ExportResponse => ({ refused: { code, message } });
  if (typeof value !== "object" || value === null) {
    return refuse("MOSTRA_PLUGIN_ENTRY_INVALID", "its entry exports no exporter definition");
  }
  const exporter = value as {
    contract?: unknown;
    id?: unknown;
    output?: { layout?: unknown; extension?: unknown };
    options?: unknown;
    export?: unknown;
  };
  const stamp = exporter.contract as { name?: unknown; version?: unknown } | undefined;
  if (stamp?.name !== "exporter" || typeof exporter.export !== "function") {
    return refuse(
      "MOSTRA_PLUGIN_ENTRY_INVALID",
      "its entry exports no stamped exporter definition",
    );
  }
  if (!stampServed(stamp, "exporter", request.implemented)) {
    return refuse(
      "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED",
      `it was built with @mostra/contract-exporter ${String(stamp.version)}; this Mostra serves ${request.implemented.join(", ")}`,
    );
  }
  if (exporter.id !== request.id) {
    return refuse(
      "MOSTRA_PLUGIN_ENTRY_INVALID",
      `its definition is "${String(exporter.id)}", not "${request.id}" as the manifest says`,
    );
  }
  const layout = exporter.output?.layout === "file" ? "file" : "directory";
  const extension =
    typeof exporter.output?.extension === "string" ? exporter.output.extension : undefined;
  if (exporter.options === undefined) {
    if (Object.keys(request.options).length > 0) {
      return refuse(
        "MOSTRA_PLUGIN_OPTIONS_INVALID",
        `it takes no options, and was given ${Object.keys(request.options).join(", ")}`,
      );
    }
  } else {
    let problems: string;
    try {
      problems = optionProblems(exporter.options, request.options);
    } catch (error) {
      return refuse(
        "MOSTRA_PLUGIN_ENTRY_INVALID",
        `its options aren't a JSON Schema Mostra reads (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (problems !== "") return refuse("MOSTRA_PLUGIN_OPTIONS_INVALID", problems);
  }
  const controller = new AbortController();
  const lines: string[] = [];
  const result = (await (
    exporter.export as (
      input: unknown,
      context: unknown,
    ) => Promise<{
      files?: readonly { path: unknown; content: unknown }[];
      entry?: unknown;
      findings?: unknown;
    }>
  ).call(
    exporter,
    { version: request.version, files: tree(request.versionDir), options: request.options },
    {
      signal: controller.signal,
      log: (message: string) => {
        if (lines.length < 1000) lines.push(String(message).slice(0, 4000));
      },
      mostraVersion: request.mostraVersion,
    },
  )) as
    | {
        files?: readonly { path: unknown; content: unknown }[];
        entry?: unknown;
        findings?: unknown;
      }
    | undefined;
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
    output: { layout, ...(extension !== undefined ? { extension } : {}) },
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
