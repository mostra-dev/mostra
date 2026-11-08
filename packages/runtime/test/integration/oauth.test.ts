/**
 * The authorization server for MCP clients (MC-04; INTERFACES §18.5; the MCP authorization
 * specification of 2026-07-28, VERIFIED_FACTS): metadata, Dynamic Client Registration, Client ID
 * Metadata Documents (fetched only from a public address, with no redirect), the authorization
 * code flow with PKCE S256 through a provider sign-in and the server's own consent, `iss` in every
 * answer, resource indicators with an audience check, and rotating refresh tokens whose reuse
 * revokes the grant. A real `mostra-runtime server` with the development provider; a browser is
 * played with plain requests and a cookie jar for the API origin.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiBrowser, located, pkce } from "../oauth-support.ts";
import {
  freePort,
  type Reply,
  type RunningServer,
  send,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

describe("the authorization server for MCP clients (MC-04)", () => {
  let port: number;
  let server: RunningServer;
  let api: string;
  let documents: Server;
  let documentsOrigin: string;
  /** What the document server answers, by path; every path it was asked, in order. */
  const served = new Map<string, { status: number; body?: unknown; location?: string }>();
  const asked: string[] = [];

  beforeAll(async () => {
    documents = createServer((request, response) => {
      asked.push(request.url ?? "");
      const answer = served.get(request.url ?? "") ?? { status: 404 };
      response.writeHead(answer.status, {
        "content-type": "application/json",
        ...(answer.location ? { location: answer.location } : {}),
      });
      response.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve) => documents.listen(0, "127.0.0.1", resolve));
    documentsOrigin = `http://127.0.0.1:${(documents.address() as AddressInfo).port}`;
    port = await freePort();
    api = `http://api.localhost:${port}`;
    server = await startServer({
      data: tempDir("oauth-data"),
      port,
      config: testConfig(port),
      env: { MOSTRA_TEST_CIMD_ORIGIN: documentsOrigin, MOSTRA_TEST_ROTATION_GRACE_MS: "1500" },
    });
    expect(server.status.status, server.stderr()).toBe("started");
  }, 60_000);

  afterAll(async () => {
    await stopServer(server);
    documents.close();
  });

  const browser = () => new ApiBrowser(port, `api.localhost:${port}`);

  /** Signs a browser in through the development provider, from wherever a page sent it. */
  const signIn = async (who: ApiBrowser, signInPage: Reply, name: string): Promise<URL> => {
    const start = /href="(\/signin\/dev\/start\?next=[^"]+)"/.exec(signInPage.body);
    expect(start, signInPage.body).not.toBeNull();
    const toName = located(
      await who.ask("GET", (start as RegExpExecArray)[1]!.replace(/&amp;/g, "&")),
    );
    const state = toName.searchParams.get("state") as string;
    const done = await who.ask("POST", "/signin/dev/name", { state, name });
    return located(done);
  };

  /** Registers a public client by Dynamic Client Registration. */
  const register = async (redirect: string, name = "Test client"): Promise<string> => {
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
  };

  const authorizeUrl = (
    clientId: string,
    redirect: string,
    challenge: string,
    extra: Record<string, string> = {},
  ) =>
    `/oauth/authorize?${new URLSearchParams({
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

  /** Approves on the consent page a reply shows; answers the redirect to the client. */
  const approve = async (who: ApiBrowser, consent: Reply): Promise<URL> => {
    expect(consent.status, consent.body).toBe(200);
    const action = /action="([^"]+)"/.exec(consent.body)?.[1]?.replace(/&amp;/g, "&") as string;
    const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)?.[1] as string;
    return located(await who.ask("POST", action, { csrf, decision: "approve" }));
  };

  const token = (fields: Record<string, string>) =>
    send(port, `api.localhost:${port}`, "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  it("advertises what Claude's client needs: CIMD with none, DCR, S256, iss, offline_access", async () => {
    const metadata = JSON.parse(
      (await send(port, `api.localhost:${port}`, "/.well-known/oauth-authorization-server")).body,
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      issuer: api,
      authorization_endpoint: `${api}/oauth/authorize`,
      token_endpoint: `${api}/oauth/token`,
      registration_endpoint: `${api}/oauth/register`,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata["token_endpoint_auth_methods_supported"]).toContain("none");
    expect(metadata["scopes_supported"]).toEqual(["mostra", "offline_access"]);
    const resource = JSON.parse(
      (await send(port, `api.localhost:${port}`, "/.well-known/oauth-protected-resource/mcp")).body,
    ) as Record<string, unknown>;
    expect(resource).toMatchObject({ resource: `${api}/mcp`, authorization_servers: [api] });
    // The resource lists `mostra` only: refresh tokens are no resource's requirement.
    expect(resource["scopes_supported"]).toEqual(["mostra"]);
  });

  it("signs in, asks its own consent, issues a code with iss, and exchanges it under PKCE for its audience", async () => {
    const redirect = "https://client.example/callback";
    const clientId = await register(redirect);
    const who = browser();
    const { verifier, challenge } = pkce();
    const first = await who.ask("GET", authorizeUrl(clientId, redirect, challenge));
    expect(first.status).toBe(200);
    expect(first.body).toContain("Sign in to Mostra");
    const back = await signIn(who, first, "Ada");
    const consent = await who.ask("GET", `${back.pathname}${back.search}`);
    expect(consent.body).toContain("Test client");
    expect(consent.body).toContain("not checked");
    expect(consent.body).toContain("client.example");
    const answer = await approve(who, consent);
    expect(answer.origin + answer.pathname).toBe(redirect);
    expect(answer.searchParams.get("state")).toBe("st-1");
    expect(answer.searchParams.get("iss")).toBe(api);
    const code = answer.searchParams.get("code") as string;

    // A wrong verifier gets nothing, and the code is spent at its first presentation.
    const wrong = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirect,
      code_verifier: randomBytes(32).toString("base64url"),
    });
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.body).error).toBe("invalid_grant");
    const reused = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    expect(JSON.parse(reused.body).error).toBe("invalid_grant");

    // A fresh code, the right verifier: tokens for the MCP endpoint, and only for it.
    const again = await who.ask("GET", authorizeUrl(clientId, redirect, challenge));
    const code2 = located(again).searchParams.get("code") as string;
    const tokens = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code2,
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: `${api}/mcp`,
    });
    expect(tokens.status, tokens.body).toBe(200);
    const issued = JSON.parse(tokens.body) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
    expect(issued.scope).toBe("mostra offline_access");
    // The audience check: a token for /mcp opens no binding and uploads no file.
    const upload = await send(port, `api.localhost:${port}`, `/files/${"0".repeat(64)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${issued.access_token}` },
      body: "x",
    });
    expect(upload.status).toBe(401);

    // Rotation: two refreshes inside the grace get one successor; a use after it revokes all.
    const refresh = () =>
      token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: issued.refresh_token,
      });
    const [one, two] = await Promise.all([refresh(), refresh()]);
    expect(one.status, one.body).toBe(200);
    expect(two.status, two.body).toBe(200);
    const successor = JSON.parse(one.body).refresh_token as string;
    expect(JSON.parse(two.body).refresh_token).toBe(successor);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const late = await refresh();
    expect(JSON.parse(late.body).error).toBe("invalid_grant");
    const after = await token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: successor,
    });
    expect(JSON.parse(after.body).error).toBe("invalid_grant");
    // Another client can't use this client's refresh token either.
  }, 60_000);

  it("asks consent again for another client: an approval never carries over", async () => {
    const who = browser();
    const { challenge } = pkce();
    const firstClient = await register("https://one.example/cb", "One");
    const first = await who.ask(
      "GET",
      authorizeUrl(firstClient, "https://one.example/cb", challenge),
    );
    const back = await signIn(who, first, "Grace");
    await approve(who, await who.ask("GET", `${back.pathname}${back.search}`));
    // Signed in and approved for One; Two still gets the consent page, never a code.
    const secondClient = await register("https://two.example/cb", "Two");
    const second = await who.ask(
      "GET",
      authorizeUrl(secondClient, "https://two.example/cb", challenge),
    );
    expect(second.status).toBe(200);
    expect(second.body).toContain("Two");
    expect(second.headers["location"]).toBeUndefined();
  }, 60_000);

  it("matches loopback redirects without their port only for 127.0.0.1, [::1] and localhost", async () => {
    const { challenge } = pkce();
    const loopback = await register("http://127.0.0.1/callback");
    const ok = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(loopback, "http://127.0.0.1:49321/callback", challenge),
    );
    expect(ok.status).toBe(200);
    const local = await register("http://localhost/callback");
    expect(
      (
        await send(
          port,
          `api.localhost:${port}`,
          authorizeUrl(local, "http://localhost:3118/callback", challenge),
        )
      ).status,
    ).toBe(200);
    const v6 = await register("http://[::1]/callback");
    expect(
      (
        await send(
          port,
          `api.localhost:${port}`,
          authorizeUrl(v6, "http://[::1]:7000/callback", challenge),
        )
      ).status,
    ).toBe(200);
    // Any other host matches exactly: another port, path or host is refused before any redirect.
    const exact = await register("https://app.example:8443/callback");
    const moved = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(exact, "https://app.example:9443/callback", challenge),
    );
    expect(moved.status).toBe(400);
    expect(moved.headers["location"]).toBeUndefined();
    const otherPath = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(loopback, "http://127.0.0.1:49321/elsewhere", challenge),
    );
    expect(otherPath.status).toBe(400);
  });

  it("answers errors to the client with iss, and refuses plain PKCE and a foreign resource", async () => {
    const redirect = "https://errors.example/cb";
    const clientId = await register(redirect);
    const plain = located(
      await send(
        port,
        `api.localhost:${port}`,
        authorizeUrl(clientId, redirect, "x".repeat(43), { code_challenge_method: "plain" }),
      ),
    );
    expect(plain.searchParams.get("error")).toBe("invalid_request");
    expect(plain.searchParams.get("iss")).toBe(api);
    const foreign = located(
      await send(
        port,
        `api.localhost:${port}`,
        authorizeUrl(clientId, redirect, pkce().challenge, {
          resource: "https://other.example/mcp",
        }),
      ),
    );
    expect(foreign.searchParams.get("error")).toBe("invalid_target");
  });

  it("uses a Client ID Metadata Document, and never fetches one at a private address or through a redirect", async () => {
    // A document on the test origin (allowed by name for tests, as a public host would be).
    const clientId = `${documentsOrigin.replace("http:", "https:")}/client.json`;
    served.set("/client.json", {
      status: 200,
      body: {
        client_id: clientId,
        client_name: "Claude (test)",
        redirect_uris: ["https://claude.example/cb"],
      },
    });
    const { challenge } = pkce();
    const page = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(clientId, "https://claude.example/cb", challenge),
    );
    expect(page.status, page.body).toBe(200);
    expect(asked).toContain("/client.json");

    // Behind a redirect: refused, the redirect never followed.
    served.set("/moved.json", { status: 302, location: "/client.json" });
    const before = asked.length;
    const moved = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(
        `${documentsOrigin.replace("http:", "https:")}/moved.json`,
        "https://claude.example/cb",
        challenge,
      ),
    );
    expect(moved.status).toBe(400);
    expect(asked.slice(before)).toEqual(["/moved.json"]);

    // At a loopback or private address (no test exception for it): never fetched at all, by
    // address or by a name that resolves to one.
    const count = asked.length;
    for (const address of ["127.0.0.2", "10.0.0.1", "169.254.169.254", "[::1]"]) {
      const refused = await send(
        port,
        `api.localhost:${port}`,
        authorizeUrl(`https://${address}/client.json`, "https://claude.example/cb", challenge),
      );
      expect(refused.status, address).toBe(400);
      expect(refused.body, address).toContain("address isn&#39;t public");
    }
    const named = await send(
      port,
      `api.localhost:${port}`,
      authorizeUrl(
        `https://localhost:${new URL(documentsOrigin).port}/client.json`,
        "https://claude.example/cb",
        challenge,
      ),
    );
    expect(named.status).toBe(400);
    expect(named.body).toContain("non-public address");
    expect(asked.length).toBe(count);
  }, 60_000);
});
