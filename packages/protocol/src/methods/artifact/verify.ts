import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ScreenshotPolicy, VerifyVerdict } from "../../verify.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `artifact/verify` (INTERFACES §6). */
export interface ArtifactVerifyParams {
  /** What to verify: a source path, or an artifact ID meaning the path it was last published from. */
  readonly source: SourceRef;
  /**
   * When the verdict's screenshots are returned to the caller (AX-05): `on-failure` (the default),
   * `always` or `never`. Screenshots are taken either way; this sets their `returned` flag.
   */
  readonly screenshots?: ScreenshotPolicy;
  /**
   * Asks for `artifact/progress` notifications carrying this token as the stages run, when the
   * client accepts them in `mostra/initialize`.
   */
  readonly progressToken?: string;
}

/** The result of `artifact/verify`: the verdict, also cached for the publish that follows (D41). */
export type ArtifactVerifyResult = VerifyVerdict;

const params: z.ZodType<ArtifactVerifyParams> = z
  .object({
    source: SourceRef,
    screenshots: ScreenshotPolicy.exactOptional(),
    progressToken: z.string().min(1).max(200).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactVerifyParams" });

/**
 * `artifact/verify`: builds, type-checks, renders and exercises an artifact's source headlessly,
 * compares it with its last passing version, and returns one verdict (D29, D137). It never
 * publishes and never touches the home's drafts, state, events or deliveries.
 */
export const artifactVerifyMethod: MethodDefinition<ArtifactVerifyParams, ArtifactVerifyResult> =
  defineMethod({
    method: "artifact/verify",
    direction: "client-to-instance",
    mutating: false,
    params,
    result: VerifyVerdict,
  });
