import * as z from "zod";
import { ArtifactId, ViewId } from "../../ids.ts";
import { TrustedControl, Viewer } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `port/trustedControls.activated` (INTERFACES §7): a person used a trusted control. */
export interface PortTrustedControlsActivatedParams {
  /** The artifact. */
  readonly artifactId: string;
  /** The control: `submit` or `choose`. */
  readonly control: TrustedControl;
  /** Who used it. */
  readonly viewer: Viewer;
  /** The view it was used in. */
  readonly viewId: string;
  /** What it did: the submission it made, or the review set and candidate it chose. */
  readonly detail?: Readonly<Record<string, string>>;
}

/** The result of `port/trustedControls.activated`; its content is ignored. */
export type PortTrustedControlsActivatedResult = unknown;

const params: z.ZodType<PortTrustedControlsActivatedParams> = z
  .object({
    artifactId: ArtifactId.schema,
    control: TrustedControl,
    viewer: Viewer,
    viewId: ViewId.schema,
    detail: z.record(z.string(), z.string()).exactOptional(),
  })
  .register(wireRegistry, {
    id: "PortTrustedControlsActivatedParams",
    description: "A trusted control a person used: the artifact, control, viewer, view and detail.",
  });

/**
 * `port/trustedControls.activated`: after a trusted control's change commits, Mostra tells the
 * host that registered the `trustedControls` port, best effort and never retried (D108). The
 * change itself is durable already; this call only lets a host react at once.
 */
export const portTrustedControlsActivatedMethod: MethodDefinition<
  PortTrustedControlsActivatedParams,
  PortTrustedControlsActivatedResult
> = defineMethod({
  method: "port/trustedControls.activated",
  direction: "instance-to-host",
  mutating: false,
  params,
  result: z.unknown(),
});
