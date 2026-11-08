/**
 * The authorization server's browser side for tests (INTERFACES §18.5): a browser on the API
 * origin with its own cookies, PKCE, Dynamic Client Registration, the development provider's
 * sign-in, the consent page, and an MCP access token got the way an MCP client gets one.
 */
import { createHash, randomBytes } from "node:crypto";
import { expect } from "vitest";
import { type Reply, send } from "./server-support.ts";

/** A browser on the API origin: its cookies, its requests, following nothing on its own. */
export class ApiBrowser {
  readonly jar = new Map<string, string>();
  readonly port: number;
  readonly host: string;
  constructor(port: number, host: string) {
    this.port = port;
    this.host = host;
  }

  async ask(
    method: string,
    path: string,
    body?: Record<string, string>,
    extra: Record<string, string> = {},
  ): Promise<Reply> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const reply = await send(this.port, this.host, path, {
      method,
      headers: {
        ...(cookie !== "" ? { cookie } : {}),
        ...(body !== undefined
          ? {
              "content-type": "application/x-www-form-urlencoded",
              origin: `http://${this.host}`,
            }
          : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: new URLSearchParams(body).toString() } : {}),
    });
    const set = reply.headers["set-cookie"];
    for (const line of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair] = line.split(";");
      const at = (pair as string).indexOf("=");
      const name = (pair as string).slice(0, at);
      const value = (pair as string).slice(at + 1);
      if (/Max-Age=0/.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return reply;
  }
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The `location` of a redirect, as a URL. */
export function located(reply: Reply): URL {
  expect([302, 303], reply.body).toContain(reply.status);
  return new URL(String(reply.headers["location"]), "http://api.localhost");
}

/** Signs a browser in through the development provider, from the sign-in page a reply shows. */
export async function signIn(who: ApiBrowser, signInPage: Reply, name: string): Promise<URL> {
  const start = /href="(\/signin\/dev\/start\?next=[^"]+)"/.exec(signInPage.body);
  expect(start, signInPage.body).not.toBeNull();
  const toName = located(
    await who.ask("GET", (start as RegExpExecArray)[1]?.replace(/&amp;/g, "&") ?? ""),
  );
  const state = toName.searchParams.get("state") as string;
  return located(await who.ask("POST", "/signin/dev/name", { state, name }));
}

/** Registers a public client by Dynamic Client Registration; its client ID. */
export async function register(
  port: number,
  redirect: string,
  name = "Test client",
): Promise<string> {
  const reply = await send(port, `api.localhost:${port}`, "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(reply.status, reply.body).toBe(201);
  return (JSON.parse(reply.body) as { client_id: string }).client_id;
}

/** An authorization request's path for a client. */
export function authorizeUrl(
  api: string,
  clientId: string,
  redirect: string,
  challenge: string,
  extra: Record<string, string> = {},
): string {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state: "st-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${api}/mcp`,
    scope: "mostra offline_access",
    ...extra,
  })}`;
}

/** Approves on the consent page a reply shows; the redirect to the client. */
export async function approve(who: ApiBrowser, consent: Reply): Promise<URL> {
  expect(consent.status, consent.body).toBe(200);
  const action = /action="([^"]+)"/.exec(consent.body)?.[1]?.replace(/&amp;/g, "&") as string;
  const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)?.[1] as string;
  return located(await who.ask("POST", action, { csrf, decision: "approve" }));
}

/** A form to the token endpoint. */
export function token(port: number, fields: Record<string, string>): Promise<Reply> {
  return send(port, `api.localhost:${port}`, "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** An MCP client's access token for the account `name`, got through the whole flow. */
export async function mcpAccessToken(port: number, name: string): Promise<string> {
  const api = `http://api.localhost:${port}`;
  const redirect = "https://client.example/callback";
  const clientId = await register(port, redirect, "MCP test client");
  const who = new ApiBrowser(port, `api.localhost:${port}`);
  const { verifier, challenge } = pkce();
  const first = await who.ask("GET", authorizeUrl(api, clientId, redirect, challenge));
  const back = await signIn(who, first, name);
  const answer = await approve(who, await who.ask("GET", `${back.pathname}${back.search}`));
  const issued = await token(port, {
    grant_type: "authorization_code",
    client_id: clientId,
    code: answer.searchParams.get("code") as string,
    redirect_uri: redirect,
    code_verifier: verifier,
    resource: `${api}/mcp`,
  });
  expect(issued.status, issued.body).toBe(200);
  return (JSON.parse(issued.body) as { access_token: string }).access_token;
}
