import * as z from "zod";
import { ArtifactId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `artifact/create` (INTERFACES §6). */
export interface ArtifactCreateParams {
  /** The new artifact's directory, absolute. It must not exist yet, or be empty. */
  readonly dir: string;
  /** A template to start from. Templates arrive with `mostra new` (WP-26); none is the default. */
  readonly template?: string;
  /** The artifact's title. Default: the directory's name. */
  readonly title?: string;
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `artifact/create`. */
export interface ArtifactCreateResult {
  /** The generated artifact ID, written into the entry's manifest. */
  readonly artifactId: string;
  /** The artifact's directory (its real path). */
  readonly dir: string;
  /** The files written, relative to `dir`. */
  readonly files: readonly string[];
}

const params: z.ZodType<ArtifactCreateParams> = z
  .object({
    dir: z.string().regex(/^\//),
    template: z.string().min(1).exactOptional(),
    title: z.string().min(1).exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactCreateParams" });

const result: z.ZodType<ArtifactCreateResult> = z
  .object({
    artifactId: ArtifactId.schema,
    dir: z.string(),
    files: z.array(z.string()).readonly(),
  })
  .register(wireRegistry, { id: "ArtifactCreateResult" });

/**
 * `artifact/create`: writes a new artifact's entry, with a generated artifact ID in its manifest, into
 * an empty directory. The artifact appears in `artifact/list` once it is published.
 */
export const artifactCreateMethod: MethodDefinition<ArtifactCreateParams, ArtifactCreateResult> =
  defineMethod({
    method: "artifact/create",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
