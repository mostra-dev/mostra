/**
 * Many homes behind one server, and nothing crossing between them (RM-03; ARCHITECTURE §15.2,
 * §15.6; INTERFACES §18.4, §18.6; FAILURE_MODEL §11.3): two accounts host one copied project, the
 * same artifact ID and, built by one runtime, the same version ID, each on its own hosted route. One
 * home's links, sessions and frame tickets open nothing of the other's; the operator's quarantine,
 * pause and removal of one route leave the other untouched, an identical version included; a removed
 * route's label is never served again, even after its artifact ID is hosted anew; and a host an
 * operator gave one home never goes to another.
 */
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { control } from "../operator-support.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  send,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));

describe("two accounts, one copied project (RM-03)", () => {
  let port: number;
  let server: RunningServer;
  let operator: ReturnType<typeof control>;
  const ada = new GatewayHome();
  const grace = new GatewayHome();
  let artifactId: string;
  let versionId: string;
  const links: Record<"ada" | "grace", string> = { ada: "", grace: "" };

  const routeOf = (url: string): string =>
    (/\/a\/(rte_[0-9A-Z]{26})/.exec(new URL(url).pathname) as RegExpExecArray)[1] as string;

  beforeAll(async () => {
    port = await freePort();
    const controlPort = await freePort();
    server = await startServer({
      data: tempDir("tenancy-data"),
      port,
      config: testConfig(port, { operator: OPERATOR }),
      env: { MOSTRA_TEST_OPERATOR_PORT: String(controlPort) },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
    for (const [owner, name] of [
      [ada, "Ada"],
      [grace, "Grace"],
    ] as const) {
      await owner.start({ env: ownerEnv(port) });
      await ownerSignIn(owner.client, port, name);
    }
    const adas = await ada.publish("copied-project");
    const graces = await grace.publish("copied-project");
    // One copied project: the manifest's ID, and the same source built by the same runtime.
    expect(graces.artifactId).toBe(adas.artifactId);
    expect(graces.versionId).toBe(adas.versionId);
    artifactId = adas.artifactId;
    versionId = adas.versionId;
    for (const [who, owner] of [
      ["ada", ada],
      ["grace", grace],
    ] as const) {
      links[who] = ok<{ url: string }>(
        await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000),
      ).url;
    }
  }, 240_000);

  afterAll(async () => {
    await ada.stop();
    await grace.stop();
    await stopServer(server);
  });

  /** Writes an answer and submits it through the shell. */
  const submit = async (browser: Browser, opened: Opened, value: string) => {
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value }],
      },
      csrf: opened.frameCsrf,
    });
    if (fields.status !== 200) return fields;
    return browser.fetchJson(
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
  };

  /** A frame ticket for an opened page: the shell's ask, once more. */
  const ticket = (browser: Browser, opened: Opened) =>
    browser.fetchJson(opened.link.shell, `/a/${opened.link.artifactId}/_mostra/ticket`, {
      body: {},
      csrf: opened.shellCsrf,
    });

  it("hosts the one artifact ID on two routes, each with its own label", async () => {
    expect(routeOf(links.ada)).not.toBe(routeOf(links.grace));
    const adaFrame = (await openLink(new Browser(), links.ada)).frameOrigin;
    const graceFrame = (await openLink(new Browser(), links.grace)).frameOrigin;
    expect(adaFrame).not.toBe(graceFrame);
    // Neither link carries the artifact's own ID.
    expect(links.ada).not.toContain(artifactId);
    expect(links.grace).not.toContain(artifactId);
  }, 120_000);

  it("opens nothing of one home with another's link, session or frame ticket", async () => {
    const browser = new Browser();
    const adas = await openLink(browser, links.ada);
    const graceLink = new URL(links.grace);
    const graceRoute = graceLink.pathname;
    // Ada's token at Grace's route: unknown there.
    const read = await browser.ask({
      method: "POST",
      url: `${graceLink.origin}${graceRoute}/_mostra/session`,
      headers: {
        origin: graceLink.origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: adas.link.secret }),
      noCookies: true,
    });
    expect([401, 410]).toContain(read.status);
    // Ada's shell session sent for Grace's route.
    const secret = [...browser.shells.values()][0] as string;
    const session = await browser.ask({
      url: `${graceLink.origin}${graceRoute}/_mostra/session`,
      headers: { "x-mostra-shell": secret, "sec-fetch-site": "same-origin" },
      noCookies: true,
    });
    expect(session.status).toBe(401);
    const write = await browser.ask({
      method: "POST",
      url: `${graceLink.origin}${graceRoute}/_mostra/v/${REVISION}/submit`,
      headers: {
        origin: graceLink.origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-mostra-shell": secret,
        "x-mostra-csrf": adas.shellCsrf,
      },
      body: JSON.stringify({ viewId: adas.viewId, expectedRevision: "0" }),
      noCookies: true,
    });
    expect(write.status).toBe(401);
    // Ada's frame ticket entered at Grace's label, and Ada's frame session sent there.
    const graceFrame = (await openLink(new Browser(), links.grace)).frameOrigin;
    const fresh = await ticket(browser, adas);
    expect(fresh.status, fresh.body).toBe(200);
    const value = new URL(fresh.json<{ src: string }>().src).hash.slice(3);
    const entered = await browser.ask({
      method: "POST",
      url: `${graceFrame}/_mostra/enter`,
      headers: {
        origin: graceFrame,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ticket: value }),
      noCookies: true,
    });
    expect(entered.status).not.toBe(200);
    const frameSession = browser.frames.get(adas.frameOrigin) as string;
    const crossed = await browser.ask({
      url: `${graceFrame}/_mostra/session`,
      headers: { "x-mostra-frame": frameSession, "sec-fetch-site": "same-origin" },
      noCookies: true,
    });
    expect(crossed.status).toBe(401);
  }, 120_000);

  it("quarantines, pauses and removes one route through the handle, and leaves the other untouched", async () => {
    const adaRoute = routeOf(links.ada);
    const adaBrowser = new Browser();
    const adas = await openLink(adaBrowser, links.ada);
    const graceBrowser = new Browser();
    const graces = await openLink(graceBrowser, links.grace);

    // The identical version, quarantined on Ada's route only.
    expect(
      (await operator.handle("quarantine", { routeId: adaRoute, versionId }, "Review")).status,
    ).toBe(200);
    const underReview = await ticket(adaBrowser, adas);
    expect(underReview.status).toBe(403);
    expect(underReview.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_UNDER_REVIEW");
    expect((await ticket(graceBrowser, graces)).status).toBe(200);
    expect((await operator.handle("release", { routeId: adaRoute, versionId })).status).toBe(200);
    expect((await ticket(adaBrowser, adas)).status).toBe(200);

    // Ada's route paused: Ada's page takes no answer, Grace's does.
    expect((await operator.handle("pause", adaRoute, "Review")).status).toBe(200);
    expect((await submit(adaBrowser, adas, "paused")).status).toBe(423);
    const graceAnswer = await submit(graceBrowser, graces, "Grace's page answers");
    expect(graceAnswer.status, graceAnswer.body).toBe(200);
    expect((await operator.handle("resume", adaRoute)).status).toBe(200);

    // Ada's route removed: its page and label are gone, Grace's page stays.
    const adaLabel = new URL(adas.frameOrigin).host;
    expect((await operator.handle("remove", adaRoute)).status).toBe(200);
    expect(
      (await send(port, new URL(links.ada).host, new URL(links.ada).pathname)).status,
    ).not.toBe(200);
    expect((await send(port, adaLabel, "/_mostra/enter")).status).toBe(421);
    const stillThere = await openLink(new Browser(), links.grace);
    expect(stillThere.page.status).toBe(200);

    // Ada hosts the artifact again: a new route and a new label; the removed label stays unserved,
    // and Grace's pushes of the same ID never bring it back.
    const again = ok<{ url: string }>(
      await ada.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000),
    ).url;
    expect(routeOf(again)).not.toBe(adaRoute);
    const reopened = await openLink(new Browser(), again);
    expect(new URL(reopened.frameOrigin).host).not.toBe(adaLabel);
    ok(await grace.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000));
    expect((await send(port, adaLabel, "/_mostra/enter")).status).toBe(421);
    links.ada = again;
  }, 180_000);

  it("never gives a host an operator gave one home to another", async () => {
    const homeOf = async (routeId: string) =>
      String(
        (await operator.calls("limits")).find((call) => call.payload["routeId"] === routeId)
          ?.payload["home"],
      );
    const adaRoute = routeOf(links.ada);
    const graceRoute = routeOf(links.grace);
    const adaHome = await homeOf(adaRoute);
    const graceHome = await homeOf(graceRoute);
    expect(adaHome).not.toBe(graceHome);
    const chosen = `poll.content.localhost:${port}`;
    await operator.set({ routing: { [chosen]: { route: { home: adaHome, routeId: adaRoute } } } });
    expect((await send(port, chosen, `/a/${adaRoute}`)).status).toBe(200);
    // The operator then hands the same host to Grace's route: it stays Ada's home's, forever.
    await operator.set({
      routing: { [chosen]: { route: { home: graceHome, routeId: graceRoute } } },
    });
    expect((await send(port, chosen, `/a/${graceRoute}`)).status).not.toBe(200);
    // Even once Ada's route is gone.
    expect((await operator.handle("remove", adaRoute)).status).toBe(200);
    expect((await send(port, chosen, `/a/${graceRoute}`)).status).not.toBe(200);
    await operator.set({ routing: {} });
  }, 120_000);
});
