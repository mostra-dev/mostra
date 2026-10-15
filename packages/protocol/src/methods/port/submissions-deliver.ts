import * as z from "zod";
import { ArtifactId, DeliveryId, SubmissionId } from "../../ids.ts";
import { Results } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** One submission delivered to a host (INTERFACES §7, D105). */
export interface SubmissionEnvelope {
  /** Always `submission`: a draft never arrives through this port (IN-06). */
  readonly kind: "submission";
  /** Stable across redeliveries: treat a repeated ID as the same delivery (H-03). */
  readonly deliveryId: string;
  /** The submission. */
  readonly submissionId: string;
  /** Its artifact. */
  readonly artifactId: string;
  /** 1 for the first attempt; more after retries and restarts. */
  readonly attempt: number;
  /** The complete submission (INTERFACES §8), built from the immutable submission alone. */
  readonly results: Results;
}

/** What a host answers a delivery. */
export type SubmissionsDeliverResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      /** `duplicate` (already held), `undeliverable` (terminal, shown to the viewer), or the host's own. */
      readonly reason: string;
      /** `true` keeps the delivery pending and retries it with backoff. */
      readonly retry: boolean;
    };

/** The Zod schema of the `SubmissionEnvelope` type. */
export const SubmissionEnvelope: z.ZodType<SubmissionEnvelope> = z
  .object({
    kind: z.literal("submission"),
    deliveryId: DeliveryId.schema,
    submissionId: SubmissionId.schema,
    artifactId: ArtifactId.schema,
    attempt: z.int().min(1),
    results: Results,
  })
  .register(wireRegistry, {
    id: "SubmissionEnvelope",
    description:
      "One submission delivered to a host: delivery ID, attempt and the complete results.",
  });

const result: z.ZodType<SubmissionsDeliverResult> = z
  .union([
    z.object({ accepted: z.literal(true) }),
    z.object({ accepted: z.literal(false), reason: z.string().min(1), retry: z.boolean() }),
  ])
  .register(wireRegistry, { id: "PortSubmissionsDeliverResult" });

/**
 * `port/submissions.deliver`: Mostra delivers one submission to the host that registered the
 * submissions port, after the submission is durable (IN-12), one at a time in submission order.
 */
export const portSubmissionsDeliverMethod: MethodDefinition<
  SubmissionEnvelope,
  SubmissionsDeliverResult
> = defineMethod({
  method: "port/submissions.deliver",
  direction: "instance-to-host",
  mutating: false,
  params: SubmissionEnvelope,
  result,
});
