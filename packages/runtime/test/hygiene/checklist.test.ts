/**
 * The hygiene checklist (HY-01, ARCHITECTURE §10, D96 to D99) as negative tests against a real
 * `mostra-runtime daemon`: every item refuses what a stranger's page, a rebinding attacker or a
 * guesser could send, and lets the capability holder through. Browser-level checks (framing,
 * cookie attributes in three engines, the bridge) are in `tests/e2e`.
 *
 * Item 13, MCP over HTTP, is WP-15's transport; it applies the same `checkRequest` (D96).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Answer,
  Browser,
  type Opened,
  openLink,
  parseLink,
  raw,
  seen,
  send,
} from "../browser-client.ts";
import { GatewayHome, type Receipt } from "../gateway-home.ts";

const gateway = new GatewayHome();
let receipt: Receipt;
let holder: Browser;
let opened: Opened;
let shellPort: number;
let framePort: number;
/** Every secret the suite handled: none may appear in a log or the ledger (item 12). */
const secrets: string[] = [];

beforeAll(async () => {
  await gateway.start();
  receipt = await gateway.publish("single-tsx", "page.tsx");
  holder = new Browser();
  opened = await openLink(holder, receipt.url);
  shellPort = Number(new URL(opened.link.shell).port);
  framePort = Number(new URL(opened.frameOrigin).port);
  secrets.push(
    opened.link.secret,
    opened.shellCsrf,
    opened.frameCsrf,
    new URL(opened.ticketSrc).searchParams.get("ticket") ?? "",
  );
  for (const cookie of holder.jar.values()) secrets.push(cookie.value);
  // More links, sessions and tickets, so item 12's check has material whichever tests run.
  for (const scopes of [undefined, ["review"], ["submit"]] as const) {
    const link = await gateway.link(receipt.artifactId, scopes ? { scopes: [...scopes] } : {});
    const browser = new Browser();
    const more = await openLink(browser, link.url);
    secrets.push(parseLink(link.url).secret, more.shellCsrf, more.frameCsrf);
    secrets.push(new URL(more.ticketSrc).searchParams.get("ticket") ?? "");
    for (const cookie of browser.jar.values()) secrets.push(cookie.value);
  }
}, 180_000);

afterAll(async () => {
  await gateway.stop();
});

const api = (): string => `/a/${receipt.artifactId}/_mostra`;
const code = (answer: Answer): string => `${answer.status} ${answer.json<{ code: string }>().code}`;

describe("the capability holder gets in", () => {
  it("opens the link: shell session, frame ticket, frame session, the version's page", () => {
    expect(opened.page.status).toBe(200);
    expect(opened.page.body).toContain("<title>single-tsx</title>");
    expect(opened.frameOrigin).not.toBe(opened.link.shell);
    expect(new URL(opened.frameOrigin).hostname).toBe(new URL(opened.link.shell).hostname);
  });
});

describe("item 1: loopback bind (HY-02)", () => {
  it("listens on 127.0.0.1 only", async () => {
    const status = await gateway.status();
    expect(status.gateway.bind).toBe("127.0.0.1");
    expect(new URL(status.gateway.shell).hostname).toBe("127.0.0.1");
  });
});

describe("item 2: exact Host allowlist (DNS rebinding)", () => {
  const hosts = (port: number) => [
    `localhost:${port}`,
    `evil.example:${port}`,
    `127.0.0.1:${port + 1}`,
    "127.0.0.1",
    `127.0.0.1.nip.io:${port}`,
    `[::1]:${port}`,
    `127.0.0.1:${port}.evil.example`,
  ];

  it("refuses every other Host with 421, on the shell and on the artifact origin", async () => {
    for (const [origin, port, path] of [
      [opened.link.shell, shellPort, `/a/${receipt.artifactId}`],
      [opened.frameOrigin, framePort, "/"],
    ] as const) {
      for (const host of hosts(port)) {
        const answer = await holder.ask({ url: `${origin}${path}`, headers: { host } });
        expect(code(answer), host).toBe("421 MOSTRA_HYGIENE_HOST_REFUSED");
        expect(answer.body).not.toContain("<title>single-tsx</title>");
      }
    }
  });

  it("refuses a request without Host", async () => {
    const answer = await raw(framePort, "GET / HTTP/1.0\r\n\r\n");
    expect(answer.status).toBe(421);
  });
});

describe("item 3: exact Origin on every non-GET, stream and upgrade", () => {
  const foreign = ["http://evil.example", `http://127.0.0.1:${0}`, "null", "http://localhost"];

  it("refuses a mutation from any other origin, or with none", async () => {
    for (const origin of [...foreign, opened.frameOrigin, `${opened.link.shell}/`]) {
      const answer = await holder.ask({
        method: "POST",
        url: `${opened.link.shell}${api()}/ticket`,
        headers: { origin, "content-type": "application/json", "x-mostra-csrf": opened.shellCsrf },
        body: "{}",
      });
      expect(code(answer), origin).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    }
    const none = await holder.ask({
      method: "POST",
      url: `${opened.link.shell}${api()}/ticket`,
      headers: { "content-type": "application/json", "x-mostra-csrf": opened.shellCsrf },
      body: "{}",
    });
    expect(code(none)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
  });

  it("refuses a token exchange from another origin: a stranger can't plant a session", async () => {
    const stranger = new Browser();
    const answer = await stranger.ask({
      method: "POST",
      url: `${opened.link.shell}${api()}/session`,
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ token: opened.link.secret }),
    });
    expect(code(answer)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    expect(answer.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a stream opened by another origin", async () => {
    const answer = await holder.ask({
      url: `${opened.frameOrigin}/_mostra/v/1/events`,
      headers: { origin: opened.link.shell },
    });
    expect(code(answer)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    const sameSite = await holder.ask({
      url: `${opened.frameOrigin}/_mostra/v/1/events`,
      headers: { "sec-fetch-site": "same-site" },
    });
    expect(code(sameSite)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
  });

  it("refuses a WebSocket upgrade from another origin or without a socket ticket, and serves none yet", async () => {
    const upgrade = (origin: string, query = "") =>
      raw(
        framePort,
        `GET /_mostra/v/1/term/x${query} HTTP/1.1\r\nHost: 127.0.0.1:${framePort}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      );
    expect((await upgrade("http://evil.example")).status).toBe(403);
    expect((await upgrade(opened.link.shell)).status).toBe(403);
    // A socket opens only with a single-use ticket of the frame's session (D158 item 5).
    expect((await upgrade(opened.frameOrigin)).status).toBe(401);
    const minted = await holder.fetchJson(opened.frameOrigin, "/_mostra/v/2026-10-15/ticket", {
      body: { purpose: "socket" },
      csrf: opened.frameCsrf,
    });
    expect(minted.status).toBe(200);
    const { ticket } = minted.json<{ ticket: string }>();
    // A stream's ticket opens no socket, and a socket's opens one only once.
    const stream = await holder.fetchJson(opened.frameOrigin, "/_mostra/v/2026-10-15/ticket", {
      body: { purpose: "stream" },
      csrf: opened.frameCsrf,
    });
    expect(
      (await upgrade(opened.frameOrigin, `?ticket=${stream.json<{ ticket: string }>().ticket}`))
        .status,
    ).toBe(401);
    expect((await upgrade(opened.frameOrigin, `?ticket=${ticket}`)).status).toBe(501);
    expect((await upgrade(opened.frameOrigin, `?ticket=${ticket}`)).status).toBe(401);
  });

  it("refuses a read that names another origin", async () => {
    const answer = await holder.ask({
      url: `${opened.frameOrigin}/`,
      headers: { origin: "http://evil.example" },
    });
    expect(code(answer)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
  });
});

describe("item 4: capability tokens of 130 bits, exchanged and kept out of URLs the server sees", () => {
  it("puts the secret in the fragment, 26 Crockford characters", () => {
    expect(new URL(receipt.url).hash).toMatch(/^#t=[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new URL(receipt.url).search).toBe("");
  });

  it("refuses the shell's API and every artifact file without a session", async () => {
    const stranger = new Browser();
    expect(code(await stranger.fetchJson(opened.link.shell, `${api()}/session`))).toBe(
      "401 MOSTRA_HYGIENE_SESSION_MISSING",
    );
    const page = await stranger.navigate(`${opened.frameOrigin}/`, opened.link.shell);
    // A refused navigation gets a plain page naming the code, never the artifact.
    expect(page.status).toBe(401);
    expect(page.header("content-type")).toContain("text/html");
    expect(page.body).toContain("MOSTRA_HYGIENE_SESSION_MISSING");
    expect(page.body).not.toContain("<script");
    for (const path of ["/", "/index.html", "/assets/", "/_mostra/session", "/anything"]) {
      const answer = await stranger.ask({
        url: `${opened.frameOrigin}${path}`,
        headers: { accept: "application/json" },
      });
      expect(answer.status, path).toBe(401);
      expect(answer.body).not.toContain("<title>single-tsx</title>");
    }
  });

  it("refuses a wrong or truncated token, and another artifact's token", async () => {
    const other = await gateway.publish("single-mdx", "page.mdx");
    secrets.push(parseLink(other.url).secret);
    const secret = opened.link.secret;
    // One character changed: the last, swapped for a different Crockford character.
    const altered = `${secret.slice(0, 25)}${secret.endsWith("0") ? "1" : "0"}`;
    for (const token of [
      secret.slice(0, 25),
      altered,
      secret.toLowerCase(),
      parseLink(other.url).secret,
      "",
      7,
    ]) {
      const answer = await new Browser().fetchJson(opened.link.shell, `${api()}/session`, {
        body: { token },
      });
      expect(code(answer), String(token)).toBe("401 MOSTRA_HYGIENE_TOKEN_INVALID");
    }
  });

  it("refuses a used, foreign or forged frame ticket", async () => {
    const used = await new Browser().navigate(opened.ticketSrc, opened.link.shell);
    expect(used.status).toBe(401);
    const forged = await new Browser().navigate(
      `${opened.frameOrigin}/_mostra/enter?ticket=${"A".repeat(26)}`,
      opened.link.shell,
    );
    expect(forged.status).toBe(401);
    // A ticket minted for this frame doesn't open another artifact's origin.
    const ticket = await holder.fetchJson(opened.link.shell, `${api()}/ticket`, {
      body: {},
      csrf: opened.shellCsrf,
    });
    const src = new URL(ticket.json<{ src: string }>().src);
    secrets.push(src.searchParams.get("ticket") ?? "");
    const shellRedeem = await new Browser().navigate(
      `${opened.link.shell}/_mostra/enter${src.search}`,
      opened.link.shell,
    );
    expect(shellRedeem.status).toBe(404);
  });
});

describe("item 5: CSRF token and JSON content type on mutations", () => {
  const ticket = (headers: Record<string, string>, body = "{}") =>
    holder.ask({
      method: "POST",
      url: `${opened.link.shell}${api()}/ticket`,
      headers: { origin: opened.link.shell, ...headers },
      body,
    });

  it("refuses a mutation without the session's CSRF token, or with another one", async () => {
    expect(code(await ticket({ "content-type": "application/json" }))).toBe(
      "403 MOSTRA_HYGIENE_CSRF_MISSING",
    );
    expect(
      code(await ticket({ "content-type": "application/json", "x-mostra-csrf": opened.frameCsrf })),
    ).toBe("403 MOSTRA_HYGIENE_CSRF_MISSING");
    expect(code(await ticket({ "content-type": "application/json", "x-mostra-csrf": "" }))).toBe(
      "403 MOSTRA_HYGIENE_CSRF_MISSING",
    );
  });

  it("refuses bodies a form or a plain fetch could send without a preflight", async () => {
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      expect(
        code(await ticket({ "content-type": type, "x-mostra-csrf": opened.shellCsrf })),
        type,
      ).toBe("415 MOSTRA_HYGIENE_CONTENT_TYPE");
    }
  });

  it("refuses a body that isn't one JSON object, and an oversized one", async () => {
    const headers = { "content-type": "application/json", "x-mostra-csrf": opened.shellCsrf };
    expect(code(await ticket(headers, "[1]"))).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    expect(code(await ticket(headers, "{"))).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    expect((await ticket(headers, JSON.stringify({ pad: "x".repeat(70_000) }))).status).toBe(413);
  });
});

describe("item 6: no permissive CORS", () => {
  it("answers a preflight with a refusal and no Access-Control-* header", async () => {
    for (const url of [
      `${opened.link.shell}${api()}/ticket`,
      `${opened.frameOrigin}/_mostra/v/1/fields`,
    ]) {
      const answer = await send({
        method: "OPTIONS",
        url,
        headers: {
          origin: "http://evil.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type, x-mostra-csrf",
        },
      });
      expect(answer.status).toBe(403);
      expect(
        Object.keys(answer.headers).filter((name) => name.startsWith("access-control-")),
      ).toEqual([]);
    }
  });
});

describe("item 7 and 8: CORP, Referrer-Policy and framing on every response", () => {
  it("sends Cross-Origin-Resource-Policy, Referrer-Policy and nosniff on everything, and never Access-Control-*", async () => {
    // Its own sweep over every kind of answer, so the check doesn't depend on the tests before it.
    const stranger = new Browser();
    await holder.navigate(`${opened.frameOrigin}/`, opened.link.shell);
    await holder.navigate(`${opened.link.shell}/a/${receipt.artifactId}`);
    await holder.fetchJson(opened.link.shell, `${api()}/session`);
    await holder.ask({ url: `${opened.frameOrigin}/missing.js` });
    await holder.ask({ url: `${opened.frameOrigin}/_mostra/v/1/fields`, method: "POST" });
    await stranger.ask({ url: `${opened.frameOrigin}/` });
    await stranger.fetchJson(opened.link.shell, `${api()}/session`, { body: { token: "0" } });
    await stranger.ask({ url: `${opened.link.shell}/`, headers: { host: "evil.example" } });
    await stranger.ask({ url: `${opened.frameOrigin}/`, method: "OPTIONS" });
    expect(seen.length).toBeGreaterThan(9);
    expect(new Set(seen.map((answer) => answer.status)).size).toBeGreaterThan(4);
    for (const answer of seen) {
      if (answer.status === 0) continue;
      expect(answer.header("cross-origin-resource-policy"), String(answer.status)).toBe(
        "same-origin",
      );
      expect(answer.header("referrer-policy")).toBe("no-referrer");
      expect(answer.header("x-content-type-options")).toBe("nosniff");
      expect(Object.keys(answer.headers).some((name) => name.startsWith("access-control-"))).toBe(
        false,
      );
    }
  });

  it("lets nothing frame the shell, and only the shell frame an artifact (D98 item 4)", async () => {
    const shell = await holder.navigate(`${opened.link.shell}/a/${receipt.artifactId}`);
    expect(shell.header("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(shell.header("x-frame-options")).toBe("DENY");
    expect(opened.page.header("content-security-policy")).toBe(
      `frame-ancestors ${opened.link.shell}`,
    );
  });

  it("sets session cookies HttpOnly and SameSite=Strict, per port, never Secure over HTTP (D98 item 1)", () => {
    const cookies = [...holder.jar.values()];
    expect(cookies.map((cookie) => cookie.name).sort()).toEqual(
      [`mostra-${framePort}`, `mostra-${shellPort}`].sort(),
    );
    for (const cookie of cookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Strict");
      expect(cookie.secure).toBe(false);
      expect(cookie.maxAge).toBe(400 * 86_400);
    }
    expect(cookies.find((cookie) => cookie.name === `mostra-${shellPort}`)?.path).toBe(
      `/a/${receipt.artifactId}`,
    );
  });
});

describe("one link per browser and artifact, never replaced silently (D98 item 8, Claude review finding 6)", () => {
  it("asks before another link replaces a live session, and keeps or replaces it as told", async () => {
    const narrow = await gateway.link(receipt.artifactId, { scopes: ["view"] });
    secrets.push(parseLink(narrow.url).secret);
    const browser = new Browser();
    const full = await openLink(browser, receipt.url);
    const exchange = (token: string, replace?: boolean) =>
      browser.fetchJson(full.link.shell, `${api()}/session`, {
        body: replace === undefined ? { token } : { token, replace },
      });
    // The same link again reuses the session: no new cookie, the same CSRF token.
    const again = await exchange(full.link.secret);
    expect(again.status).toBe(200);
    expect(again.header("set-cookie")).toBeUndefined();
    expect(again.json<{ csrf: string }>().csrf).toBe(full.shellCsrf);
    // Another link is refused with what each allows, and the session is unchanged.
    const conflict = await exchange(parseLink(narrow.url).secret);
    expect(code(conflict)).toBe("409 MOSTRA_HYGIENE_SESSION_CONFLICT");
    expect(conflict.header("set-cookie")).toBeUndefined();
    expect(conflict.json()).toMatchObject({
      current: { scopes: ["action:*", "draft", "review", "signal", "submit", "view"] },
      offered: { scopes: ["view"] },
    });
    const still = await browser.fetchJson(full.link.shell, `${api()}/session`);
    expect(still.json<{ scopes: string[] }>().scopes).toContain("submit");
    // Told to, it replaces the session.
    const replaced = await exchange(parseLink(narrow.url).secret, true);
    expect(replaced.status).toBe(200);
    expect(replaced.header("set-cookie")).toBeDefined();
    const now = await browser.fetchJson(full.link.shell, `${api()}/session`);
    expect(now.json<{ scopes: string[] }>().scopes).toEqual(["view"]);
  });

  it("replaces a session whose link died without asking", async () => {
    const first = await gateway.link(receipt.artifactId);
    const second = await gateway.link(receipt.artifactId);
    secrets.push(parseLink(first.url).secret, parseLink(second.url).secret);
    const browser = new Browser();
    await openLink(browser, first.url);
    await gateway.client.call("view/revoke", { tokenId: first.tokenId });
    expect((await openLink(browser, second.url)).page.status).toBe(200);
  });
});

describe("item 9: per-scope tokens (HY-03)", () => {
  it("lets a view-and-review link view, and refuses drafts, submits and actions", async () => {
    const link = await gateway.link(receipt.artifactId, { scopes: ["review"] });
    secrets.push(parseLink(link.url).secret);
    expect(link.scopes).toEqual(["review", "view"]);
    const browser = new Browser();
    const viewer = await openLink(browser, link.url);
    expect(viewer.page.status).toBe(200);
    const post = (path: string, body: unknown = {}) =>
      browser.fetchJson(viewer.frameOrigin, path, { body, csrf: viewer.frameCsrf });
    // Well-formed requests to WP-06's real handlers: the scope refuses them first (D96).
    const rev = "/_mostra/v/2026-10-15";
    expect(
      code(
        await post(`${rev}/fields`, {
          mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XG",
          scope: "viewer",
          baseRevision: "0",
          viewId: viewer.viewId,
          ops: [{ id: "a", value: 1 }],
        }),
      ),
    ).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(
      code(
        await post(`${rev}/submit`, {
          viewId: viewer.viewId,
          expectedRevision: "0",
          channel: "artifact",
        }),
      ),
    ).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(code(await post(`${rev}/signal`, { viewId: viewer.viewId, name: "ping" }))).toBe(
      "403 MOSTRA_HYGIENE_SCOPE_DENIED",
    );
    expect(code(await post("/_mostra/v/1/fields"))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(code(await post("/_mostra/v/1/submit"))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(code(await post("/_mostra/v/1/call/actions.ts%23sendReply"))).toBe(
      "403 MOSTRA_HYGIENE_SCOPE_DENIED",
    );
    expect(code(await post("/_mostra/v/1/runs"))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    // A signal can wake an agent: it needs its own scope (D97 item 4, Claude review question).
    expect(code(await post("/_mostra/v/1/signal"))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    // Review lives on the shell origin, and this link carries it.
    const review = await browser.fetchJson(viewer.link.shell, `${api()}/v/1/review/comments`, {
      body: {},
      csrf: viewer.shellCsrf,
    });
    expect(review.status).toBe(501);
  });

  it("puts the shell's trusted controls behind their scopes and the shell's own origin (WP-07, D108)", async () => {
    const link = await gateway.link(receipt.artifactId, { scopes: ["review"] });
    secrets.push(parseLink(link.url).secret);
    const browser = new Browser();
    const viewer = await openLink(browser, link.url);
    const shell = (path: string, body: unknown) =>
      browser.fetchJson(viewer.link.shell, `${api()}/v/2026-10-15/${path}`, {
        body,
        csrf: viewer.shellCsrf,
      });
    // The trusted Submit needs the submit scope; Choose needs review, which this link has.
    expect(code(await shell("submit", { viewId: viewer.viewId, expectedRevision: "0" }))).toBe(
      "403 MOSTRA_HYGIENE_SCOPE_DENIED",
    );
    expect(code(await shell("review/choose", {}))).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    expect(code(await shell("follow", {}))).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    // The ticket offers this link no trusted Submit (D97): its scopes can't use one.
    const ticket = await browser.fetchJson(viewer.link.shell, `${api()}/ticket`, {
      body: {},
      csrf: viewer.shellCsrf,
    });
    expect(ticket.json<{ controls: string[] }>().controls).not.toContain("submit");
    expect(ticket.json<{ controls: string[] }>().controls).toContain("choose");
  });

  it("refuses the shell's trusted routes to the artifact's origin and without the shell's CSRF token (SH-02)", async () => {
    const path = `${opened.link.shell}${api()}/v/2026-10-15/submit`;
    const body = JSON.stringify({ viewId: opened.viewId, expectedRevision: "0" });
    // From the artifact's own page: another origin.
    const fromFrame = await holder.ask({
      method: "POST",
      url: path,
      headers: {
        origin: opened.frameOrigin,
        "content-type": "application/json",
        "sec-fetch-site": "same-site",
        "x-mostra-csrf": opened.frameCsrf,
      },
      body,
    });
    expect(code(fromFrame)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    // The shell's origin with the frame's CSRF token, which is all artifact code can read.
    const frameToken = await holder.fetchJson(opened.link.shell, `${api()}/v/2026-10-15/submit`, {
      body: { viewId: opened.viewId, expectedRevision: "0" },
      csrf: opened.frameCsrf,
    });
    expect(code(frameToken)).toBe("403 MOSTRA_HYGIENE_CSRF_MISSING");
  });

  it("lets a link that names a version learn nothing of another version's carry-over (D97 item 9)", async () => {
    const link = await gateway.link(receipt.artifactId, { version: 1 });
    secrets.push(parseLink(link.url).secret);
    const browser = new Browser();
    const viewer = await openLink(browser, link.url);
    const carry = (version: number) =>
      browser.fetchJson(viewer.link.shell, `${api()}/v/2026-10-15/carry?version=${version}`);
    expect((await carry(1)).status).toBe(200);
    expect(code(await carry(2))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
  });

  it("grants one action by its export name or its function ID, and no other", async () => {
    const link = await gateway.link(receipt.artifactId, { scopes: ["action:sendReply"] });
    secrets.push(parseLink(link.url).secret);
    const browser = new Browser();
    const viewer = await openLink(browser, link.url);
    const call = (fn: string) =>
      browser.fetchJson(viewer.frameOrigin, `/_mostra/v/2026-10-15/call/${fn}`, {
        body: {},
        csrf: viewer.frameCsrf,
      });
    // Through every check to WP-08's handler, which reads the (empty) body.
    expect(code(await call("actions.ts%23sendReply"))).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    expect(code(await call("lib/mail.ts%23sendReply"))).toBe(
      "400 MOSTRA_HYGIENE_REQUEST_MALFORMED",
    );
    expect(code(await call("actions.ts%23archive"))).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(
      code(
        await browser.fetchJson(viewer.frameOrigin, "/_mostra/v/1/submit", {
          body: {},
          csrf: viewer.frameCsrf,
        }),
      ),
    ).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
  });

  it("lets the full link through every declared route's checks to its handler (WP-06's fields, submit and signal; WP-08's calls, runs and live sources)", async () => {
    // Behind the checks, the handlers read the body: an empty one is malformed (D96).
    for (const path of [
      "/_mostra/v/2026-10-15/fields",
      "/_mostra/v/2026-10-15/submit",
      "/_mostra/v/2026-10-15/signal",
      "/_mostra/v/2026-10-15/runs",
      "/_mostra/v/2026-10-15/runs/attach",
      "/_mostra/v/2026-10-15/runs/run_01J00000000000000000000000/cancel",
      "/_mostra/v/2026-10-15/call/a.ts%23b",
      "/_mostra/v/2026-10-15/live",
    ]) {
      const answer = await holder.fetchJson(opened.frameOrigin, path, {
        body: {},
        csrf: opened.frameCsrf,
      });
      expect(code(answer), path).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    }
    // A browser-protocol revision this gateway never shipped isn't served (FAILURE_MODEL §7).
    const unknown = await holder.fetchJson(opened.frameOrigin, "/_mostra/v/1/fields", {
      body: {},
      csrf: opened.frameCsrf,
    });
    expect(code(unknown)).toBe("404 MOSTRA_HYGIENE_NOT_SERVED");
  });
});

describe("item 10: expiry, rotation, revocation (410) and rate limits", () => {
  it("answers 410 for a revoked link and every session made from it", async () => {
    const link = await gateway.link(receipt.artifactId);
    secrets.push(parseLink(link.url).secret);
    const browser = new Browser();
    const viewer = await openLink(browser, link.url);
    expect(viewer.page.status).toBe(200);
    expect(await gateway.client.call("view/revoke", { tokenId: link.tokenId })).toMatchObject({
      result: {},
    });
    expect(code(await browser.fetchJson(viewer.link.shell, `${api()}/session`))).toBe(
      "410 MOSTRA_HYGIENE_TOKEN_REVOKED",
    );
    expect((await browser.navigate(`${viewer.frameOrigin}/`, viewer.link.shell)).status).toBe(410);
    expect(
      code(
        await new Browser().fetchJson(viewer.link.shell, `${api()}/session`, {
          body: { token: viewer.link.secret },
        }),
      ),
    ).toBe("410 MOSTRA_HYGIENE_TOKEN_REVOKED");
    // The holder's own session, from another link, is untouched.
    expect((await holder.navigate(`${opened.frameOrigin}/`, opened.link.shell)).status).toBe(200);
  });

  it("rotates a link: the old one answers 410, the new one works with the same scopes", async () => {
    const link = await gateway.link(receipt.artifactId, { scopes: ["review"] });
    const rotated = (await gateway.client.call("view/rotate", { tokenId: link.tokenId }))
      .result as { url: string; tokenId: string; scopes: string[] };
    secrets.push(parseLink(link.url).secret, parseLink(rotated.url).secret);
    expect(rotated.scopes).toEqual(link.scopes);
    expect(rotated.url).not.toBe(link.url);
    expect(
      code(
        await new Browser().fetchJson(opened.link.shell, `${api()}/session`, {
          body: { token: parseLink(link.url).secret },
        }),
      ),
    ).toBe("410 MOSTRA_HYGIENE_TOKEN_REVOKED");
    expect((await openLink(new Browser(), rotated.url)).page.status).toBe(200);
    const again = await gateway.client.call("view/rotate", { tokenId: link.tokenId });
    expect(again.error?.data.code).toBe("MOSTRA_HYGIENE_TOKEN_REVOKED");
  });

  it("refuses cross-site frame entries before looking at their ticket, and a real link still opens", async () => {
    const stranger = new Browser();
    for (let attempt = 0; attempt < 40; attempt++) {
      const answer = await stranger.ask({
        url: `${opened.frameOrigin}/_mostra/enter?ticket=${String(attempt).padStart(26, "0")}`,
        headers: { accept: "application/json", "sec-fetch-site": "cross-site" },
      });
      // A frame entry is a navigation: its refusal is a plain page naming the code.
      expect(answer.status).toBe(403);
      expect(answer.body).toContain("MOSTRA_HYGIENE_ORIGIN_REFUSED");
    }
    // The limit wasn't touched: a real link still opens.
    const link = await gateway.link(receipt.artifactId);
    secrets.push(parseLink(link.url).secret);
    expect((await openLink(new Browser(), link.url)).page.status).toBe(200);
  });

  it("rate-limits guessing: past 30 failures a minute, every attempt gets 429, a right token too", async () => {
    const link = await gateway.link(receipt.artifactId);
    secrets.push(parseLink(link.url).secret);
    let limited: Answer | undefined;
    for (let attempt = 0; attempt < 40 && !limited; attempt++) {
      const answer = await new Browser().fetchJson(opened.link.shell, `${api()}/session`, {
        body: { token: `GUESS${String(attempt).padStart(21, "0")}` },
      });
      if (answer.status === 429) limited = answer;
    }
    expect(limited && code(limited)).toBe("429 MOSTRA_HYGIENE_RATE_LIMITED");
    expect(Number(limited?.header("retry-after"))).toBeGreaterThan(0);
    const right = await new Browser().fetchJson(opened.link.shell, `${api()}/session`, {
      body: { token: parseLink(link.url).secret },
    });
    expect(code(right)).toBe("429 MOSTRA_HYGIENE_RATE_LIMITED");
    // Frame tickets don't count and aren't limited (D97 item 8 as amended after the Claude
    // review): they are single-use 130-bit secrets, and any page on the host could spend a count.
    const ticket = await new Browser().navigate(
      `${opened.frameOrigin}/_mostra/enter?ticket=${"B".repeat(26)}`,
      opened.link.shell,
    );
    expect(ticket.status).toBe(401);
    // A holder's session isn't a token path: it keeps working.
    expect((await holder.navigate(`${opened.frameOrigin}/`, opened.link.shell)).status).toBe(200);
    // Claude review finding 1: the limit is this artifact's; another artifact's links open.
    const other = await gateway.publish("single-mdx", "page.mdx");
    secrets.push(parseLink(other.url).secret);
    expect((await openLink(new Browser(), other.url)).page.status).toBe(200);
  });

  it("checks the limit at the token check, so concurrent guesses can't slip past it (Claude review finding 7)", async () => {
    const target = await gateway.publish("directory");
    const link = parseLink(target.url);
    secrets.push(link.secret);
    const port = Number(new URL(link.shell).port);
    const path = `/a/${target.artifactId}/_mostra/session`;
    const bodies = Array.from({ length: 60 }, (_, index) =>
      JSON.stringify({ token: `GUESS${String(index).padStart(21, "0")}` }),
    );
    bodies.push(JSON.stringify({ token: link.secret }));
    const statuses = await burst(port, link.shell, path, bodies);
    // Every guess past the 30th, and the right token sent with them, is refused.
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(30);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("item 11 and 12: no capability material in logs or the ledger", () => {
  it("keeps every secret, CSRF token, ticket and cookie out of the logs and the ledger", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(join(gateway.home.home, "logs"));
    walk(join(gateway.home.home, "store"));
    expect(files.some((file) => file.endsWith("ledger.sqlite"))).toBe(true);
    const material = secrets.filter((secret) => secret.length >= 20);
    expect(material.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file).toString("latin1");
      for (const secret of material)
        expect(text.includes(secret), `${file} holds a secret`).toBe(false);
    }
  });
});

describe("item 13: side-effect-free GETs", () => {
  it("refuses GET and HEAD on every mutation path, and changes nothing", async () => {
    const before = await gateway.client.call("instance/status", {});
    for (const [origin, path] of [
      [opened.link.shell, `${api()}/session`],
      [opened.link.shell, `${api()}/ticket`],
      [opened.frameOrigin, "/_mostra/v/1/fields"],
      [opened.frameOrigin, "/_mostra/v/1/submit"],
      [opened.frameOrigin, "/_mostra/v/1/runs"],
    ] as const) {
      const answer = await holder.ask({
        url: `${origin}${path}`,
        headers: { accept: "application/json" },
      });
      if (path === `${api()}/session`) {
        // Reading the session is a GET with no effect: it answers the holder, and only that.
        expect(answer.status).toBe(200);
        expect(answer.headers["set-cookie"]).toBeUndefined();
      } else {
        expect([404, 405], path).toContain(answer.status);
      }
    }
    expect((await gateway.client.call("instance/status", {})).result).toMatchObject({
      processes: (before.result as { processes: unknown[] }).processes,
    });
  });
});

describe("robust header parsing (fuzzing)", () => {
  const head = `Host: 127.0.0.1:${0}`;
  it("refuses malformed, repeated and oversized headers, and odd request targets", async () => {
    const at = (port: number) => head.replace(":0", `:${port}`);
    const cases: [string, number[]][] = [
      [`GET / HTTP/1.1\r\n${at(framePort)}\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET / HTTP/1.1\r\n${at(framePort)}\r\nHost: evil.example\r\n\r\n`, [400]],
      [`GET http://evil.example/ HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET * HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET /%2e%2e/%2e%2e/store/ledger.sqlite HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET /../../store/ledger.sqlite HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET /assets%2f..%2f..%2fserver HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET /%00 HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [400]],
      [`GET / HTTP/1.1\r\n${at(framePort)}\r\nX-Big: ${"a".repeat(1_100_000)}\r\n\r\n`, [431]],
      [
        `GET / HTTP/1.1\r\n${at(framePort)}\r\nCookie: ${"a=".padEnd(1_100_000, "b")}\r\n\r\n`,
        [431],
      ],
      [`GET / HTTP/1.1\r\n${at(framePort)}\r\nBad Header: x\r\n\r\n`, [400]],
      [`GET / HTTP/1.1\r\n${at(framePort)}\r\nCookie: a=1\r\nCookie: b=2\r\n\r\n`, [400]],
      [
        `POST /_mostra/v/1/fields HTTP/1.1\r\n${at(framePort)}\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
        [400],
      ],
      [`TRACE / HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [405]],
      [`DELETE / HTTP/1.1\r\n${at(framePort)}\r\n\r\n`, [405]],
      ["\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03", [400, 0]],
    ];
    for (const [request, statuses] of cases) {
      const answer = await raw(framePort, request);
      expect(statuses, JSON.stringify(request.slice(0, 60))).toContain(answer.status);
      expect(answer.text).not.toContain("<title>single-tsx</title>");
    }
  });
});

/** Sends the headers of every exchange first, then every body at once, on separate connections. */
async function burst(
  port: number,
  origin: string,
  path: string,
  bodies: readonly string[],
): Promise<number[]> {
  const pending = await Promise.all(
    bodies.map(
      (body) =>
        new Promise<{ socket: Socket; body: string; status: Promise<number> }>((resolve) => {
          const socket = connect({ host: "127.0.0.1", port }, () => {
            socket.write(
              `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`,
            );
            let received = "";
            const status = new Promise<number>((done) => {
              socket.on("data", (chunk) => {
                received += chunk.toString();
              });
              socket.on("close", () => done(Number(/^HTTP\/1\.1 (\d+)/.exec(received)?.[1] ?? 0)));
              socket.on("error", () => done(0));
            });
            resolve({ socket, body, status });
          });
        }),
    ),
  );
  // Every request has passed routing and waits for its body.
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const entry of pending) entry.socket.write(entry.body);
  return Promise.all(pending.map((entry) => entry.status));
}

describe("a full cookie jar (D98 item 9, Claude review finding 3)", () => {
  it("serves a holder whose host cookies are as large as a browser keeps them", async () => {
    // 180 cookies of 4 KiB, more than the 100 any engine keeps for one host (VERIFIED_FACTS, WP-05).
    const junk = Array.from({ length: 180 }, (_, index) => `junk${index}=${"x".repeat(4090)}`).join(
      "; ",
    );
    const cookie = `${holder.cookiesFor(`${opened.frameOrigin}/`)}; ${junk}`;
    expect(cookie.length).toBeGreaterThan(700_000);
    const page = await holder.ask({
      url: `${opened.frameOrigin}/`,
      headers: { cookie, accept: "text/html", "sec-fetch-dest": "iframe" },
      noCookies: true,
    });
    expect(page.status).toBe(200);
    const session = await holder.ask({
      url: `${opened.link.shell}${api()}/session`,
      headers: { cookie: `${holder.cookiesFor(`${opened.link.shell}${api()}/session`)}; ${junk}` },
      noCookies: true,
    });
    expect(session.status).toBe(200);
  });

  it("answers more than that with a page that clears the host's cookies", async () => {
    // Four times the limit: the gateway refuses after the first megabyte, while the rest is still
    // on its way, and the client reads only once it has sent everything. The answer must reach it
    // all the same: a gateway that closed without reading the rest reset the connection, and on
    // Windows the reset discarded the answer (WP-W2).
    const junk = Array.from(
      { length: 1000 },
      (_, index) => `junk${index}=${"x".repeat(4090)}`,
    ).join("; ");
    const answer = await raw(
      framePort,
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${framePort}\r\nCookie: ${junk}\r\n\r\n`,
      "127.0.0.1",
      { readAfterMs: 500 },
    );
    expect(answer.status).toBe(431);
    const text = answer.text.toLowerCase();
    expect(text).toContain('clear-site-data: "cookies"');
    expect(answer.text).toContain("MOSTRA_HYGIENE_HEADERS_TOO_LARGE");
    expect(text).toContain("frame-ancestors 'none'");
    expect(text).not.toContain("<script");
  });
});
