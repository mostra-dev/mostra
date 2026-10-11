import * as z from "zod";
import { PublishReceipt, SourceRef } from "../../artifact.ts";
import { SubmissionPolicy } from "../../manifest.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `artifact/publish` (INTERFACES §6). */
export interface ArtifactPublishParams {
  /** What to publish: a source path, or an artifact ID meaning the path it was last published from. */
  readonly source: SourceRef;
  /**
   * Publish even when `verify` reports errors, recording their codes in the version (D41). The
   * verify gate arrives with WP-09; until then publish runs no verify and `force` changes nothing.
   */
  readonly force?: boolean;
  /** The submission policy the host decides on, overriding the manifest's request (D39). */
  readonly policy?: SubmissionPolicy;
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `artifact/publish`: the receipt, durable before it is sent (H-07). */
export type ArtifactPublishResult = PublishReceipt;

const params: z.ZodType<ArtifactPublishParams> = z
  .object({
    source: SourceRef,
    force: z.boolean().exactOptional(),
    policy: SubmissionPolicy.exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactPublishParams" });

/**
 * `artifact/publish`: freezes an artifact's source into an immutable, content-addressed version and
 * returns its receipt. A failed publish leaves no version (VR-02); the same source and environment
 * publish as the existing version (`reused`).
 */
export const artifactPublishMethod: MethodDefinition<ArtifactPublishParams, ArtifactPublishResult> =
  defineMethod({
    method: "artifact/publish",
    direction: "client-to-instance",
    mutating: true,
    params,
    result: PublishReceipt,
  });
