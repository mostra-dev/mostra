/**
 * What sign-in tells an operator, and who verified a name (MT-03; INTERFACES §18.5, §18.6; D161):
 * a real `mostra-runtime server` with the fixture operator module, fake GitHub and OpenID Connect
 * providers, and real owner instances. GitHub's public counts arrive in `facts` from the same
 * lookup; an `oidc` entry's chosen claims arrive under their names, and nothing new without them;
 * the sender line's verifier is the one recorded on the owner's identity when it signed in, so a
 * provider renamed in the configuration changes no verified name, an identity from before the
 * record takes the configuration's verifier once, and a provider the operator module supplies is
 * verified exactly when it says so (`IdentityProvider.verifies`).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { ApiBrowser } from "../oauth-support.ts";
import { type Call, control } from "../operator-support.ts";
import { type FakeProvider, fakeGitHub, fakeOidc } from "../provider-fakes.ts";
import {
  freePort,
  ownerEnv,
  type Reply,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));

describe("sign-in's facts and the verifier on each identity (MT-03)", () => {
  let port: number;
  let controlPort: number;
  let server: RunningServer;
  let operator: ReturnType<typeof control>;
  let github: FakeProvider;
  let oidc: FakeProvider;
  const data = tempDir("signin-facts-data");
  const secrets = tempDir("signin-facts-secrets");
  const owners: GatewayHome[] = [];
  let subject = "grace-1";

  /** The configured providers, with GitHub's entry under the ID a case gives it. */
  const providers = (githubId: string) => [
    {
      id: githubId,
      kind: "github",
      clientId: "gh-client",
      clientSecretFile: join(secrets, "github"),
    },
    {
      id: "corp",
      kind: "oidc",
      label: "Corp",
      issuer: oidc.origin,
      clientId: "mostra",
      clientSecretFile: join(secrets, "oidc"),
      claims: ["hd", "groups", "absent"],
    },
    {
      id: "plain",
      kind: "oidc",
      label: "Plain",
      issuer: oidc.origin,
      clientId: "mostra",
      clientSecretFile: join(secrets, "oidc"),
    },
  ];
  const start = async (githubId = "github") => {
    server = await startServer({
      data,
      port,
      config: testConfig(port, { operator: OPERATOR, identityProviders: providers(githubId) }),
      env: {
        MOSTRA_TEST_OIDC_INSECURE: "1",
        MOSTRA_TEST_GITHUB_BASE: github.origin,
        MOSTRA_TEST_OPERATOR_PORT: String(controlPort),
      },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
    await operator.set({
      providers: [
        { id: "acme", label: "Acme", who: "grace-acme", verifies: { label: "Acme SSO" } },
        { id: "loose", label: "Loose", who: "lin-loose" },
        // A label reversed by a bidirectional override, to read as another verifier's name.
        { id: "spoof", label: "Spoof", who: "sam-spoof", verifies: { label: "\u202EbuHtiG" } },
      ],
    });
  };

  /** Follows a sign-in's redirects by hand, through the provider and back; the last answer. */
  const follow = async (who: ApiBrowser, first: Reply): Promise<Reply> => {
    let reply = first;
    for (let hop = 0; hop < 8; hop += 1) {
      if (reply.status !== 302 && reply.status !== 303) return reply;
      const next = new URL(String(reply.headers["location"]), `http://api.localhost:${port}`);
      if (next.host === `api.localhost:${port}`) {
        reply = await who.ask("GET", `${next.pathname}${next.search}`);
      } else {
        // The provider's side: it approves at once and sends the browser back.
        const answer = await fetch(next, { redirect: "manual" });
        const back = new URL(answer.headers.get("location") ?? "");
        reply = await who.ask("GET", `${back.pathname}${back.search}`);
      }
    }
    return reply;
  };

  /** Signs a browser in through one provider; the identity `accounts.resolve` was asked about. */
  const signInThrough = async (provider: string): Promise<Record<string, unknown>> => {
    const before = (await operator.calls("accounts.resolve")).length;
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const done = await follow(who, await who.ask("GET", `/signin/${provider}/start?next=/device`));
    expect(done.status, done.body).toBe(200);
    const asked = (await operator.calls("accounts.resolve")).slice(before);
    expect(asked.length, JSON.stringify(asked)).toBeGreaterThan(0);
    return (asked.at(-1) as Call).payload;
  };

  /** A new owner instance, signed in to the server through `provider` on the device page. */
  const ownerThrough = async (provider: string): Promise<GatewayHome> => {
    const owner = new GatewayHome();
    owners.push(owner);
    await owner.start({ env: ownerEnv(port) });
    const started = ok<{ loginId: string; userCode: string }>(
      await owner.client.call("remote/login", { server: `http://api.localhost:${port}` }),
    );
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const page = await who.ask("GET", `/device?user_code=${encodeURIComponent(started.userCode)}`);
    const link = new RegExp(`href="(/signin/${provider}/start\\?next=[^"]+)"`).exec(page.body);
    expect(link, page.body).not.toBeNull();
    const approval = await follow(
      who,
      await who.ask("GET", (link as RegExpExecArray)[1]?.replace(/&amp;/g, "&") ?? ""),
    );
    const csrf = /name="csrf" value="([^"]+)"/.exec(approval.body)?.[1];
    expect(csrf, approval.body).toBeDefined();
    const approved = await who.ask("POST", "/device", {
      csrf: csrf as string,
      user_code: started.userCode,
      session_decision: "approve",
    });
    expect(approved.status, approved.body).toBe(200);
    const waited = await owner.client.call(
      "remote/login.wait",
      { loginId: started.loginId, timeoutMs: 30_000 },
      40_000,
    );
    expect((waited.result as { status?: string })?.status, JSON.stringify(waited)).toBe(
      "signed-in",
    );
    return owner;
  };

  /** Publishes and shares an artifact of the owner's; its hosted link. */
  const shareOf = async (owner: GatewayHome): Promise<string> => {
    const receipt = await owner.publish("single-tsx", "page.tsx");
    return ok<{ url: string }>(
      await owner.client.call(
        "share/start",
        { artifact: { artifactId: receipt.artifactId }, via: "remote" },
        60_000,
      ),
    ).url;
  };

  /** The sender line a hosted link's page shows: the owner's name and who verified it. */
  const senderOf = async (url: string): Promise<{ name?: string; verifiedBy?: string }> => {
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const ticket = await browser.fetchJson(
      opened.link.shell,
      `${new URL(url).pathname}/_mostra/ticket`,
      { body: {}, csrf: opened.shellCsrf },
    );
    expect(ticket.status, ticket.body).toBe(200);
    return ticket.json<{ hosted: { sender?: { name?: string; verifiedBy?: string } } }>().hosted
      .sender as { name?: string; verifiedBy?: string };
  };

  /** Waits until an owner's binding is connected again (after a server restart). */
  const connected = async (owner: GatewayHome): Promise<void> => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const links = ok<{ links: { state: string }[] }>(
        await owner.client.call("remote/status", {}),
      ).links;
      if (links[0]?.state === "connected") return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("the owner never connected again");
  };

  beforeAll(async () => {
    writeFileSync(join(secrets, "oidc"), "oidc-secret\n");
    writeFileSync(join(secrets, "github"), "gh-secret\n");
    github = await fakeGitHub({
      secret: "gh-secret",
      user: () => ({
        id: 4242,
        login: "ada",
        name: "Ada Lovelace",
        created_at: "2011-01-01T00:00:00Z",
        public_repos: 37,
        public_gists: 4,
        followers: 128,
      }),
    });
    oidc = await fakeOidc({
      secret: "oidc-secret",
      subject: () => subject,
      claims: () => ({ hd: "example.com", groups: ["staff", "ops"], acr: "1" }),
    });
    port = await freePort();
    controlPort = await freePort();
    await start();
  }, 120_000);

  afterAll(async () => {
    for (const owner of owners) await owner.stop();
    await stopServer(server);
    github?.close();
    oidc?.close();
  });

  it("passes GitHub's public counts in `facts`, from the same lookup", async () => {
    const identity = await signInThrough("github");
    expect(identity["provider"]).toBe("github");
    expect(identity["subject"]).toBe("4242");
    expect(identity["facts"]).toEqual({
      login: "ada",
      createdAt: "2011-01-01T00:00:00Z",
      publicRepos: 37,
      publicGists: 4,
      followers: 128,
    });
  }, 60_000);

  it("passes an OpenID Connect provider's chosen claims in `facts`, and nothing new without them", async () => {
    subject = "grace-corp";
    const chosen = await signInThrough("corp");
    // `hd` and `groups` as the ID token holds them; `absent` isn't in the token; `acr` wasn't chosen.
    expect(chosen["facts"]).toEqual({ hd: "example.com", groups: ["staff", "ops"] });
    subject = "grace-plain";
    const plain = await signInThrough("plain");
    expect(plain["facts"]).toBeUndefined();
    expect(plain).toMatchObject({
      provider: "plain",
      subject: "grace-plain",
      name: "Grace Hopper",
    });
  }, 60_000);

  it("keeps a name verified by a configured provider after the provider is renamed, and fills an older identity's verifier once", async () => {
    const owner = await ownerThrough("github");
    const url = await shareOf(owner);
    expect(await senderOf(url)).toEqual({ name: "Ada Lovelace", verifiedBy: "GitHub" });

    // The configuration renames the provider (`github` → `gh`): the sender line keeps the
    // verifier recorded when the owner signed in.
    await stopServer(server);
    await start("gh");
    await connected(owner);
    expect(await senderOf(url)).toEqual({ name: "Ada Lovelace", verifiedBy: "GitHub" });

    // An identity recorded before verifiers were (as an upgrade finds it) takes the verifier the
    // configuration names for its provider, once, at the next start.
    await stopServer(server);
    const db = new Database(join(data, "server.sqlite"));
    try {
      const changed = db
        .prepare(
          "UPDATE identity SET verified_by = NULL, verified_recorded_at = NULL WHERE provider = 'github' AND subject = '4242'",
        )
        .run().changes;
      expect(changed).toBe(1);
    } finally {
      db.close();
    }
    await start("github");
    await connected(owner);
    expect(await senderOf(url)).toEqual({ name: "Ada Lovelace", verifiedBy: "GitHub" });
    await stopServer(server);
    await start("gh");
    await connected(owner);
    expect(await senderOf(url)).toEqual({ name: "Ada Lovelace", verifiedBy: "GitHub" });

    // An identity whose shape isn't the kind the configuration now gives its provider ID takes no
    // verifier, since the configuration may have given that ID to another kind since: one shaped
    // as the development provider's (its subject the typed name, here digits), and, for GitHub, one
    // whose subject isn't a numeric user ID.
    for (const [shape, set] of [
      ["the development provider's", "name = subject"],
      ["a subject no GitHub user ID has", "subject = 'ada-lovelace'"],
    ] as const) {
      await stopServer(server);
      const typed = new Database(join(data, "server.sqlite"));
      try {
        const changed = typed
          .prepare(
            `UPDATE identity SET ${set}, verified_by = NULL, verified_recorded_at = NULL WHERE provider = 'github' AND account_id = (SELECT account_id FROM identity WHERE provider = 'github' AND subject IN ('4242', 'ada-lovelace'))`,
          )
          .run().changes;
        expect(changed, shape).toBe(1);
      } finally {
        typed.close();
      }
      await start("github");
      await connected(owner);
      expect(await senderOf(url), shape).toEqual({ name: "Ada Lovelace" });
    }
  }, 240_000);

  it("verifies a name through a provider the operator module supplies only when it says it verifies", async () => {
    const acme = await ownerThrough("acme");
    expect(await senderOf(await shareOf(acme))).toEqual({
      name: "Grace from Acme",
      verifiedBy: "Acme SSO",
    });
    const loose = await ownerThrough("loose");
    // No verifier: the page shows the name as "name not verified".
    expect(await senderOf(await shareOf(loose))).toEqual({ name: "Grace from Acme" });
    // A label with control or format characters (a reversed "GitHub") is no verifier either.
    const spoof = await ownerThrough("spoof");
    expect(await senderOf(await shareOf(spoof))).toEqual({ name: "Grace from Acme" });
  }, 180_000);
});
