import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ServerOrigin } from "../../remote.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `remote/login` (INTERFACES §18.2). */
export interface RemoteLoginParams {
  /** The server's API origin. Default: the home's default server. */
  readonly server?: ServerOrigin;
  /** Makes a retry return the same sign-in. */
  readonly requestId?: string;
}

/**
 * The result of `remote/login`: a sign-in by the OAuth device authorization grant (RFC 8628) has
 * started; the person opens `verificationUri` and enters `userCode`.
 */
export interface RemoteLoginResult {
  /** The sign-in, for `remote/login.wait`. */
  readonly loginId: string;
  /** The server signed in to. */
  readonly server: ServerOrigin;
  /** The page the person opens. */
  readonly verificationUri: string;
  /** The address with the code filled in, when the server offers one. */
  readonly verificationUriComplete?: string;
  /** The code the person enters there. */
  readonly userCode: string;
  /** When the code stops working. */
  readonly expiresAt: string;
}

const params: z.ZodType<RemoteLoginParams> = z
  .object({ server: ServerOrigin.exactOptional(), requestId: z.string().min(1).exactOptional() })
  .register(wireRegistry, { id: "RemoteLoginParams" });

const result: z.ZodType<RemoteLoginResult> = z
  .object({
    loginId: z.string(),
    server: ServerOrigin,
    verificationUri: z.string(),
    verificationUriComplete: z.string().exactOptional(),
    userCode: z.string(),
    expiresAt: z.string(),
  })
  .register(wireRegistry, {
    id: "RemoteLoginResult",
    description: "A device-grant sign-in that started: where to go and the code to enter.",
  });

/**
 * `remote/login`: starts signing this home in to a remote server by the device authorization
 * grant, and polls for its token in the background (D165 item 2). The instance keeps the refresh
 * token in the home, owner-only; a home already linked there rebinds its instance link.
 */
export const remoteLoginMethod: MethodDefinition<RemoteLoginParams, RemoteLoginResult> =
  defineMethod({
    method: "remote/login",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
