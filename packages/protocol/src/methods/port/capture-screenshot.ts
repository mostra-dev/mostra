import * as z from "zod";
import { ArtifactId, ThreadId, VersionId, ViewerId, ViewId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ReviewAnchor } from "../../review.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** What a host's `capture` port is asked to photograph: one comment thread's place (HO-11). */
export interface CaptureRequest {
  /** The artifact, its version and the view the comment was made in. */
  readonly artifactId: string;
  readonly versionId: string;
  readonly viewId: string;
  /** Whose view it was: the crop shows the page with this viewer's answers. */
  readonly viewerId: string;
  /** The thread whose crop this is; a repeated call names the same thread. */
  readonly threadId: string;
  /** Where the comment points, every layer (D23). */
  readonly anchor: ReviewAnchor;
}

/** The Zod schema of the `CaptureRequest` type. */
export const CaptureRequest: z.ZodType<CaptureRequest> = z
  .object({
    artifactId: ArtifactId.schema,
    versionId: VersionId.schema,
    viewId: ViewId.schema,
    viewerId: ViewerId.schema,
    threadId: ThreadId.schema,
    anchor: ReviewAnchor,
  })
  .register(wireRegistry, {
    id: "CaptureRequest",
    description: "A comment thread's place for a host to photograph: its view and its anchor.",
  });

/** The longest crop a host may answer, in base64 characters (6 MiB of PNG). */
export const CAPTURE_PNG_BASE64_MAX: number = 8 * 1024 * 1024;

/** The answer of `port/capture.screenshot`: the crop as a PNG, and its size in pixels. */
export interface PortCaptureScreenshotResult {
  /** The PNG's bytes, base64. */
  readonly png: string;
  readonly width: number;
  readonly height: number;
}

/** The params of `port/capture.screenshot`. */
export type PortCaptureScreenshotParams = CaptureRequest;

const result: z.ZodType<PortCaptureScreenshotResult> = z
  .object({
    png: z
      .string()
      .max(CAPTURE_PNG_BASE64_MAX)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    width: z.int().min(1).max(16_384),
    height: z.int().min(1).max(16_384),
  })
  .register(wireRegistry, {
    id: "PortCaptureScreenshotResult",
    description: "A comment thread's crop as a base64 PNG, with its size in pixels.",
  });

/**
 * `port/capture.screenshot`: Mostra asks the host that registered the `capture` port for the crop
 * a comment thread stores (HO-11, D143 item 1), answered within 30 s. A host that fails, takes too
 * long or answers something its schema refuses leaves the crop to Mostra's default, the verify
 * runner's browser.
 */
export const portCaptureScreenshotMethod: MethodDefinition<
  PortCaptureScreenshotParams,
  PortCaptureScreenshotResult
> = defineMethod({
  method: "port/capture.screenshot",
  direction: "instance-to-host",
  mutating: false,
  params: CaptureRequest,
  result,
});
