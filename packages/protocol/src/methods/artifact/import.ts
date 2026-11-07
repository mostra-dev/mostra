import * as z from "zod";
import { PublishReceipt } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `artifact/import` (INTERFACES §15). */
export interface ArtifactImportParams {
  /** A bundle `artifact/export` wrote: its directory or its `.tar.zst` archive, as an absolute path. */
  readonly bundle: string;
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/**
 * The result of `artifact/import`: the receipt of the version it made, or found (`reused`), with
 * the bundle's artifact and version IDs.
 */
export type ArtifactImportResult = PublishReceipt;

const params: z.ZodType<ArtifactImportParams> = z
  .object({
    bundle: z.string().min(1),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactImportParams" });

/**
 * `artifact/import`: makes a portable bundle a published version of this home (RM-01; the CLI's
 * `mostra run <bundle>`): the same artifact ID, version ID and digests, checked against the
 * bundle's files before anything is kept. Its server code runs here, against the bundle's lockfile.
 */
export const artifactImportMethod: MethodDefinition<ArtifactImportParams, ArtifactImportResult> =
  defineMethod({
    method: "artifact/import",
    direction: "client-to-instance",
    mutating: true,
    params,
    result: PublishReceipt,
  });
