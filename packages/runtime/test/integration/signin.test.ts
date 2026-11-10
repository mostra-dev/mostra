/**
 * Sign-in through identity providers, and a page's viewer sign-in (HY-08, INTERFACES §18.4, §18.5):
 * the OpenID Connect and GitHub adapters against local fakes of each provider, with PKCE, `state`
 * and the ID token's issuer, audience and nonce checked; a forged answer refused; and a
 * viewer sign-in code started on one hosted route refused on another, while on its own route the
 * session acts as the account, kind `account`, verified.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { ApiBrowser, approve, located, ownerSignInThroughPage, signIn } from "../oauth-support.ts";
import {
  freePort,
  ownerEnv,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

/** A provider on loopback: its routes, and what it was asked. */
async function fakeProvider(
  handle: (request: IncomingMessage, url: URL, response: ServerResponse) => unknown,
): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void handle(request, url, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function body(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const b64 = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

describe("identity providers and a page's sign-in (HY-08)", () => {
  let port: number;
  let server: RunningServer;
  let owner: GatewayHome;
  let oidc: Awaited<ReturnType<typeof fakeProvider>>;
  let github: Awaited<ReturnType<typeof fakeProvider>>;
  /** What the OIDC fake signs next: the nonce it was asked, unless a test forges another. */
  // The ID token comes from the token endpoint over TLS in production, where OpenID Connect Core
  // §3.1.3.7 lets TLS stand for its signature (openid-client checks the claims): so the forgeries
  // are of what an attacker who replays or mixes up tokens controls, its issuer, audience and nonce.
  let forge: "none" | "nonce" | "audience" | "issuer" = "none";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as object),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  /** Pending codes of both fakes: what each was issued for. */
  const codes = new Map<string, { nonce?: string; challenge: string; redirect: string }>();

  beforeAll(async () => {
    oidc = await fakeProvider(async (request, url, response) => {
      if (url.pathname === "/.well-known/openid-configuration") {
        return json(response, 200, {
          issuer: oidc.origin,
          authorization_endpoint: `${oidc.origin}/authorize`,
          token_endpoint: `${oidc.origin}/token`,
          jwks_uri: `${oidc.origin}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/jwks") return json(response, 200, { keys: [jwk] });
      if (url.pathname === "/authorize") {
        // The person approves at once: the fake answers with a code for this request.
        const code = randomBytes(16).toString("hex");
        codes.set(code, {
          nonce: url.searchParams.get("nonce") ?? "",
          challenge: url.searchParams.get("code_challenge") ?? "",
          redirect: url.searchParams.get("redirect_uri") ?? "",
        });
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.href });
        return response.end();
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const form = await body(request);
        const issued = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (
          !issued ||
          createHash("sha256").update(verifier).digest("base64url") !== issued.challenge ||
          form.get("client_secret") !== "oidc-secret"
        ) {
          return json(response, 400, { error: "invalid_grant" });
        }
        const now = Math.floor(Date.now() / 1000);
        const header = b64(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
        const payload = b64(
          JSON.stringify({
            iss: forge === "issuer" ? "https://idp.example" : oidc.origin,
            sub: "grace-1",
            aud: forge === "audience" ? "another-client" : "mostra",
            exp: now + 300,
            iat: now,
            nonce: forge === "nonce" ? "someone-else" : issued.nonce,
            name: "Grace Hopper",
            email: "grace@example.com",
            email_verified: true,
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
    github = await fakeProvider(async (request, url, response) => {
      if (url.pathname === "/login/oauth/authorize") {
        const code = randomBytes(16).toString("hex");
        codes.set(code, {
          challenge: url.searchParams.get("code_challenge") ?? "",
          redirect: url.searchParams.get("redirect_uri") ?? "",
        });
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.href });
        return response.end();
      }
      if (url.pathname === "/login/oauth/access_token") {
        const form = await body(request);
        const issued = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (
          !issued ||
          createHash("sha256").update(verifier).digest("base64url") !== issued.challenge ||
          form.get("client_secret") !== "gh-secret"
        ) {
          return json(response, 200, { error: "bad_verification_code" });
        }
        return json(response, 200, { access_token: "gho_test", token_type: "bearer", scope: "" });
      }
      if (url.pathname === "/user") {
        return request.headers.authorization === "Bearer gho_test"
          ? json(response, 200, {
              id: 4242,
              login: "ada",
              name: "Ada Lovelace",
              created_at: "2011-01-01T00:00:00Z",
            })
          : json(response, 401, {});
      }
      json(response, 404, {});
    });
    const secrets = tempDir("idp-secrets");
    writeFileSync(join(secrets, "oidc"), "oidc-secret\n");
    writeFileSync(join(secrets, "github"), "gh-secret\n");
    port = await freePort();
    server = await startServer({
      data: tempDir("signin-data"),
      port,
      config: testConfig(port, {
        identityProviders: [
          { id: "dev", kind: "development", label: "Development sign-in" },
          {
            id: "corp",
            kind: "oidc",
            label: "Corp",
            issuer: oidc.origin,
            clientId: "mostra",
            clientSecretFile: join(secrets, "oidc"),
          },
          {
            id: "github",
            kind: "github",
            clientId: "gh-client",
            clientSecretFile: join(secrets, "github"),
          },
        ],
      }),
      env: { MOSTRA_TEST_OIDC_INSECURE: "1", MOSTRA_TEST_GITHUB_BASE: github.origin },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    owner = new GatewayHome();
    await owner.start({ env: ownerEnv(port) });
    // Other providers beside the development one: no development form on the device page, so the
    // owner signs in on the page as a person would (D167 item 23).
    await ownerSignInThroughPage(owner.client, port, "Ada");
  }, 120_000);

  afterAll(async () => {
    await owner?.stop();
    await stopServer(server);
    oidc?.server.close();
    github?.server.close();
  });

  /** Signs a browser in through a provider, following each redirect by hand; the last answer. */
  const through = async (
    who: ApiBrowser,
    provider: string,
  ): Promise<{ status: number; body: string }> => {
    let reply = await who.ask("GET", `/signin/${provider}/start?next=/device`);
    for (let hop = 0; hop < 6; hop += 1) {
      if (reply.status !== 302 && reply.status !== 303) return reply;
      const next = new URL(String(reply.headers["location"]));
      if (next.host === `api.localhost:${port}`) {
        reply = await who.ask("GET", `${next.pathname}${next.search}`);
      } else {
        // The provider's side: a plain request (it redirects back at once).
        const answer = await fetch(next, { redirect: "manual" });
        const back = new URL(answer.headers.get("location") ?? "");
        reply = await who.ask("GET", `${back.pathname}${back.search}`);
      }
    }
    return reply;
  };

  it("signs in through OpenID Connect with PKCE and checked ID token claims, and refuses forged ones", async () => {
    forge = "none";
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const signedIn = await through(who, "corp");
    expect(signedIn.status, signedIn.body).toBe(200);
    expect(signedIn.body).toContain("Grace Hopper");
    for (const kind of ["nonce", "audience", "issuer"] as const) {
      forge = kind;
      const refused = await through(new ApiBrowser(port, `api.localhost:${port}`), "corp");
      expect(refused.status, kind).toBe(400);
      expect(refused.body, kind).toContain("didn&#39;t sign you in");
    }
    forge = "none";
  }, 60_000);

  it("signs in through GitHub by its numeric user ID", async () => {
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const signedIn = await through(who, "github");
    expect(signedIn.status, signedIn.body).toBe(200);
    expect(signedIn.body).toContain("Ada Lovelace");
  }, 60_000);

  it("refuses a provider's answer for a sign-in another browser started (login CSRF)", async () => {
    const victim = new ApiBrowser(port, `api.localhost:${port}`);
    const attacker = new ApiBrowser(port, `api.localhost:${port}`);
    const started = await attacker.ask("GET", "/signin/github/start?next=/device");
    const atProvider = await fetch(new URL(String(started.headers["location"])), {
      redirect: "manual",
    });
    const back = new URL(atProvider.headers.get("location") ?? "");
    // The attacker hands the victim its callback: the victim's browser never started it.
    const refused = await victim.ask("GET", `${back.pathname}${back.search}`);
    expect(refused.status).toBe(400);
    expect(victim.jar.size).toBe(0);
  }, 60_000);

  it("names a page's viewer as the account, and refuses a code started on one route on another", async () => {
    const one = await owner.publish("single-tsx", "page.tsx");
    const two = await owner.publish("directory");
    const shared = async (artifactId: string) =>
      ok<{ url: string }>(
        await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
      ).url;
    const urlOne = await shared(one.artifactId);
    const urlTwo = await shared(two.artifactId);
    const browser = new Browser();
    const pageOne = await openLink(browser, urlOne);
    const pageTwo = await openLink(browser, urlTwo);
    const routeOne = new URL(urlOne).pathname;
    const routeTwo = new URL(urlTwo).pathname;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const started = await browser.fetchJson(
      pageOne.link.shell,
      `${routeOne}/_mostra/session/signin/start`,
      {
        body: { challenge },
        csrf: pageOne.shellCsrf,
      },
    );
    expect(started.status, started.body).toBe(200);
    const { url, state } = started.json<{ url: string; state: string }>();
    // The person signs in on the API origin and sees whose page they are named to.
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const target = new URL(url);
    const first = await who.ask("GET", `${target.pathname}${target.search}`);
    const after = await signIn(who, first, "Grace");
    const consent = await who.ask("GET", `${after.pathname}${after.search}`);
    expect(consent.body).toContain("Ada");
    const back = await approve(who, consent);
    expect(back.pathname).toBe("/_mostra/signin");
    expect(back.searchParams.get("iss")).toBe(`http://api.localhost:${port}`);
    const code = back.searchParams.get("code") as string;
    // Redeemed for the other route: refused, and the code is spent for good.
    const elsewhere = await browser.fetchJson(
      pageTwo.link.shell,
      `${routeTwo}/_mostra/session/signin`,
      {
        body: { code, verifier, state },
        csrf: pageTwo.shellCsrf,
      },
    );
    expect(elsewhere.status).toBe(403);

    // A fresh sign-in, redeemed on its own route: the session now acts as the account.
    const again = await browser.fetchJson(
      pageOne.link.shell,
      `${routeOne}/_mostra/session/signin/start`,
      {
        body: { challenge },
        csrf: pageOne.shellCsrf,
      },
    );
    const second = again.json<{ url: string; state: string }>();
    const secondTarget = new URL(second.url);
    // Signed in already, the sender shown already: straight back with a code.
    const straight = located(
      await who.ask("GET", `${secondTarget.pathname}${secondTarget.search}`),
    );
    const redeemed = await browser.fetchJson(
      pageOne.link.shell,
      `${routeOne}/_mostra/session/signin`,
      {
        body: { code: straight.searchParams.get("code"), verifier, state: second.state },
        csrf: pageOne.shellCsrf,
      },
    );
    expect(redeemed.status, redeemed.body).toBe(200);
    const viewer = redeemed.json<{ viewer: { kind: string; name?: string; verified?: boolean } }>()
      .viewer;
    expect(viewer).toMatchObject({ kind: "account", name: "Grace" });
    // A PKCE verifier that doesn't match is refused.
    const third = (
      await browser.fetchJson(pageOne.link.shell, `${routeOne}/_mostra/session/signin/start`, {
        body: { challenge },
        csrf: pageOne.shellCsrf,
      })
    ).json<{ url: string; state: string }>();
    const thirdTarget = new URL(third.url);
    const thirdCode = located(await who.ask("GET", `${thirdTarget.pathname}${thirdTarget.search}`));
    const wrong = await browser.fetchJson(
      pageOne.link.shell,
      `${routeOne}/_mostra/session/signin`,
      {
        body: {
          code: thirdCode.searchParams.get("code"),
          verifier: randomBytes(32).toString("base64url"),
          state: third.state,
        },
        csrf: pageOne.shellCsrf,
      },
    );
    expect(wrong.status).toBe(403);
  }, 180_000);
});
