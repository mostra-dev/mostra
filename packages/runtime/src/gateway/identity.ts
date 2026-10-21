/**
 * Who a browser is (D143 item 2). A link minted with a viewer acts for that viewer (D104) and asks
 * nothing. For a link without one, a host that registered the `identity` port names the person
 * from the request's headers; without such a host, the session acts as the home's local user.
 */
import {
  createDiagnostic,
  type Diagnostic,
  type IdentityVia,
  portIdentityResolveMethod,
  type ViewerSpec,
} from "@mostra/protocol";
import type { Log } from "../log.ts";

/** How long a host has to answer `port/identity.resolve`: a page waits for it, as for D108. */
export const IDENTITY_TIMEOUT_MS = 5_000;

/** What {@link resolveIdentity} reads. */
export interface IdentityInput {
  /** The artifact whose link is being exchanged. */
  readonly artifactId: string;
  /** How the request reached the gateway. */
  readonly via: IdentityVia;
  /** The request's headers. */
  readonly headers: Headers;
  readonly log: Log;
  /** Hosts that always provide `identity` (`HomeConfig.ports`), by client name. */
  readonly expected: () => readonly string[];
  /** The newest connection that registered `identity`, if any. */
  readonly registrant: () => { readonly session: number; readonly owner: string } | undefined;
  /** Calls the port on that connection; rejects on a transport failure or the timeout. */
  readonly call: (session: number, params: unknown) => Promise<unknown>;
}

/** The person a host named, the standalone default, or why nobody can be named. */
export type IdentityOutcome =
  | { readonly kind: "person"; readonly viewer: ViewerSpec }
  | { readonly kind: "default" }
  | { readonly kind: "unavailable"; readonly diagnostic: Diagnostic };

/**
 * The headers a host sees: names in lower case, without `cookie` (Mostra's sessions and every
 * other page's of this host) and without Mostra's own `x-mostra-*` headers.
 */
export function identityHeaders(headers: Headers): Record<string, string> {
  const seen: Record<string, string> = {};
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (key === "cookie" || key.startsWith("x-mostra-")) return;
    seen[key] = value;
  });
  return seen;
}

/**
 * Asks the host that took identity over. Its outage never makes the session someone else: a
 * failure, a timeout, an answer the schema refuses, or an expected host that isn't connected is
 * `unavailable`, and the exchange is refused.
 */
export async function resolveIdentity(input: IdentityInput): Promise<IdentityOutcome> {
  const registrant = input.registrant();
  const unavailable = (message: string): IdentityOutcome => ({
    kind: "unavailable",
    diagnostic: createDiagnostic("MOSTRA_HOST_IDENTITY_UNAVAILABLE", { message }),
  });
  if (registrant) {
    try {
      const answer = await input.call(registrant.session, {
        artifactId: input.artifactId,
        via: input.via,
        headers: identityHeaders(input.headers),
      });
      const parsed = portIdentityResolveMethod.result.safeParse(answer);
      if (parsed.success) {
        return parsed.data === null ? { kind: "default" } : { kind: "person", viewer: parsed.data };
      }
      input.log.warn("gateway.identity_invalid", {
        owner: registrant.owner,
        artifactId: input.artifactId,
      });
      return unavailable(
        `The host ${registrant.owner} answered who this is in a form Mostra refuses.`,
      );
    } catch (error) {
      input.log.warn("gateway.identity_failed", {
        owner: registrant.owner,
        artifactId: input.artifactId,
        error: (error as Error).message,
      });
      return unavailable(`The host ${registrant.owner} didn't say who this is.`);
    }
  }
  const away = input.expected();
  if (away.length > 0) {
    input.log.warn("gateway.identity_host_away", { owners: away, artifactId: input.artifactId });
    return unavailable(
      `The host that identifies this home's viewers (${away.join(", ")}) isn't running.`,
    );
  }
  return { kind: "default" };
}
