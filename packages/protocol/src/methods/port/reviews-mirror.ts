import * as z from "zod";
import { ArtifactId, ViewerId } from "../../ids.ts";
import { ResultComment } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * A review change mirrored to a host (HO-11, D58): a comment thread as it stands after a change
 * (made, replied to, resolved, reopened, its crop captured), or a viewer's choice of a review
 * set's candidate. Mostra's ledger stays canonical; a mirror is never a submission (IN-06).
 */
export type ReviewEnvelope =
  | {
      readonly kind: "thread";
      readonly artifactId: string;
      /** The viewer who started the thread. */
      readonly viewerId: string;
      /** The thread as results carry it: every message, its status, anchor and crop path. */
      readonly thread: ResultComment;
    }
  | {
      readonly kind: "choice";
      readonly artifactId: string;
      readonly viewerId: string;
      readonly reviewSetId: string;
      /** The chosen candidate; absent when the choice was cleared. */
      readonly candidateId?: string;
      readonly label?: string;
    };

/** The Zod schema of the `ReviewEnvelope` type. */
export const ReviewEnvelope: z.ZodType<ReviewEnvelope> = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("thread"),
      artifactId: ArtifactId.schema,
      viewerId: ViewerId.schema,
      thread: ResultComment,
    }),
    z.object({
      kind: z.literal("choice"),
      artifactId: ArtifactId.schema,
      viewerId: ViewerId.schema,
      reviewSetId: z.string(),
      candidateId: z.string().exactOptional(),
      label: z.string().exactOptional(),
    }),
  ])
  .register(wireRegistry, {
    id: "ReviewEnvelope",
    description: "A comment thread or a review-set choice mirrored to a host; never a submission.",
  }) as z.ZodType<ReviewEnvelope>;

/** The params of `port/reviews.mirror`. */
export type PortReviewsMirrorParams = ReviewEnvelope;

/** The result of `port/reviews.mirror`: anything; its content is ignored. */
export type PortReviewsMirrorResult = unknown;

/**
 * `port/reviews.mirror`: Mostra sends each review change to a host that registered the `reviews`
 * port, best effort and never retried, as draft mirrors are (D105, HO-11).
 */
export const portReviewsMirrorMethod: MethodDefinition<
  PortReviewsMirrorParams,
  PortReviewsMirrorResult
> = defineMethod({
  method: "port/reviews.mirror",
  direction: "instance-to-host",
  mutating: false,
  params: ReviewEnvelope,
  result: z.unknown(),
});
