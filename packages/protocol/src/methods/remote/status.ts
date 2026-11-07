import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { RemoteLink } from "../../remote.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/status` (INTERFACES §18.2). */
export type RemoteStatusParams = Record<string, never>;

/** The result of `remote/status`: every server this home is linked to. */
export interface RemoteStatusResult {
  /** Each server this home is linked to. */
  readonly links: readonly RemoteLink[];
}

const params: z.ZodType<RemoteStatusParams> = z
  .object({})
  .register(wireRegistry, { id: "RemoteStatusParams" });

const result: z.ZodType<RemoteStatusResult> = z
  .object({ links: z.array(RemoteLink).readonly() })
  .register(wireRegistry, {
    id: "RemoteStatusResult",
    description: "Every remote server this home is linked to.",
  });

/** `remote/status`: the remote servers this home is linked to and each link's state. */
export const remoteStatusMethod: MethodDefinition<RemoteStatusParams, RemoteStatusResult> =
  defineMethod({
    method: "remote/status",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
