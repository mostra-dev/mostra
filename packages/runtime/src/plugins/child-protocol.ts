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
  /** The version's directory in the home: its files are the export's input. */
  readonly versionDir: string;
  readonly version: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly mostraVersion: string;
}

/** `plugin/export`'s answer. */
export interface ExportResponse {
  readonly files: readonly (
    | { readonly path: string; readonly text: string }
    | { readonly path: string; readonly base64: string }
  )[];
  readonly entry?: string;
  readonly findings: readonly unknown[];
  readonly log: readonly string[];
}
