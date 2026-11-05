import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/token` (INTERFACES §18.2): a fresh access token, sent in band. */
export interface RemoteTokenParams {
  /** A fresh access token of the binding's own grant. */
  readonly accessToken: string;
}

/** The result of `remote/token`: when the binding now closes unless refreshed again. */
export interface RemoteTokenResult {
  /** When the new token expires. */
  readonly expiresAt: string;
}

const params: z.ZodType<RemoteTokenParams> = z
  .object({ accessToken: z.string().min(1) })
  .register(wireRegistry, { id: "RemoteTokenParams" });

const result: z.ZodType<RemoteTokenResult> = z
  .object({ expiresAt: z.string() })
  .register(wireRegistry, {
    id: "RemoteTokenResult",
    description: "When the binding closes unless its token is refreshed again.",
  });

/**
 * `remote/token`: on a binding to a remote server, replaces the session's access token with a
 * fresh one for the same grant, so the server doesn't close the binding at the old one's expiry.
 */
export const remoteTokenMethod: MethodDefinition<RemoteTokenParams, RemoteTokenResult> =
  defineMethod({
    method: "remote/token",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
