import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ServerOrigin } from "../../remote.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/logout` (INTERFACES §18.2). */
export interface RemoteLogoutParams {
  /** The server. Default: every server this home is signed in to. */
  readonly server?: ServerOrigin;
  /**
   * Also forgets the instance link, after which this home owns none of the artifacts it shared
   * there. Without it, the next sign-in rebinds the same link.
   */
  readonly forget?: boolean;
}

/** The result of `remote/logout`: the servers signed out of. */
export interface RemoteLogoutResult {
  /** The servers this home is no longer signed in to. */
  readonly servers: readonly ServerOrigin[];
}

const params: z.ZodType<RemoteLogoutParams> = z
  .object({ server: ServerOrigin.exactOptional(), forget: z.boolean().exactOptional() })
  .register(wireRegistry, { id: "RemoteLogoutParams" });

const result: z.ZodType<RemoteLogoutResult> = z
  .object({ servers: z.array(ServerOrigin).readonly() })
  .register(wireRegistry, { id: "RemoteLogoutResult", description: "The servers signed out of." });

/**
 * `remote/logout`: revokes this home's grant on a server and removes its tokens, keeping the
 * instance link unless `forget` (D165, after the Opus review).
 */
export const remoteLogoutMethod: MethodDefinition<RemoteLogoutParams, RemoteLogoutResult> =
  defineMethod({
    method: "remote/logout",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
