/**
 * `@mostra/contract-exporter`: the contract an exporter plugin implements (D30, ROUND-3 §6.1). An
 * exporter turns one published version into files: `mostra export <artifact> --as <id>` runs it
 * in a child process of the instance, never in the supervisor, with read access to the version's
 * build and nothing else of the home.
 *
 * ```ts
 * import { defineExporter } from "@mostra/contract-exporter";
 *
 * export default defineExporter({
 *   id: "pdf",
 *   title: "PDF",
 *   output: { mediaType: "application/pdf", layout: "file", extension: ".pdf" },
 *   async export({ version, files }, { signal }) {
 *     const html = await files.readText("client/index.html");
 *     return { files: [{ path: `${version.artifactId}.pdf`, content: await render(html, signal) }] };
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */
import {
  type BaseContext,
  type ContractStamp,
  checkId,
  type FileTree,
  type Finding,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
import { VERSION } from "./version.ts";

export {
  type BaseContext,
  type Cancellation,
  CONTRIBUTION_ID,
  type ContractStamp,
  type FileTree,
  type Finding,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
export { VERSION } from "./version.ts";

/** This contract's stamp: what {@link defineExporter} puts on every exporter. */
export const CONTRACT: ContractStamp<"exporter"> = { name: "exporter", version: VERSION };

/** What an exporter writes. */
export interface ExportOutput {
  /** The media type of the result: `text/html;profile=mcp-app`, `application/pdf` … */
  readonly mediaType: string;
  /** One file (`file`), or a directory of files (`directory`). */
  readonly layout: "file" | "directory";
  /** The extension a single file takes, with its dot: `.html`. */
  readonly extension?: string;
}

/** The version an exporter turns into files. */
export interface ExportVersion {
  /** The artifact's ID (`art_…`). */
  readonly artifactId: string;
  /** The version's ID (`ver_…`). */
  readonly versionId: string;
  /** Its number, for people. */
  readonly number: number;
  /** A short name for people. */
  readonly title: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** The artifact's manifest as published (INTERFACES §2.2), as JSON. */
  readonly manifest: { readonly [key: string]: Json };
  /** What the build found (`registry.json`): fields, actions, live sources, pages. */
  readonly registry: { readonly [key: string]: Json };
  /** Whether the version has server code (actions, live sources), which runs only in Mostra. */
  readonly server: boolean;
  /** When it was published (RFC 3339). */
  readonly publishedAt: string;
}

/** What an exporter's `export` receives. */
export interface ExportInput {
  /** The version being exported. */
  readonly version: ExportVersion;
  /**
   * The version's files as the home stores them: `client/…` (the browser build), `registry.json`,
   * `lock.yaml`, `manifest.json`. Server code isn't among them.
   */
  readonly files: FileTree;
  /** The options the caller gave, checked against {@link ExporterDefinition.options}. */
  readonly options: { readonly [key: string]: Json };
}

/** What an exporter's calls receive besides their input. */
export interface ExportContext extends BaseContext {}

/** One file an exporter wrote. */
export interface ExportedFile {
  /** Its path inside the export: relative, `/`-separated, never leaving it. */
  readonly path: string;
  /** Its content: text as UTF-8, or bytes. */
  readonly content: string | Uint8Array;
}

/** What an exporter's `export` returns. */
export interface ExportResult {
  /** The files of the export. A `file` exporter returns exactly one. */
  readonly files: readonly ExportedFile[];
  /** For a `directory` export, the file a person opens first (`index.html`). */
  readonly entry?: string;
  /** What the exporter noticed, reported beside the export (a feature it couldn't carry). */
  readonly findings?: readonly Finding[];
}

/** What a plugin writes to define an exporter. */
export interface ExporterDefinition {
  /** The exporter's ID, what `--as` names: `mcp-app`, `pdf`. Unique among an artifact's plugins. */
  readonly id: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** What it writes: a media type and whether one file or a directory. */
  readonly output: ExportOutput;
  /** A JSON Schema of the options it takes; without one it takes none. */
  readonly options?: JsonSchema;
  /** Turns the version into files. */
  export(input: ExportInput, context: ExportContext): Promise<ExportResult>;
}

/** An exporter, as {@link defineExporter} returns it: the definition with its stamp. */
export interface Exporter extends ExporterDefinition {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"exporter">;
}

/**
 * Defines an exporter: checks its ID and output, and stamps it with this contract's name and
 * version, so Mostra's loader knows what it is without trusting the manifest alone.
 *
 * @throws TypeError when the ID or the output isn't valid.
 */
export function defineExporter<const T extends ExporterDefinition>(
  definition: T,
): T & { readonly contract: ContractStamp<"exporter"> } {
  checkId("defineExporter", definition.id);
  const { mediaType, layout } = definition.output ?? ({} as Partial<ExportOutput>);
  if (typeof mediaType !== "string" || mediaType === "") {
    throw new TypeError("defineExporter needs output.mediaType, such as text/html.");
  }
  if (layout !== "file" && layout !== "directory") {
    throw new TypeError('defineExporter needs output.layout, "file" or "directory".');
  }
  if (typeof definition.export !== "function") {
    throw new TypeError("defineExporter needs an export function.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is an exporter stamped with a version of this contract this copy serves. */
export function isExporter(value: unknown): value is Exporter {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { export?: unknown }).export === "function"
  );
}
