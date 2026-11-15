/**
 * The messages between the supervisor and the plugin child (`child/host.ts`), over Node IPC.
 * Internal: the child and the supervisor always come from the same runtime.
 */

/** Loads entries and reports what each exports. */
export const INSPECT_METHOD = "plugin/inspect";

/** Runs an exporter. */
export const EXPORT_METHOD = "plugin/export";

/** `plugin/inspect`'s request. */
export interface InspectRequest {
  readonly entries: readonly { readonly file: string; readonly export: string }[];
}

/** What one entry exports. */
export type InspectedEntry =
  | {
      readonly ok: true;
      /** The value's `contract` property: the stamp its `define*` put on it, or `null`. */
      readonly stamp: unknown;
      readonly id?: string;
      /** A CLI command's words. */
      readonly path?: readonly string[];
      /** The names of its function-valued properties. */
      readonly functions: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

/** `plugin/export`'s request. */
export interface ExportRequest {
  readonly file: string;
  readonly export: string;
  /** The exporter's ID, as the manifest names it: the loaded definition must say the same. */
  readonly id: string;
  /** The exporter contract's versions this runtime serves: the stamp must be of their line. */
  readonly implemented: readonly string[];
  /** The version's directory in the home: its files are the export's input. */
  readonly versionDir: string;
  readonly version: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly mostraVersion: string;
}

/** `plugin/export`'s answer: the export, or why the child refused to run it. */
export type ExportResponse =
  | {
      readonly files: readonly (
        | { readonly path: string; readonly text: string }
        | { readonly path: string; readonly base64: string }
      )[];
      readonly entry?: string;
      /** What the definition says it writes. */
      readonly output: { readonly layout: "file" | "directory"; readonly extension?: string };
      readonly findings: readonly unknown[];
      readonly log: readonly string[];
    }
  | {
      /** Refused before `export` ran: not a definition this runtime serves, or bad options. */
      readonly refused: {
        readonly code:
          | "MOSTRA_PLUGIN_ENTRY_INVALID"
          | "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED"
          | "MOSTRA_PLUGIN_OPTIONS_INVALID";
        readonly message: string;
      };
    };
