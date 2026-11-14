/**
 * What every contract shares (D30, ROUND-3 §6.1): the stamp, contribution IDs and the types the
 * Node.js-side contracts pass. Every `@mostra/contract-*` package carries this file unchanged (a
 * test compares them), so no contract package depends on another or on Mostra's runtime, and a
 * plugin carries only the contracts it implements.
 */

/**
 * What a `define*` blueprint puts on every definition it returns, as its `contract` property: the
 * contract's name and the version of the contract package the plugin was built against. Mostra's
 * loader reads the stamp from the loaded object itself, so it never has to trust a manifest alone.
 */
export interface ContractStamp<Name extends string = string> {
  /** The contract's name: `embed-engine`, `exporter`, `verify-check`, `anchor-provider` … */
  readonly name: Name;
  /** The contract package's version the definition was stamped with: `0.1.0`. */
  readonly version: string;
}

/** `major.minor.patch` of a release version, or `undefined` for anything else. */
function parts(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Whether a stamp names contract `name` at a version a reader of version `version` serves. Within
 * a contract's line changes are additive only (0.x: within a minor; from 1.0: within a major), so
 * a reader serves every stamp of its own line up to its own version, and nothing newer: a newer
 * stamp may rely on something this reader doesn't have.
 */
export function stampCompatible(stamp: unknown, name: string, version: string): boolean {
  if (typeof stamp !== "object" || stamp === null) return false;
  const { name: stampName, version: stampVersion } = stamp as Record<string, unknown>;
  if (stampName !== name || typeof stampVersion !== "string") return false;
  const theirs = parts(stampVersion);
  const ours = parts(version);
  if (theirs === undefined || ours === undefined) return false;
  if (theirs[0] !== ours[0]) return false;
  if (ours[0] === 0) return theirs[1] === ours[1] && theirs[2] <= ours[2];
  return theirs[1] < ours[1] || (theirs[1] === ours[1] && theirs[2] <= ours[2]);
}

/** The pattern every contribution ID matches: lower case, digits, `.`, `_` and `-`, 1 to 64. */
export const CONTRIBUTION_ID: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Throws a `TypeError` naming the blueprint when `id` isn't a contribution ID. */
export function checkId(blueprint: string, id: unknown): void {
  if (typeof id !== "string" || !CONTRIBUTION_ID.test(id)) {
    throw new TypeError(
      `${blueprint} needs an id of lower-case letters, digits, ".", "_" and "-" (1 to 64), not ${JSON.stringify(id)}.`,
    );
  }
}

/** A JSON value: what crosses between Mostra and a plugin's Node.js code. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

/** A JSON Schema (2020-12) object, describing a contribution's options or configuration. */
export type JsonSchema = { readonly [key: string]: Json };

/**
 * The part of an `AbortSignal` a contribution reads: Mostra passes a real one, so a contribution
 * may hand it to `fetch` or any other API that takes a signal.
 */
export interface Cancellation {
  /** Whether the work was cancelled. */
  readonly aborted: boolean;
  /** Why, once it was. */
  readonly reason?: unknown;
  /** Calls `listener` once the work is cancelled. */
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  /** Stops calling `listener`. */
  removeEventListener(type: "abort", listener: () => void): void;
}

/**
 * Read access to a tree of files: a version's build, an artifact's source. Paths are relative,
 * `/`-separated and never leave the tree.
 */
export interface FileTree {
  /** Every file's path, sorted. */
  list(): Promise<readonly string[]>;
  /** A file's bytes; rejects for a path the tree doesn't hold. */
  read(path: string): Promise<Uint8Array>;
  /** A file's text, as UTF-8. */
  readText(path: string): Promise<string>;
}

/**
 * What a contribution reports about its input, as Mostra reports diagnostics (INTERFACES §13): a
 * stable code of the contribution's own (upper case, digits and `_`), a severity (`error` only for
 * a definite failure), what was found and what to do.
 */
export interface Finding {
  /** The contribution's own code: `MISALIGNED_BORDER`. Mostra names the contribution beside it. */
  readonly code: string;
  /** How serious it is: `error` fails the check, `warning` and `hint` inform. */
  readonly severity: "error" | "warning" | "hint";
  /** What was found. */
  readonly message: string;
  /** What to do, in one sentence. */
  readonly hint?: string;
  /** Where, in the tree the contribution read. */
  readonly location?: { readonly file: string; readonly line: number; readonly column: number };
}

/** What every Node.js-side contribution's calls receive besides their input. */
export interface BaseContext {
  /** Fires when Mostra no longer needs the answer (a cancel, a time limit, a stop). */
  readonly signal: Cancellation;
  /** Writes a line to the log Mostra keeps of this call. */
  log(message: string): void;
  /** The version of the Mostra runtime calling. */
  readonly mostraVersion: string;
}
