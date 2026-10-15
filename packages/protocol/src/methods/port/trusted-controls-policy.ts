import * as z from "zod";
import { ArtifactSummary } from "../../artifact.ts";
import { ControlsPolicy } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `port/trustedControls.policy` (INTERFACES §7). */
export interface PortTrustedControlsPolicyParams {
  /** The artifact a frame is about to show, with the metadata of its latest version. */
  readonly artifact: ArtifactSummary;
}

/** The result of `port/trustedControls.policy`: the channels and controls for the view (D108). */
export type PortTrustedControlsPolicyResult = ControlsPolicy;

const params: z.ZodType<PortTrustedControlsPolicyParams> = z
  .object({ artifact: ArtifactSummary })
  .register(wireRegistry, {
    id: "PortTrustedControlsPolicyParams",
    description: "The artifact a frame is about to show, for its host's controls policy.",
  });

/**
 * `port/trustedControls.policy`: Mostra asks the host that registered the `trustedControls` port
 * which submit channels a new view of an artifact accepts and which trusted controls its shell
 * renders (D108). Asked once per frame load, with 5 seconds to answer; a failure narrows the view
 * to the shell channel.
 */
export const portTrustedControlsPolicyMethod: MethodDefinition<
  PortTrustedControlsPolicyParams,
  PortTrustedControlsPolicyResult
> = defineMethod({
  method: "port/trustedControls.policy",
  direction: "instance-to-host",
  mutating: false,
  params,
  result: ControlsPolicy,
});
