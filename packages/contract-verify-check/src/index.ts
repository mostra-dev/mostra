/**
 * `@mostra/contract-verify-check`: the contract a verify check implements (D30, D29, ROUND-3
 * §6.1). `verify` runs a plugin's checks beside its own and reports their findings in its one
 * verdict, so an agent fixes a plugin's concern (a terminal frame's misaligned border, a deck's
 * missing notes) through the same loop. A check runs in a child process of the instance, never in
 * the supervisor, with read access to the artifact's snapshot and, from the `build` stage, its
 * build.
 *
 * ```ts
 * import { defineVerifyCheck } from "@mostra/contract-verify-check";
 *
 * export default defineVerifyCheck({
 *   id: "frames",
 *   stage: "source",
 *   files: ["**\/*.cast"],
 *   async run({ source }) {
 *     const findings = [];
 *     for (const path of await source.list()) {
 *       if (path.endsWith(".cast") && !(await source.readText(path)).startsWith("{")) {
 *         findings.push({ code: "CAST_HEADER", severity: "error", message: `${path} has no asciicast header.`,
 *           location: { file: path, line: 1, column: 1 } });
 *       }
 *     }
 *     return { findings };
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

/** This contract's stamp: what {@link defineVerifyCheck} puts on every check. */
export const CONTRACT: ContractStamp<"verify-check"> = { name: "verify-check", version: VERSION };

/** The pattern of a finding's code: upper case, digits and `_`, 1 to 64. */
export const FINDING_CODE: RegExp = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * When a check runs: `source` (on the snapshot, before the build) or `build` (once the build
 * succeeded, with its files too). A later release may add stages that see the rendered page.
 */
export type VerifyStage = "source" | "build" | (string & {});

/** What a check's `run` receives. */
export interface VerifyCheckInput {
  /** The artifact's source as `verify` snapshotted it. */
  readonly source: FileTree;
  /** At the `build` stage, the version as built: `client/…`, `registry.json`, `manifest.json`. */
  readonly build?: FileTree;
  /** The artifact's manifest (INTERFACES §2.2), as JSON. */
  readonly manifest: { readonly [key: string]: Json };
}

/** What a check's calls receive besides their input. */
export interface VerifyCheckContext extends BaseContext {}

/** What a check's `run` returns. */
export interface VerifyCheckResult {
  /** What it found; nothing means it passed. */
  readonly findings: readonly Finding[];
}

/** What a plugin writes to define a verify check. */
export interface VerifyCheckDefinition {
  /** The check's ID. Unique among an artifact's plugins. */
  readonly id: string;
  /** A short name for people. */
  readonly title?: string;
  /** One sentence on what it does, for people and agents. */
  readonly description?: string;
  /** When it runs; `source` when absent. */
  readonly stage?: VerifyStage;
  /**
   * Globs of the source files it concerns (`**\/*.cast`): `verify` runs it only when one matches.
   * Without them it always runs.
   */
  readonly files?: readonly string[];
  /** Checks the artifact. */
  run(input: VerifyCheckInput, context: VerifyCheckContext): Promise<VerifyCheckResult>;
}

/** A verify check, as {@link defineVerifyCheck} returns it: the definition with its stamp. */
export interface VerifyCheck extends VerifyCheckDefinition {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"verify-check">;
}

/**
 * Defines a verify check: checks its ID and stamps it with this contract's name and version.
 *
 * @throws TypeError when the ID or `run` isn't valid.
 */
export function defineVerifyCheck<const T extends VerifyCheckDefinition>(
  definition: T,
): T & { readonly contract: ContractStamp<"verify-check"> } {
  checkId("defineVerifyCheck", definition.id);
  if (typeof definition.run !== "function") {
    throw new TypeError("defineVerifyCheck needs a run function.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is a verify check stamped with a version of this contract this copy serves. */
export function isVerifyCheck(value: unknown): value is VerifyCheck {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { run?: unknown }).run === "function"
  );
}
