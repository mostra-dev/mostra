/**
 * Local fakes of the identity providers the remote server's built-in adapters speak to (INTERFACES
 * §18.5): an OpenID Connect issuer that signs ID tokens with the claims a test gives it, and GitHub's
 * OAuth web flow with a `GET /user` answer a test gives it. Each approves at once and checks PKCE
 * and its client secret, as the real ones do.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A provider on loopback. */
export interface FakeProvider {
  readonly server: Server;
  readonly origin: string;
  close(): void;
}

async function listen(
  handle: (request: IncomingMessage, url: URL, response: ServerResponse) => unknown,
): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    void handle(request, new URL(request.url ?? "/", "http://127.0.0.1"), response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function form(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const b64 = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

/** Approves at once: a code for this request, back to its `redirect_uri` with its `state`. */
function approve(
  url: URL,
  response: ServerResponse,
  codes: Map<string, { nonce?: string; challenge: string }>,
): string {
  const code = randomBytes(16).toString("hex");
  codes.set(code, {
    ...(url.searchParams.get("nonce") !== null
      ? { nonce: url.searchParams.get("nonce") as string }
      : {}),
    challenge: url.searchParams.get("code_challenge") ?? "",
  });
  const back = new URL(url.searchParams.get("redirect_uri") ?? "");
  back.searchParams.set("code", code);
  back.searchParams.set("state", url.searchParams.get("state") ?? "");
  response.writeHead(302, { location: back.href });
  response.end();
  return code;
}

/** The code a token request redeems, when its PKCE verifier and client secret match. */
function redeem(
  body: URLSearchParams,
  codes: Map<string, { nonce?: string; challenge: string }>,
  secret: string,
): { nonce?: string } | undefined {
  const issued = codes.get(body.get("code") ?? "");
  codes.delete(body.get("code") ?? "");
  const verifier = body.get("code_verifier") ?? "";
  if (
    !issued ||
    createHash("sha256").update(verifier).digest("base64url") !== issued.challenge ||
    body.get("client_secret") !== secret
  ) {
    return undefined;
  }
  return issued;
}

/**
 * An OpenID Connect issuer whose ID tokens carry `subject`'s claims and whatever `claims()` adds
 * (as Google adds `hd` for a Workspace account). Its client is `mostra` with `secret`.
 */
export async function fakeOidc(options: {
  readonly secret: string;
  readonly subject: () => string;
  readonly claims?: () => Record<string, unknown>;
}): Promise<FakeProvider> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as object),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map<string, { nonce?: string; challenge: string }>();
  const fake = await listen(async (request, url, response) => {
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(response, 200, {
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/authorize`,
        token_endpoint: `${fake.origin}/token`,
        jwks_uri: `${fake.origin}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(response, 200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      approve(url, response, codes);
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const issued = redeem(await form(request), codes, options.secret);
      if (!issued) return json(response, 400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const header = b64(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
      const payload = b64(
        JSON.stringify({
          iss: fake.origin,
          sub: options.subject(),
          aud: "mostra",
          exp: now + 300,
          iat: now,
          nonce: issued.nonce,
          name: "Grace Hopper",
          email: "grace@example.com",
          email_verified: true,
          ...(options.claims?.() ?? {}),
        }),
      );
      const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
      return json(response, 200, {
        access_token: "at",
        token_type: "Bearer",
        expires_in: 300,
        id_token: `${header}.${payload}.${b64(signature)}`,
      });
    }
    json(response, 404, {});
  });
  return { ...fake, close: () => fake.server.close() };
}

/** One address of `GET /user/emails`, as GitHub lists them. */
export interface FakeGitHubEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
  readonly visibility: "public" | "private" | null;
}

/** What a fake GitHub saw of the sign-ins it answered. */
export interface FakeGitHub extends FakeProvider {
  /** The `scope` of every authorization request, in order. */
  readonly scopes: string[];
  /** Every `GET /user/emails` request, its query and the API version it asked for. */
  readonly emailRequests: { readonly search: string; readonly version: string | undefined }[];
}

/**
 * GitHub's OAuth web flow, whose `GET /user` answers `user()` and `GET /user/emails` `emails()` for
 * its access token (VERIFIED_FACTS, MT-05). The token holds the scope the authorization asked for,
 * or what `grant(asked)` says the person left on GitHub's screen; without `user:email` (or `user`)
 * the address list answers 404, as GitHub does. `emails()` may answer a status of its own, or hang.
 */
export async function fakeGitHub(options: {
  readonly secret: string;
  readonly user: () => Record<string, unknown>;
  readonly emails?: () => readonly FakeGitHubEmail[] | { readonly status: number } | "hang";
  readonly grant?: (asked: string) => string;
}): Promise<FakeGitHub> {
  const codes = new Map<string, { nonce?: string; challenge: string }>();
  const scopeOf = new Map<string, string>();
  const tokens = new Map<string, string>();
  const scopes: string[] = [];
  const emailRequests: { search: string; version: string | undefined }[] = [];
  const fake = await listen(async (request, url, response) => {
    if (url.pathname === "/login/oauth/authorize") {
      const asked = url.searchParams.get("scope") ?? "";
      scopes.push(asked);
      const code = approve(url, response, codes);
      scopeOf.set(code, options.grant ? options.grant(asked) : asked);
      return;
    }
    if (url.pathname === "/login/oauth/access_token") {
      const body = await form(request);
      const code = body.get("code") ?? "";
      if (!redeem(body, codes, options.secret)) {
        return json(response, 200, { error: "bad_verification_code" });
      }
      // GitHub answers the granted scopes comma-separated.
      const granted = (scopeOf.get(code) ?? "").split(/[ ,]+/).filter(Boolean).join(",");
      const token = `gho_${randomBytes(8).toString("hex")}`;
      tokens.set(token, granted);
      return json(response, 200, { access_token: token, token_type: "bearer", scope: granted });
    }
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
    const granted = tokens.get(bearer);
    if (url.pathname === "/user") {
      return granted !== undefined ? json(response, 200, options.user()) : json(response, 401, {});
    }
    if (url.pathname === "/user/emails") {
      emailRequests.push({
        search: url.search,
        version: request.headers["x-github-api-version"] as string | undefined,
      });
      if (granted === undefined) return json(response, 401, {});
      const scoped = granted.split(",").some((scope) => scope === "user:email" || scope === "user");
      if (!scoped) {
        response.setHeader("x-accepted-oauth-scopes", "user, user:email");
        return json(response, 404, { message: "Not Found", status: "404" });
      }
      const answer = options.emails?.() ?? [];
      if (answer === "hang") return;
      if ("status" in answer) return json(response, answer.status, { message: "Server Error" });
      return json(response, 200, answer);
    }
    json(response, 404, {});
  });
  return { ...fake, scopes, emailRequests, close: () => fake.server.close() };
}
