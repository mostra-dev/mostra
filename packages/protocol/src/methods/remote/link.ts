import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ServerOrigin } from "../../remote.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/link` (INTERFACES §18.2). */
export interface RemoteLinkParams {
  /** The server's API origin. */
  readonly server: ServerOrigin;
  /**
   * A credential the server's operator issued for an account (`accounts.authenticate`, §18.6), in
   * place of a person's sign-in: a program runs an always-on owner instance with it. Kept in the
   * home, owner-only, like a refresh token; never logged.
   */
  readonly key: string;
  /** Makes this instance the account's default: the one chat-host authoring goes to (D165 item 1b). */
  readonly default?: boolean;
}

/** The result of `remote/link`: this home is linked to the server for the key's account. */
export interface RemoteLinkResult {
  /** The server linked to. */
  readonly server: ServerOrigin;
  /** The account the key is the operator's credential for. */
  readonly account: { readonly id: string; readonly name?: string };
  /** This home's instance link on that server (`lnk_…`), one per key's subject. */
  readonly instanceId: string;
  /** Whether this instance is the account's default. */
  readonly default: boolean;
}

const params: z.ZodType<RemoteLinkParams> = z
  .object({
    server: ServerOrigin,
    key: z.string().min(20).max(512),
    default: z.boolean().exactOptional(),
  })
  .register(wireRegistry, { id: "RemoteLinkParams" });

const result: z.ZodType<RemoteLinkResult> = z
  .object({
    server: ServerOrigin,
    account: z.object({ id: z.string(), name: z.string().exactOptional() }),
    instanceId: z.string(),
    default: z.boolean(),
  })
  .register(wireRegistry, {
    id: "RemoteLinkResult",
    description: "A home linked to a remote server with an operator-issued key.",
  });

/**
 * `remote/link`: links this home to a remote server with a key its operator issued for an account,
 * in place of `remote/login`'s device grant, so a program can run an always-on owner instance
 * (WP-30, D167). Linking again with a key is idempotent by nature, so it takes no `requestId`: the
 * ledger never records the key's digest. A key the server doesn't admit is
 * `MOSTRA_REMOTE_LOGIN_FAILED`.
 */
export const remoteLinkMethod: MethodDefinition<RemoteLinkParams, RemoteLinkResult> = defineMethod({
  method: "remote/link",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
