/**
 * The hosted shell's rules and viewers, through the real server (HY-08, HY-09; ARCHITECTURE §15.6,
 * §15.7; INTERFACES §18.4; D161, D165 items 7, 8): no artifact file is served from a domain's apex
 * or the API origin; every hosted response keeps its agent cluster, sets no cookie and names only
 * its domain's shell as a framer; no check trusts `Sec-Fetch-Site: same-site`; previews are one
 * for every artifact; a cookie tossed onto the parent domain, one named like a session and a jar
 * filled past 180 cookies change nothing; anonymous and account viewers are recorded as such, a
 * forged identity names nobody, and a link without sign-in works within its scopes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, type Opened, openLink, seen } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const REVISION = "2026-10-15";

describe("the hosted shell's rules and viewers (HY-08, HY-09)", () => {
  let port: number;
  let server: RunningServer;
  const owner = new GatewayHome();
  let apex: string;
  let api: string;

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({ data: tempDir("rules-data"), port });
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    apex = `http://content.localhost:${port}`;
    api = `http://api.localhost:${port}`;
  }, 120_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  const share = async (
    fixture: string,
    entry?: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ url: string; artifactId: string }> => {
    const receipt = await owner.publish(fixture, entry);
    const shared = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
        ...extra,
      }),
    );
    return { url: shared.url, artifactId: receipt.artifactId };
  };

  /** Writes an answer in the frame and submits it through the shell. */
  const answer = async (browser: Browser, opened: Opened, value: string) => {
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: `mut_01JB8Z3QF6S7W3N8D5K2C4V9${String(Math.floor(Math.random() * 90) + 10)}`,
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value }],
      },
      csrf: opened.frameCsrf,
    });
    expect(fields.status, fields.body).toBe(200);
    const submitted = await browser.fetchJson(
      opened.link.shell,
      `/a/${opened.link.artifactId}/_mostra/v/${REVISION}/submit`,
      {
        body: {
          viewId: opened.viewId,
          expectedRevision: fields.json<{ revision: string }>().revision,
        },
        csrf: opened.shellCsrf,
      },
    );
    return { submitted };
  };

  it("serves no artifact file from the apex or the API origin, only from the route's label (HY-09)", async () => {
    const { url } = await share("single-tsx", "page.tsx");
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const asset = /\/assets\/[^"']+\.js/.exec(opened.page.body)?.[0];
    expect(asset, opened.page.body).toBeDefined();
    const route = `/a/${opened.link.artifactId}`;
    // On its label the frame's session gets the file.
    const own = await browser.ask({
      url: `${opened.frameOrigin}${asset}`,
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(own.status).toBe(200);
    // Nowhere else: not the apex, not under the route's shell path, not the API origin.
    for (const elsewhere of [
      `${apex}${asset}`,
      `${apex}${route}${asset}`,
      `${apex}/_mostra/enter`,
      `${apex}/_mostra/sw.js`,
      `${api}${asset}`,
      `${api}${route}`,
    ]) {
      const answer = await browser.ask({
        url: elsewhere,
        headers: { "sec-fetch-site": "same-origin" },
      });
      expect(answer.status, elsewhere).not.toBe(200);
      expect(answer.body, elsewhere).not.toContain("<script");
    }
  }, 120_000);

  it("keeps every hosted answer in its agent cluster, sets no cookie, and frames only under its domain's shell (HY-09)", async () => {
    const { url } = await share("single-tsx", "page.tsx");
    const browser = new Browser();
    const before = seen.length;
    const opened = await openLink(browser, url);
    // Every answer opening a link took was a hosted host's: the apex or the route's label.
    const hosted = seen.slice(before);
    expect(hosted.length).toBeGreaterThan(3);
    for (const answer of hosted) {
      expect(answer.header("origin-agent-cluster")).toBe("?1");
      expect(answer.headers["set-cookie"]).toBeUndefined();
      expect(answer.header("cross-origin-resource-policy")).toBe("same-origin");
    }
    // The shell page frames nothing of its own and is framed by nothing.
    const shellPage = await browser.navigate(url.replace(/#.*$/, ""));
    expect(shellPage.header("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(shellPage.header("content-security-policy")).toContain(
      "require-trusted-types-for 'script'",
    );
    expect(shellPage.header("x-frame-options")).toBe("DENY");
    // Every document on the label, the worker-mode bootstrap included, names only this domain's shell.
    const boot = await browser.navigate(`${opened.frameOrigin}/_mostra/enter`, apex);
    for (const document of [boot, opened.page]) {
      const policy = document.header("content-security-policy") ?? "";
      expect(/frame-ancestors ([^;]+)/.exec(policy)?.[1]?.trim()).toBe(apex);
    }
    // A shell asset is same-origin only.
    const asset = /\/_mostra\/shell\/assets\/[^"']+\.js/.exec(shellPage.body)?.[0];
    const shellAsset = await browser.ask({
      url: `${apex}${asset}`,
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(shellAsset.status).toBe(200);
    expect(shellAsset.header("cross-origin-resource-policy")).toBe("same-origin");
  }, 120_000);

  it("trusts no `Sec-Fetch-Site: same-site`: a sibling label is another origin (HY-09)", async () => {
    const { url } = await share("single-tsx", "page.tsx");
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const sibling = `http://00000000000000000000000000.content.localhost:${port}`;
    // The shell's exchange and its trusted Submit, sent from a sibling tenant's page.
    const exchange = await browser.ask({
      method: "POST",
      url: `${apex}/a/${opened.link.artifactId}/_mostra/session`,
      headers: {
        origin: sibling,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: opened.link.secret }),
      noCookies: true,
    });
    expect(exchange.status).toBe(403);
    const submit = await browser.ask({
      method: "POST",
      url: `${apex}/a/${opened.link.artifactId}/_mostra/v/${REVISION}/submit`,
      headers: {
        origin: sibling,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
        "x-mostra-csrf": opened.shellCsrf,
      },
      body: JSON.stringify({ viewId: opened.viewId, expectedRevision: "0" }),
    });
    expect(submit.status).toBe(403);
    // The frame's own write, from the shell's origin (same-site, another origin).
    const write = await browser.ask({
      method: "POST",
      url: `${opened.frameOrigin}/_mostra/v/${REVISION}/fields`,
      headers: {
        origin: apex,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
        "x-mostra-csrf": opened.frameCsrf,
      },
      body: JSON.stringify({
        mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9X1",
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [],
      }),
    });
    expect(write.status).toBe(403);
    // Sign-in starts only on the shell's own origin.
    const signIn = await browser.ask({
      method: "POST",
      url: `${apex}/a/${opened.link.artifactId}/_mostra/session/signin/start`,
      headers: {
        origin: opened.frameOrigin,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
        "x-mostra-csrf": opened.shellCsrf,
      },
      body: JSON.stringify({ challenge: "x".repeat(43) }),
    });
    expect(signIn.status).toBe(403);
  }, 120_000);

  it("shows one preview for every artifact, the title only when its owner opts in, and noindex (D161)", async () => {
    const one = await share("single-tsx", "page.tsx");
    const two = await share("directory");
    const browser = new Browser();
    const pageOf = async (url: string) => (await browser.navigate(url.replace(/#.*$/, ""))).body;
    const first = await pageOf(one.url);
    const second = await pageOf(two.url);
    expect(first).toBe(second);
    expect(first).toContain("<title>A page sent with Mostra</title>");
    expect(first).toContain('content="noindex, nofollow"');
    for (const artifactId of [one.artifactId, two.artifactId]) {
      const detail = ok<{ title: string }>(
        await owner.client.call("artifact/get", { artifact: { artifactId } }),
      );
      expect(first).not.toContain(detail.title);
    }
    // An owner who opts in shows the title alone, as text.
    const titled = await pageOf((await share("hosted-title")).url);
    expect(titled).toContain("<title>Plans &#38; &#60;ideas&#62; for &#34;Q4&#34;</title>");
    expect(titled).not.toContain("<ideas>");
    expect(titled).not.toContain("private plans");
  }, 120_000);

  it("keeps every session through a tossed, a shadowing and a flooding cookie (HY-08, D165 item 8)", async () => {
    const { url } = await share("single-tsx", "page.tsx");
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const route = `/a/${opened.link.artifactId}`;
    const secret = browser.shells.get(`${apex}${route}`) as string;
    // What a sibling tenant page can make the browser send: a cookie for the parent domain, one
    // named like a session, and the jar filled past Chromium's 180 cookies of 4 KiB each.
    const flood = Array.from(
      { length: 200 },
      (_, index) => `fill${index}=${"x".repeat(4000)}`,
    ).join("; ");
    const jars = [
      "session=tossed-onto-the-parent-domain",
      `mostra-0=${"A".repeat(26)}; mostra-session=${"B".repeat(26)}; x-mostra-shell=${"C".repeat(26)}`,
      flood,
    ];
    for (const cookie of jars) {
      const shell = await browser.ask({
        url: `${apex}${route}/_mostra/session`,
        headers: { cookie, "x-mostra-shell": secret, "sec-fetch-site": "same-origin" },
        noCookies: true,
      });
      expect(shell.status, cookie.slice(0, 40)).toBe(200);
      const frame = await browser.ask({
        url: `${opened.frameOrigin}/_mostra/session`,
        headers: { cookie, "sec-fetch-site": "same-origin" },
      });
      expect(frame.status, cookie.slice(0, 40)).toBe(200);
    }
    // And a fresh link opens with the flood in the jar.
    const again = await browser.ask({
      method: "POST",
      url: `${apex}${route}/_mostra/session`,
      headers: {
        cookie: flood,
        origin: apex,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: opened.link.secret }),
      noCookies: true,
    });
    expect(again.status, again.body).toBe(200);
  }, 120_000);

  it("records an anonymous viewer as unverified, names nobody from a forged claim, and holds a link to its scopes (HY-08)", async () => {
    const { url, artifactId } = await share("single-tsx", "page.tsx");
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const route = `/a/${opened.link.artifactId}`;
    // Headers that name a person elsewhere name nobody on a hosted host, and a made-up sign-in
    // code is refused, leaving the session anonymous.
    const forged = await browser.ask({
      method: "POST",
      url: `${apex}${route}/_mostra/session/signin`,
      headers: {
        origin: apex,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-mostra-csrf": opened.shellCsrf,
        "tailscale-user-login": "grace@example.com",
        "tailscale-user-name": "Grace Hopper",
      },
      body: JSON.stringify({
        code: "a".repeat(43),
        verifier: "b".repeat(43),
        state: "c".repeat(43),
      }),
    });
    expect(forged.status).toBe(403);
    const { submitted } = await answer(browser, opened, "anonymous answer");
    expect(submitted.status, submitted.body).toBe(200);
    const waited = ok<{ status: string }>(
      await owner.client.call(
        "wait",
        { artifact: { artifactId }, until: "submitted", timeoutMs: 20_000 },
        30_000,
      ),
    );
    expect(waited.status).toBe("satisfied");
    const results = ok<{
      submission: { viewer: { kind: string; verified?: boolean; name?: string } };
    }>(await owner.client.call("results/get", { artifact: { artifactId } }));
    expect(results.submission.viewer.kind).toBe("anonymous");
    expect(results.submission.viewer.verified).toBe(false);
    expect(results.submission.viewer.name).not.toBe("Grace Hopper");

    // A link with the view scope only shows the page, and its Submit is refused.
    const viewOnly = await share("directory", undefined, { scopes: ["view"] });
    const looker = new Browser();
    const looked = await openLink(looker, viewOnly.url);
    expect(looked.page.status).toBe(200);
    const refused = await looker.fetchJson(
      looked.link.shell,
      `/a/${looked.link.artifactId}/_mostra/v/${REVISION}/submit`,
      {
        body: { viewId: looked.viewId, expectedRevision: "0" },
        csrf: looked.shellCsrf,
      },
    );
    expect(refused.status).toBe(403);
  }, 120_000);
});
