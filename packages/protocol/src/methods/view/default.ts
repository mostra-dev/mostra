import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { CapabilityLink } from "./url.ts";

/** The params of `view/default` (INTERFACES §6, D140). */
export interface ViewDefaultParams {
  /** The artifact whose default link to return. */
  readonly artifact: ArtifactRef;
}

/** The result of `view/default`: the artifact's default link (D97 item 3). */
export type ViewDefaultResult = CapabilityLink;

const params: z.ZodType<ViewDefaultParams> = z
  .object({ artifact: ArtifactRef })
  .register(wireRegistry, { id: "ViewDefaultParams" });

/**
 * `view/default`: the artifact's default link, the one every publish receipt carries (D97 item
 * 3), without minting a new token. When the default link was revoked, it mints a new default (the
 * old token stays revoked). `view/url` always mints a separate link.
 */
export const viewDefaultMethod: MethodDefinition<ViewDefaultParams, ViewDefaultResult> =
  defineMethod({
    method: "view/default",
    direction: "client-to-instance",
    mutating: true,
    params,
    result: CapabilityLink,
  });
