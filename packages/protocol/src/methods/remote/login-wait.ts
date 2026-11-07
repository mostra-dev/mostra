import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ServerOrigin } from "../../remote.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/login.wait` (INTERFACES §18.2). */
export interface RemoteLoginWaitParams {
  /** The sign-in `remote/login` started. */
  readonly loginId: string;
  /** How long to wait, 0 to check once. */
  readonly timeoutMs: number;
}

/** The result of `remote/login.wait`: signed in, or still waiting for the person. */
export type RemoteLoginWaitResult =
  | {
      readonly status: "signed-in";
      readonly server: ServerOrigin;
      readonly account: { readonly id: string; readonly name?: string };
      /** This home's instance link there (`lnk_…`). */
      readonly instanceId: string;
    }
  | { readonly status: "pending" };

const params: z.ZodType<RemoteLoginWaitParams> = z
  .object({ loginId: z.string().min(1), timeoutMs: z.int().min(0).max(2_147_483_647) })
  .register(wireRegistry, { id: "RemoteLoginWaitParams" });

const result: z.ZodType<RemoteLoginWaitResult> = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("signed-in"),
      server: ServerOrigin,
      account: z.object({ id: z.string(), name: z.string().exactOptional() }),
      instanceId: z.string(),
    }),
    z.object({ status: z.literal("pending") }),
  ])
  .register(wireRegistry, {
    id: "RemoteLoginWaitResult",
    description: "A sign-in's end: signed in with the account and instance link, or pending.",
  });

/**
 * `remote/login.wait`: waits for a sign-in `remote/login` started; a refused or expired code is
 * `MOSTRA_REMOTE_LOGIN_FAILED`.
 */
export const remoteLoginWaitMethod: MethodDefinition<RemoteLoginWaitParams, RemoteLoginWaitResult> =
  defineMethod({
    method: "remote/login.wait",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
