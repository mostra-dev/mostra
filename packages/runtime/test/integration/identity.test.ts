/**
 * The identity port through a real `mostra-runtime daemon` (D143 item 2, HO-01): a host names
 * the person behind a link minted without a viewer from the request's headers; `null` keeps the
 * home's local user; a link minted with a viewer asks nothing; and a host that took identity over
 * but fails, answers too late, answers nonsense or is away refuses the link instead of guessing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, Browser, openLink, parseLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { connectTo, initializeParams, type LineClient, type Message } from "../support.ts";

/** A host connection that registers ports and answers their calls by hand. */
async function host(
  gateway: GatewayHome,
  name: string,
  ports: string[],
  expect: string[] = [],
): Promise<LineClient> {
  const client = await connectTo(gateway.daemon.status.socket as string);
  ok(
    await client.call(
      "mostra/initialize",
      initializeParams({
        client: { name, version: "1" },
        ports,
        home: { ports: expect },
      }),
    ),
  );
  return client;
}

const answer = (client: LineClient, message: Message, result: unknown): void =>
  client.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));

/** The shell's exchange of a link, with extra request headers. */
function exchange(
  browser: Browser,
  url: string,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const link = parseLink(url);
  return browser.ask({
    method: "POST",
    url: `${link.shell}/a/${link.artifactId}/_mostra/session`,
    headers: {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      origin: link.shell,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ token: link.secret }),
  });
}

/** The shell's exchange of a link with extra body fields (the browser's key, `replace`). */
function exchangeBody(
  browser: Browser,
  url: string,
  extra: Record<string, unknown>,
): Promise<Answer> {
  const link = parseLink(url);
  return browser.ask({
    method: "POST",
    url: `${link.shell}/a/${link.artifactId}/_mostra/session`,
    headers: {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      origin: link.shell,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: link.secret, ...extra }),
  });
}

/** The viewer a frame session acts as. */
async function frameViewer(browser: Browser, url: string): Promise<Record<string, unknown>> {
  const opened = await openLink(browser, url);
  const session = await browser.fetchJson(opened.frameOrigin, "/_mostra/session");
  return session.json<{ viewer: Record<string, unknown> }>().viewer;
}

describe("the identity port (D143 item 2)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await gateway.publish("single-tsx", "page.tsx");
  }, 180_000);
  afterAll(() => gateway.stop());

  it("names the person behind a link without a viewer, from headers without cookies or Mostra's own", async () => {
    const identity = await host(gateway, "identity-host", ["identity"]);
    const link = await gateway.link(receipt.artifactId);
    const browser = new Browser();
    const pending = exchange(browser, link.url, {
      "x-forwarded-user": "ada@example.com",
      cookie: "elsewhere=1",
      "x-mostra-csrf": "not-for-the-host",
    });
    const call = await identity.next((message) => message.method === "port/identity.resolve");
    const params = (call as unknown as { params: unknown }).params as {
      artifactId: string;
      via: string;
      headers: Record<string, string>;
    };
    expect(params.artifactId).toBe(receipt.artifactId);
    expect(params.via).toBe("local");
    expect(params.headers["x-forwarded-user"]).toBe("ada@example.com");
    expect(Object.keys(params.headers).some((name) => name !== name.toLowerCase())).toBe(false);
    expect(params.headers["cookie"]).toBeUndefined();
    expect(Object.keys(params.headers).filter((name) => name.startsWith("x-mostra-"))).toEqual([]);
    answer(identity, call, { ref: "ada@example.com", name: "Ada" });
    expect((await pending).status).toBe(200);

    // The shell session's frames act as that person: one viewer of kind host per ref.
    const ticket = await openLinkAfterExchange(browser, link.url);
    expect(ticket).toMatchObject({ kind: "host", ref: "ada@example.com", name: "Ada" });
    const again = new Browser();
    const second = exchange(again, link.url, { "x-forwarded-user": "ada@example.com" });
    answer(identity, await identity.next((m) => m.method === "port/identity.resolve"), {
      ref: "ada@example.com",
    });
    expect((await second).status).toBe(200);
    expect((await openLinkAfterExchange(again, link.url))["id"]).toBe(ticket["id"]);
    identity.close();
  });

  it("keeps the home's local user when the host answers null, and never asks for a link with a viewer", async () => {
    const identity = await host(gateway, "identity-null", ["identity"]);
    const link = await gateway.link(receipt.artifactId);
    const browser = new Browser();
    const pending = exchange(browser, link.url);
    answer(identity, await identity.next((m) => m.method === "port/identity.resolve"), null);
    expect((await pending).status).toBe(200);
    expect((await openLinkAfterExchange(browser, link.url))["kind"]).toBe("local");

    const named = await gateway.link(receipt.artifactId, { viewer: { ref: "bo", name: "Bo" } });
    const asked = identity
      .next((m) => m.method === "port/identity.resolve", 1500)
      .then(
        () => true,
        () => false,
      );
    expect((await frameViewer(new Browser(), named.url))["ref"]).toBe("bo");
    expect(await asked).toBe(false);
    identity.close();
  });

  it("refuses the link when the host's answer is refused, late, or the host is away (fails closed)", async () => {
    const identity = await host(gateway, "identity-broken", ["identity"], ["identity"]);
    const link = await gateway.link(receipt.artifactId);

    const nonsense = exchange(new Browser(), link.url);
    answer(identity, await identity.next((m) => m.method === "port/identity.resolve"), {
      name: "no ref",
    });
    const refusedAnswer = await nonsense;
    expect(refusedAnswer.status).toBe(503);
    expect(refusedAnswer.json()["code"]).toBe("MOSTRA_HOST_IDENTITY_UNAVAILABLE");

    // No answer within 5 s.
    const late = await exchange(new Browser(), link.url);
    expect(late.status).toBe(503);
    expect(late.json()["code"]).toBe("MOSTRA_HOST_IDENTITY_UNAVAILABLE");

    // Away, but expected: nobody becomes the local user in its absence.
    identity.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const away = await exchange(new Browser(), link.url);
    expect(away.status).toBe(503);
    expect(away.json()["code"]).toBe("MOSTRA_HOST_IDENTITY_UNAVAILABLE");

    // The host clears what it always provides: the home's default holds again.
    const cleared = await host(gateway, "identity-broken", [], []);
    cleared.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await frameViewer(new Browser(), link.url))["kind"]).toBe("local");
  }, 30_000);

  it("spends a launch ticket once, even when two exchanges present it while the port answers (GPT review finding 1)", async () => {
    const identity = await host(gateway, "identity-slow", ["identity"]);
    const link = await gateway.link(receipt.artifactId);
    const launched = ok(await gateway.client.call("view/launch", { tokenId: link.tokenId })) as {
      url: string;
    };
    const ticket = new URL(launched.url).hash.replace(/^#l=/, "");
    const parsed = parseLink(link.url);
    const present = (browser: Browser) =>
      browser.ask({
        method: "POST",
        url: `${parsed.shell}/a/${parsed.artifactId}/_mostra/session`,
        headers: {
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          origin: parsed.shell,
          "content-type": "application/json",
        },
        body: JSON.stringify({ launch: ticket }),
      });
    // Both exchanges present the ticket before the host answers either of them.
    const first = present(new Browser());
    const firstCall = await identity.next((m) => m.method === "port/identity.resolve");
    const second = present(new Browser());
    const secondCall = await identity.next(
      (m) => m.method === "port/identity.resolve" && m.id !== firstCall.id,
    );
    answer(identity, firstCall, null);
    answer(identity, secondCall, null);
    const statuses = [(await first).status, (await second).status].sort();
    expect(statuses).toEqual([200, 401]);
    identity.close();
  });

  it("gives no session to a link revoked while the port answered (Opus review finding 3)", async () => {
    const identity = await host(gateway, "identity-revoked", ["identity"]);
    const link = await gateway.link(receipt.artifactId);
    const pending = exchange(new Browser(), link.url);
    const call = await identity.next((m) => m.method === "port/identity.resolve");
    ok(await gateway.client.call("view/revoke", { tokenId: link.tokenId }));
    answer(identity, call, null);
    const refused = await pending;
    expect([refused.status, refused.json()["code"]]).toEqual([410, "MOSTRA_HYGIENE_TOKEN_REVOKED"]);
    expect(refused.header("set-cookie")).toBeUndefined();
    identity.close();
  });

  it("never lets one browser's exchange silently replace another link's made meanwhile (Opus review finding 2)", async () => {
    const identity = await host(gateway, "identity-race", ["identity"]);
    const wide = await gateway.link(receipt.artifactId);
    const narrow = await gateway.link(receipt.artifactId, { scopes: ["view"] });
    const key = "browser-key-0123456789abcdef";
    // One browser (one key) opens two links; both exchanges wait for the identity port.
    const first = exchangeBody(new Browser(), wide.url, { browser: key });
    const firstCall = await identity.next((m) => m.method === "port/identity.resolve");
    const second = exchangeBody(new Browser(), narrow.url, { browser: key });
    const secondCall = await identity.next(
      (m) => m.method === "port/identity.resolve" && m.id !== firstCall.id,
    );
    answer(identity, firstCall, null);
    expect((await first).status).toBe(200);
    answer(identity, secondCall, null);
    const conflict = await second;
    expect([conflict.status, conflict.json()["code"]]).toEqual([
      409,
      "MOSTRA_HYGIENE_SESSION_CONFLICT",
    ]);
    expect(conflict.header("set-cookie")).toBeUndefined();
    // The viewer may still choose the new link.
    const replacing = exchangeBody(new Browser(), narrow.url, { browser: key, replace: true });
    answer(identity, await identity.next((m) => m.method === "port/identity.resolve"), null);
    expect((await replacing).status).toBe(200);
    // Another browser (another key), or the same link again, is no conflict.
    const elsewhere = exchangeBody(new Browser(), wide.url, { browser: "another-browser-key-xyz" });
    answer(identity, await identity.next((m) => m.method === "port/identity.resolve"), null);
    expect((await elsewhere).status).toBe(200);
    identity.close();
  });

  it("doesn't wait for a host that is connected but stopped serving identity (Opus review finding 7)", async () => {
    // The host once served identity and is expected to; now it connects without the port.
    const once = await host(gateway, "identity-dropped", ["identity"], ["identity"]);
    once.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const link = await gateway.link(receipt.artifactId);
    expect((await exchange(new Browser(), link.url)).status).toBe(503);
    const without = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await without.call(
        "mostra/initialize",
        initializeParams({ client: { name: "identity-dropped", version: "2" }, ports: [] }),
      ),
    );
    expect((await frameViewer(new Browser(), link.url))["kind"]).toBe("local");
    without.close();
  });
});

/** After an exchange, the rest of the shell's steps: ticket, entry, the frame's own session. */
async function openLinkAfterExchange(
  browser: Browser,
  url: string,
): Promise<Record<string, unknown>> {
  const link = parseLink(url);
  const api = `/a/${link.artifactId}/_mostra`;
  const session = await browser.fetchJson(link.shell, `${api}/session`);
  const csrf = session.json<{ csrf: string }>().csrf;
  const ticket = await browser.fetchJson(link.shell, `${api}/ticket`, { body: {}, csrf });
  if (ticket.status !== 200) throw new Error(`ticket: ${ticket.status} ${ticket.body}`);
  const { src, artifactOrigin } = ticket.json<{ src: string; artifactOrigin: string }>();
  const enter = await browser.navigate(src, link.shell);
  if (enter.status !== 303) throw new Error(`enter: ${enter.status} ${enter.body}`);
  const frame = await browser.fetchJson(artifactOrigin, "/_mostra/session");
  return frame.json<{ viewer: Record<string, unknown> }>().viewer;
}
