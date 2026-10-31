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

/**
 * Decodes RFC 2047 encoded words (`=?utf-8?q?Ferris_B=C3=BCller?=`, and `b` for base64), as
 * Tailscale Serve writes a non-ASCII name; text outside encoded words is kept, and whitespace
 * between two encoded words is dropped (RFC 2047 §6.2). Anything malformed is kept as written.
 */
export function decodeEncodedWords(value: string): string {
  const word = /=\?([^?\s]+)\?([qQbB])\?([^?\s]*)\?=/g;
  const decodeOne = (charset: string, encoding: string, text: string): string | undefined => {
    let bytes: Uint8Array;
    if (encoding.toLowerCase() === "b") {
      bytes = Buffer.from(text, "base64");
    } else {
      const out: number[] = [];
      for (let index = 0; index < text.length; index++) {
        const char = text[index] as string;
        if (char === "_") out.push(0x20);
        else if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
          out.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
          index += 2;
        } else out.push(char.charCodeAt(0) & 0xff);
      }
      bytes = Uint8Array.from(out);
    }
    try {
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  };
  let result = "";
  let last = 0;
  let previousWasWord = false;
  for (const match of value.matchAll(word)) {
    const between = value.slice(last, match.index);
    const decoded = decodeOne(match[1] as string, match[2] as string, match[3] as string);
    if (decoded === undefined) {
      result += between + match[0];
      previousWasWord = false;
    } else {
      result += previousWasWord && /^\s*$/.test(between) ? "" : between;
      result += decoded;
      previousWasWord = true;
    }
    last = match.index + match[0].length;
  }
  return result + value.slice(last);
}

/** Whether a connection's peer is this machine: the only way a tunnel tool reaches a face. */
export function isLoopbackPeer(remote: string | undefined): boolean {
  if (remote === undefined) return false;
  const address = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
  return address === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/**
 * The tailnet person Tailscale Serve names in a request (D158 item 2): `Tailscale-User-Login` and
 * `Tailscale-User-Name`, which Serve sets on every tailnet request after removing any a client
 * sent. They are believed only from a loopback peer (faces bind loopback, so only `tailscaled` and
 * this machine's own programs reach them) and never beside `Tailscale-Funnel-Request`, which
 * marks a public request. A tagged device sends no login, so nobody is named.
 */
export function tailnetPerson(
  headers: Headers,
  remote: string | undefined,
): ViewerSpec | undefined {
  if (!isLoopbackPeer(remote) || headers.has("tailscale-funnel-request")) return undefined;
  const login = headers.get("tailscale-user-login");
  if (login === null) return undefined;
  const ref = decodeEncodedWords(login).trim();
  if (ref === "" || ref.length > 512) return undefined;
  const name = decodeEncodedWords(headers.get("tailscale-user-name") ?? "").trim();
  return { ref, ...(name !== "" && name.length <= 256 ? { name } : {}) };
}
