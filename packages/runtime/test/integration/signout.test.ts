/**
 * Signing out of the API origin's sign-in (MT-06, #204; INTERFACES §18.5): `POST /signout` ends a
 * browser's session, its row and its cookie, from the API origin's own pages (their `Origin` and a
 * CSRF token derived from the session) or from an operator's own app (`operatorClients`, its pages'
 * exact `Origin`), and the next authorization in that browser goes through the provider again. A
 * sign-out from anywhere else, with another session's token, or by a `GET` ends nothing. A client's
 * sign-out returns only to an address it registered (`post_logout_redirect_uris`, OpenID Connect
 * RP-Initiated Logout 1.0). `prompt=login` signs the person in through the provider though a
 * session exists, `prompt=consent` asks for consent again, and any other `prompt` is refused. The
 * periodic sweep removes expired sessions and sign-ins in progress.
 *
 * A real `mostra-runtime server` with a fake GitHub as its provider (every call to its
 * authorization page counted), a metadata-document server for the clients, and a browser played
 * with plain requests and a cookie jar for the API origin.
 */

import { writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiBrowser,
  approve,
  authorizeUrl,
  located,
  pageForm,
  pkce,
  register,
} from "../oauth-support.ts";
import { type FakeGitHub, fakeGitHub } from "../provider-fakes.ts";
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

/** The hidden fields of a page's form that posts to `/signout`. */
const signOutForm = (page: Reply): Record<string, string> => pageForm(page, "/signout").fields;

describe("signing out of the server's sign-in (MT-06)", () => {
  let port: number;
  let server: RunningServer;
  let api: string;
  let github: FakeGitHub;
  let documents: Server;
  let documentsOrigin: string;
  const data = tempDir("signout-data");
  const secrets = tempDir("signout-secrets");
  const redirect = "https://client.example/callback";
  let clientId: string;
  /** The operator's own app: its metadata document, its pages' origin and where it comes back. */
  let ownApp: string;
  let ownBack: string;

  beforeAll(async () => {
    github = await fakeGitHub({
      secret: "gh-secret",
      user: () => ({ id: 4242, login: "ada", name: "Ada" }),
    });
    writeFileSync(join(secrets, "github"), "gh-secret");
    documents = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const id = `${documentsOrigin.replace("http:", "https:")}${request.url ?? ""}`;
      response.end(
        JSON.stringify({
          client_id: id,
          client_name: "A name the app gives itself",
          redirect_uris: [`${documentsOrigin.replace("http:", "https:")}/account/callback`],
          post_logout_redirect_uris: [`${documentsOrigin}/account/signed-out`],
        }),
      );
    });
    await new Promise<void>((resolve) => documents.listen(0, "127.0.0.1", resolve));
    documentsOrigin = `http://localhost:${(documents.address() as AddressInfo).port}`;
    ownApp = `${documentsOrigin.replace("http:", "https:")}/account.json`;
    ownBack = `${documentsOrigin}/account/signed-out`;
    port = await freePort();
    api = `http://api.localhost:${port}`;
    server = await startServer({
      data,
      port,
      config: testConfig(port, {
        identityProviders: [
          {
            id: "github",
            kind: "github",
            clientId: "gh-client",
            clientSecretFile: join(secrets, "github"),
          },
        ],
        operatorClients: [{ clientId: ownApp, name: "Example Cloud account" }],
      }),
      env: {
        MOSTRA_TEST_GITHUB_BASE: github.origin,
        MOSTRA_TEST_CIMD_ORIGIN: documentsOrigin,
      },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    clientId = await register(port, redirect, "A chat app");
  }, 60_000);

  afterAll(async () => {
    await stopServer(server);
    github.close();
    documents.close();
  });

  const browser = () => new ApiBrowser(port, `api.localhost:${port}`);
  /** The browser sessions the directory holds, read as a backup replicator reads it. */
  const sessions = (): number => {
    const db = new Database(join(data, "server.sqlite"), { readonly: true });
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM browser_session").get() as { n: number }).n;
    } finally {
      db.close();
    }
  };

  /** Follows redirects by hand, through GitHub's fake and back to the API origin; the last answer. */
  const follow = async (who: ApiBrowser, first: Reply): Promise<Reply> => {
    let reply = first;
    for (let hop = 0; hop < 8; hop += 1) {
      if (reply.status !== 302 && reply.status !== 303) return reply;
      const next = new URL(String(reply.headers["location"]), api);
      if (next.host === `api.localhost:${port}`) {
        reply = await who.ask("GET", `${next.pathname}${next.search}`);
      } else if (next.origin === github.origin) {
        const answer = await fetch(next, { redirect: "manual" });
        const back = new URL(answer.headers.get("location") ?? "");
        reply = await who.ask("GET", `${back.pathname}${back.search}`);
      } else return reply;
    }
    return reply;
  };

  /** Clicks "Continue with GitHub" on a sign-in page; the answer once back on the API origin. */
  const viaGitHub = async (who: ApiBrowser, page: Reply): Promise<Reply> => {
    expect(page.status, page.body).toBe(200);
    const start = /href="(\/signin\/github\/start\?next=[^"]+)"/.exec(page.body);
    expect(start, page.body).not.toBeNull();
    return follow(
      who,
      await who.ask("GET", (start as RegExpExecArray)[1]?.replace(/&amp;|&#38;/g, "&") ?? ""),
    );
  };

  /** An authorization request of the registered client; its PKCE challenge. */
  const authorize = (who: ApiBrowser, extra: Record<string, string> = {}): Promise<Reply> =>
    who.ask("GET", authorizeUrl(api, clientId, redirect, pkce().challenge, extra));

  /** A browser signed in through GitHub, with the client approved: back at the client with a code. */
  const signedIn = async (): Promise<ApiBrowser> => {
    const who = browser();
    const consent = await viaGitHub(who, await authorize(who));
    const back = consent.status === 200 ? await approve(who, consent) : located(consent);
    expect(back.origin).toBe("https://client.example");
    expect(back.searchParams.get("code")).toBeTruthy();
    return who;
  };

  it("advertises the sign-out and the prompts it takes", async () => {
    const metadata = JSON.parse(
      (await send(port, `api.localhost:${port}`, "/.well-known/oauth-authorization-server")).body,
    ) as Record<string, unknown>;
    expect(metadata["end_session_endpoint"]).toBe(`${api}/signout`);
    expect(metadata["prompt_values_supported"]).toEqual(["login", "consent"]);
  });

  it("ends the session from the API origin's own pages, and the next sign-in asks the provider again", async () => {
    const who = await signedIn();
    const asked = github.scopes.length;
    // Signed in: the next authorization goes straight back to the client, asking no provider.
    expect(located(await authorize(who)).searchParams.get("code")).toBeTruthy();
    expect(github.scopes.length).toBe(asked);
    // Every page that shows who is signed in says so, with its "Sign out": the device page here.
    const device = await who.ask("GET", "/device?user_code=ABCD-EFGH");
    expect(device.body).toContain("Signed in as <strong>Ada</strong>");
    const fields = signOutForm(device);
    expect(fields["next"]).toBe("/device?user_code=ABCD-EFGH");
    const before = sessions();
    const out = await who.ask("POST", "/signout", fields);
    expect(out.status, out.body).toBe(303);
    expect(String(out.headers["location"])).toBe(
      `${api}/signout?next=${encodeURIComponent("/device?user_code=ABCD-EFGH")}`,
    );
    // Its row is gone and its cookie cleared.
    expect(sessions()).toBe(before - 1);
    expect(String(out.headers["set-cookie"])).toMatch(/mostra-signin=; .*Max-Age=0/);
    expect(who.jar.has("mostra-signin")).toBe(false);
    // The page it lands on says so, with the way back to where the person was.
    const done = await who.ask(
      "GET",
      String(
        new URL(String(out.headers["location"])).pathname +
          new URL(String(out.headers["location"])).search,
      ),
    );
    expect(done.status).toBe(200);
    expect(done.body).toMatch(/You(&#39;|&#x27;|')re signed out/);
    expect(done.body).toContain('href="/device?user_code=ABCD-EFGH"');
    // The next authorization shows the sign-in page and goes through GitHub again.
    const again = await authorize(who);
    expect(again.status, again.body).toBe(200);
    expect(again.body).toContain("Continue with GitHub");
    const back = located(await viaGitHub(who, again));
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(github.scopes.length).toBe(asked + 1);
  });

  it("ends nothing for a sign-out from another origin, without the session's token, or by a GET", async () => {
    const who = await signedIn();
    const fields = signOutForm(await who.ask("GET", "/device"));
    const before = sessions();
    const stillIn = async () => {
      expect(located(await authorize(who)).searchParams.get("code")).toBeTruthy();
      expect(sessions()).toBe(before);
    };
    // Another origin: a tenant's page, any other site, or no Origin at all.
    for (const origin of [
      `http://abc.content.localhost:${port}`,
      "https://elsewhere.example",
      "",
    ]) {
      const refused = await who.ask(
        "POST",
        "/signout",
        fields,
        origin === "" ? { origin: "null" } : { origin },
      );
      expect(refused.status, origin).toBe(403);
      expect(refused.headers["set-cookie"], origin).toBeUndefined();
      await stillIn();
    }
    // Its own origin with a token that isn't this session's.
    const forged = await who.ask("POST", "/signout", { ...fields, csrf: "x".repeat(43) });
    expect(forged.status).toBe(403);
    await stillIn();
    // A client that isn't the operator's own app, from its own pages' origin.
    const app = `${documentsOrigin.replace("http:", "https:")}/other-app.json`;
    const other = await who.ask(
      "POST",
      "/signout",
      { client_id: app, post_logout_redirect_uri: ownBack },
      { origin: documentsOrigin },
    );
    expect(other.status).toBe(403);
    await stillIn();
    // A GET is a page with one button, and ends nothing (D98), a client's sign-out link included.
    for (const path of [
      "/signout",
      `/signout?${new URLSearchParams({ client_id: ownApp, post_logout_redirect_uri: ownBack })}`,
    ]) {
      const page = await who.ask("GET", path);
      expect(page.status, path).toBe(200);
      expect(page.body).toContain("Sign out?");
      expect(page.headers["set-cookie"]).toBeUndefined();
      await stillIn();
    }
  });

  it("lets the operator's own app sign the person out from its pages, back only to an address it registered", async () => {
    const who = await signedIn();
    const before = sessions();
    const out = await who.ask(
      "POST",
      "/signout",
      { client_id: ownApp, post_logout_redirect_uri: ownBack, state: "st-9" },
      { origin: documentsOrigin },
    );
    expect(out.status, out.body).toBe(303);
    expect(String(out.headers["location"])).toBe(`${ownBack}?state=st-9`);
    expect(sessions()).toBe(before - 1);
    expect(who.jar.has("mostra-signin")).toBe(false);
    expect((await authorize(who)).body).toContain("Continue with GitHub");

    // From another site, whose form a browser sends without the cookie: the cookie is cleared all
    // the same, and the person goes back.
    const crossSite = await who.ask(
      "POST",
      "/signout",
      { client_id: ownApp, post_logout_redirect_uri: ownBack },
      { origin: documentsOrigin, cookie: "" },
    );
    expect(crossSite.status).toBe(303);
    expect(String(crossSite.headers["set-cookie"])).toMatch(/mostra-signin=; .*Max-Age=0/);

    // An address the app didn't register is never where anyone is sent: not another one, not its
    // redirect URI's origin, not a lookalike; the person lands on this server's own page.
    for (const back of [
      "https://elsewhere.example/signed-out",
      documentsOrigin,
      `${ownBack}/../..`,
      `${ownBack}x`,
    ]) {
      const signed = await signedIn();
      const refused = await signed.ask(
        "POST",
        "/signout",
        { client_id: ownApp, post_logout_redirect_uri: back },
        { origin: documentsOrigin },
      );
      expect(refused.status, back).toBe(303);
      expect(String(refused.headers["location"]), back).toBe(`${api}/signout`);
      const page = await signed.ask(
        "GET",
        `/signout?${new URLSearchParams({ client_id: ownApp, post_logout_redirect_uri: back })}`,
      );
      expect(page.status, back).toBe(400);
    }
  });

  it("lets any client send the person to a page with one button, which then goes back to the client", async () => {
    const who = await signedIn();
    const link = `/signout?${new URLSearchParams({ client_id: ownApp, post_logout_redirect_uri: ownBack, state: "s2" })}`;
    const page = await who.ask("GET", link);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Example Cloud account");
    // The page's form may send its answer on to the address it goes back to.
    expect(String(page.headers["content-security-policy"])).toContain(
      `form-action 'self' ${documentsOrigin}`,
    );
    const out = await who.ask("POST", "/signout", signOutForm(page));
    expect(out.status).toBe(303);
    expect(String(out.headers["location"])).toBe(`${ownBack}?state=s2`);
    // Signed out, the same link goes straight back: there is nothing to ask.
    const again = await who.ask("GET", link);
    expect(again.status).toBe(303);
    expect(String(again.headers["location"])).toBe(`${ownBack}?state=s2`);
  });

  it("asks the provider again with prompt=login though a session exists, and asks consent again with prompt=consent", async () => {
    const who = await signedIn();
    const asked = github.scopes.length;
    const oldCookie = who.jar.get("mostra-signin");
    const page = await authorize(who, { prompt: "login" });
    expect(page.status, page.body).toBe(200);
    expect(page.body).toContain("Continue with GitHub");
    // The session the browser has is shown with its "Sign out", never used: the flow's own
    // continuation still asks for a sign-in until one is made for it.
    expect(page.body).toContain("Signed in as <strong>Ada</strong>");
    const resume = signOutForm(page)["next"] as string;
    const skipped = await who.ask("GET", resume);
    expect(skipped.status).toBe(200);
    expect(skipped.body).toContain("Continue with GitHub");
    // Through GitHub again: the new sign-in replaces the browser's session, and consent is kept.
    const back = located(await viaGitHub(who, page));
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(github.scopes.length).toBe(asked + 1);
    expect(who.jar.get("mostra-signin")).not.toBe(oldCookie);
    const stale = new ApiBrowser(port, `api.localhost:${port}`);
    stale.jar.set("mostra-signin", oldCookie as string);
    expect((await authorize(stale)).body).toContain("Continue with GitHub");

    // prompt=consent: the consent page again, though this client was approved.
    const consent = await authorize(who, { prompt: "consent" });
    expect(consent.status, consent.body).toBe(200);
    expect(consent.body).toContain("Allow A chat app?");
    expect(consent.body).toContain("Signed in as <strong>Ada</strong>");
    expect((await approve(who, consent)).searchParams.get("code")).toBeTruthy();
    // Both at once.
    const both = await authorize(who, { prompt: "login consent" });
    expect(both.body).toContain("Continue with GitHub");
    const allow = await viaGitHub(who, both);
    expect(allow.body).toContain("Allow A chat app?");
  });

  it("refuses a prompt it doesn't implement rather than ignore it", async () => {
    const who = await signedIn();
    for (const prompt of ["none", "select_account", "login none", "create", "", "login  consent"]) {
      const answer = located(await authorize(who, { prompt }));
      expect(answer.origin, prompt).toBe("https://client.example");
      expect(answer.searchParams.get("error"), prompt).toBe("invalid_request");
      expect(answer.searchParams.get("code"), prompt).toBeNull();
    }
  });
});

describe("the sweep of expired sign-ins (MT-06)", () => {
  it("removes a browser session once it expired, and its cookie signs nobody in", async () => {
    const port = await freePort();
    const data = tempDir("signout-sweep-data");
    const server = await startServer({
      data,
      port,
      env: { MOSTRA_TEST_SIGNIN_SESSION_MS: "1500", MOSTRA_TEST_SIGNIN_SWEEP_MS: "250" },
    });
    try {
      expect(server.status.status, server.stderr()).toBe("started");
      const api = `http://api.localhost:${port}`;
      const who = new ApiBrowser(port, `api.localhost:${port}`);
      const redirect = "https://client.example/callback";
      const client = await register(port, redirect);
      const page = await who.ask("GET", authorizeUrl(api, client, redirect, pkce().challenge));
      const start = /href="(\/signin\/dev\/start\?next=[^"]+)"/.exec(page.body)?.[1] as string;
      const toName = located(await who.ask("GET", start.replace(/&amp;|&#38;/g, "&")));
      located(
        await who.ask("POST", "/signin/dev/name", {
          state: toName.searchParams.get("state") as string,
          name: "Ada",
        }),
      );
      const count = (table: string): number => {
        const db = new Database(join(data, "server.sqlite"), { readonly: true });
        try {
          return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
        } finally {
          db.close();
        }
      };
      expect(count("browser_session")).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(count("browser_session")).toBe(0);
      const again = await who.ask("GET", authorizeUrl(api, client, redirect, pkce().challenge));
      expect(again.body).toContain("Continue with Development sign-in");
    } finally {
      await stopServer(server);
    }
  }, 60_000);
});
