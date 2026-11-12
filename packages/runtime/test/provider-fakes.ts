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
): void {
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
    if (url.pathname === "/authorize") return approve(url, response, codes);
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

/** GitHub's OAuth web flow, whose `GET /user` answers `user()` for its one access token. */
export async function fakeGitHub(options: {
  readonly secret: string;
  readonly user: () => Record<string, unknown>;
}): Promise<FakeProvider> {
  const codes = new Map<string, { nonce?: string; challenge: string }>();
  const fake = await listen(async (request, url, response) => {
    if (url.pathname === "/login/oauth/authorize") return approve(url, response, codes);
    if (url.pathname === "/login/oauth/access_token") {
      if (!redeem(await form(request), codes, options.secret)) {
        return json(response, 200, { error: "bad_verification_code" });
      }
      return json(response, 200, { access_token: "gho_fake", token_type: "bearer", scope: "" });
    }
    if (url.pathname === "/user") {
      return request.headers.authorization === "Bearer gho_fake"
        ? json(response, 200, options.user())
        : json(response, 401, {});
    }
    json(response, 404, {});
  });
  return { ...fake, close: () => fake.server.close() };
}
