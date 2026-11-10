/**
 * The operator ports (HO-09; INTERFACES §18.6; D165 items 7, 9, 14; D167): a real
 * `mostra-runtime server` loads a fixture operator module (`test/fixtures/operator.mjs`) whose
 * every port the test drives through its control server, and an owner instance shares to it.
 * `limits` refuses with its words and, when it doesn't answer, shares fail closed while answers
 * proceed; `events` and `metering` arrive at least once with stable IDs across a restart;
 * `abuse.pushed` reads a pushed version and quarantines it; the report control reaches
 * `abuse.report`; `routing` serves a supplied host and an unknown one gets nothing; `policy`'s
 * chrome and expiry hold; and the server handle pauses, suspends, revokes, drains and removes,
 * each acting on one route or home only.
 */
import { cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  ApiBrowser,
  authorizeUrl,
  located,
  mcpAccessToken,
  pkce,
  register,
  signIn,
} from "../oauth-support.ts";
import { type Call, control } from "../operator-support.ts";
import {
  freePort,
  loopbackFetch,
  ownerEnv,
  ownerSignIn,
  postForm,
  type RunningServer,
  send,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts", import.meta.url));

describe("operator ports (HO-09)", () => {
  let port: number;
  let controlPort: number;
  let server: RunningServer;
  let data: string;
  const owner = new GatewayHome();
  let operator: ReturnType<typeof control>;

  const start = async () => {
    server = await startServer({
      data,
      port,
      config: testConfig(port, { operator: OPERATOR }),
      env: {
        MOSTRA_TEST_OPERATOR_PORT: String(controlPort),
        MOSTRA_TEST_OPERATOR_DISPATCH_MS: "100",
        MOSTRA_TEST_METER_WINDOW_MS: "300",
        MOSTRA_TEST_GRANT_RECHECK_MS: "500",
      },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
  };

  /**
   * Publishes a fresh copy of a fixture (a new artifact each time), under `once` per viewer so
   * every browser may answer, and shares it to the server; answers the share or the refusal.
   */
  const share = async (fixture = "single-mdx", entry = "page.mdx") => {
    const dir = join(tempDir(`op-${fixture}`), fixture);
    cpSync(join(FIXTURES, fixture), dir, { recursive: true });
    const receipt = ok<{ artifactId: string }>(
      await owner.client.call(
        "artifact/publish",
        {
          source: { path: entry ? join(dir, entry) : dir },
          policy: { policy: "once", scope: "per-viewer" },
        },
        120_000,
      ),
    );
    const answer = await owner.client.call(
      "share/start",
      { artifact: { artifactId: receipt.artifactId }, via: "remote" },
      60_000,
    );
    return { receipt, answer };
  };

  /** The route of a hosted link (`/a/<routeId>`). */
  const routeOf = (url: string): string =>
    (/\/a\/(rte_[0-9A-Z]{26})/.exec(new URL(url).pathname) as RegExpExecArray)[1] as string;

  /** Answers a hosted page's field and submits it through the shell; the submit's answer. */
  const answer = async (url: string, value: string) => {
    const browser = new Browser();
    const opened = await openLink(browser, url);
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
    expect(fields.status, fields.body).toBe(200);
    const revision = fields.json<{ revision: string }>().revision;
    const api = `${new URL(url).pathname}/_mostra`;
    return {
      browser,
      opened,
      submit: () =>
        browser.fetchJson(opened.link.shell, `${api}/v/${REVISION}/submit`, {
          body: { viewId: opened.viewId, expectedRevision: revision },
          csrf: opened.shellCsrf,
        }),
    };
  };

  beforeAll(async () => {
    port = await freePort();
    controlPort = await freePort();
    data = tempDir("operator-data");
    await start();
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
  }, 120_000);

  // Every case starts from an operator that allows everything and answers at once.
  beforeEach(async () => {
    await operator.set({
      limits: {},
      events: "ok",
      metering: "ok",
      routing: {},
      linkHost: null,
      policy: {},
      pushed: null,
      accounts: {},
      statuses: {},
      providers: [],
      credentials: {},
    });
  });

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  it("refuses a share with the operator's words, and fails closed while it doesn't answer", async () => {
    await operator.set({
      limits: { share: { code: "PLAN_LIMIT", message: "Your plan hosts three pages." } },
    });
    const refused = await share();
    expect(refused.answer.result).toBeUndefined();
    expect(JSON.stringify(refused.answer.error)).toContain("MOSTRA_REMOTE_LIMIT_REACHED");
    expect(JSON.stringify(refused.answer.error)).toContain("Your plan hosts three pages.");

    await operator.set({ limits: { share: "hang" } });
    const started = Date.now();
    const hung = await share();
    expect(JSON.stringify(hung.answer.error)).toContain("MOSTRA_REMOTE_OPERATOR_UNAVAILABLE");
    // The operator has 2 s (INTERFACES §18.6); nothing waited much past it.
    expect(Date.now() - started).toBeLessThan(15_000);
    const asked = await operator.calls("limits");
    expect(asked.some((call) => call.payload["operation"] === "share")).toBe(true);
    await operator.set({ limits: {} });
  }, 120_000);

  it("lets views and submissions through while `limits` doesn't answer, and refuses one it refuses", async () => {
    const { answer: shared } = await share();
    const url = ok<{ url: string }>(shared).url;
    await operator.set({ limits: { view: "hang", submit: "hang" } });
    const page = await answer(url, "through the silence");
    const submitted = await page.submit();
    expect(submitted.status, submitted.body).toBe(200);

    await operator.set({
      limits: {
        submit: { code: "CLOSED", message: "This page isn't accepting answers right now." },
      },
    });
    const second = await answer(url, "refused");
    const refused = await second.submit();
    expect(refused.status).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_LIMIT_REACHED");
    await operator.set({ limits: {} });
  }, 120_000);

  it("delivers events and meter batches at least once, with stable IDs across a restart", async () => {
    await operator.set({ events: "fail", metering: "fail" });
    const earlierAttempts = (await operator.calls("events.attempt")).length;
    const { answer: shared } = await share();
    const url = ok<{ url: string }>(shared).url;
    const page = await answer(url, "kept for the operator");
    const submitted = await page.submit();
    expect(submitted.status, submitted.body).toBe(200);
    const submissionId = submitted.json<{ id: string }>().id;
    // The operator refuses for now: the server keeps trying the oldest event, in order, under
    // the same ID each time.
    let tried: string[] = [];
    await eventually(
      async () => {
        tried = (await operator.calls("events.attempt"))
          .slice(earlierAttempts)
          .map((call) => String(call.payload["eventId"]));
        return tried.length >= 2;
      },
      30_000,
      `a retried event (data ${data})`,
    );
    expect(tried[1]).toBe(tried[0]);
    await eventually(
      async () => (await operator.calls("metering.attempt")).length >= 1,
      30_000,
      "a meter batch",
    );

    // A restart in the middle: what wasn't delivered is still there, under the same IDs.
    await stopServer(server);
    await start();
    await operator.set({ events: "ok", metering: "ok" });
    await eventually(
      async () =>
        (await operator.calls("events")).some(
          (call) =>
            call.payload["kind"] === "submission.accepted" &&
            (call.payload["payload"] as { submission: { id: string } }).submission.id ===
              submissionId,
        ),
      30_000,
      "the submission's event delivered after the restart",
    );
    const deliveredIds = (await operator.calls("events")).map((call) =>
      String(call.payload["eventId"]),
    );
    expect(deliveredIds).toContain(tried[0]);
    const delivered = (await operator.calls("events")).find(
      (call) =>
        call.payload["kind"] === "submission.accepted" &&
        (call.payload["payload"] as { submission: { id: string } }).submission.id === submissionId,
    ) as Call;
    expect(delivered.payload["routeId"]).toBe(routeOf(url));
    expect(String(delivered.payload["label"])).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    const results = delivered.payload["payload"] as { submission: { id: string } };
    expect(results.submission.id).toBe(submissionId);

    await eventually(
      async () => (await operator.calls("metering")).length >= 1,
      30_000,
      "a meter batch delivered",
    );
    const counters = (await operator.calls("metering")).flatMap(
      (call) => call.payload["counters"] as { name: string; dimensions?: Record<string, string> }[],
    );
    const views = counters.filter((counter) => counter.name === "views");
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) expect(view.dimensions?.["viewerKey"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(counters.some((counter) => counter.name === "submissions")).toBe(true);
    // Every batch ID delivered once is delivered under the ID it was first tried with.
    const firstTried = (await operator.calls("metering.attempt"))[0]?.payload["batchId"];
    expect((await operator.calls("metering")).map((call) => call.payload["batchId"])).toContain(
      firstTried,
    );
  }, 180_000);

  it("reads a pushed version, quarantines it on the operator's word, and releases it", async () => {
    await operator.set({ pushed: "quarantine" });
    const { answer: shared } = await share();
    const url = ok<{ url: string }>(shared).url;
    await eventually(
      async () => (await operator.calls("abuse.pushed")).length > 0,
      30_000,
      "the after-push hook",
    );
    const pushed = (await operator.calls("abuse.pushed")).at(-1) as Call;
    expect(pushed.payload["routeId"]).toBe(routeOf(url));
    expect(Number(pushed.payload["firstFileBytes"])).toBeGreaterThan(0);
    // Quarantined: no frame, the neutral "under review" answer, the data kept.
    await eventually(
      async () => {
        const browser = new Browser();
        try {
          await openLink(browser, url);
          return false;
        } catch (error) {
          return String(error).includes("MOSTRA_REMOTE_UNDER_REVIEW");
        }
      },
      15_000,
      "the quarantine",
    );
    await operator.set({ pushed: undefined });
    const released = await operator.handle("release", { routeId: routeOf(url) });
    expect(released.status, JSON.stringify(released.json)).toBe(200);
    await answer(url, "after the review");
  }, 120_000);

  it("sends the report control to `abuse.report` and holds `policy`'s chrome and expiry", async () => {
    await operator.set({
      policy: {
        footer: "Never enter passwords on pages sent to you.",
        afterSubmit: "Your agent can send pages like this.",
        interstitial: { kind: "external", message: "You are leaving for a page someone sent." },
      },
    });
    const { answer: shared } = await share();
    const url = ok<{ url: string }>(shared).url;
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const api = `${new URL(url).pathname}/_mostra`;
    const ticket = await browser.fetchJson(opened.link.shell, `${api}/ticket`, {
      body: {},
      csrf: opened.shellCsrf,
    });
    const hosted = ticket.json<{
      hosted: {
        footer?: string;
        afterSubmit?: string;
        interstitial?: { kind: string };
        sender?: { name: string };
      };
    }>().hosted;
    expect(hosted.footer).toBe("Never enter passwords on pages sent to you.");
    expect(hosted.afterSubmit).toBe("Your agent can send pages like this.");
    expect(hosted.interstitial?.kind).toBe("external");
    expect(hosted.sender?.name).toBe("Ada");

    const reported = await browser.fetchJson(opened.link.shell, `${api}/report`, {
      body: { reason: "phishing", detail: "It asks for a bank password." },
      csrf: opened.shellCsrf,
    });
    expect(reported.status, reported.body).toBe(202);
    const report = (await operator.calls("abuse.report")).at(-1) as Call;
    expect(report.payload["routeId"]).toBe(routeOf(url));
    expect(report.payload["reason"]).toBe("phishing");

    // An idle expiry of one second: the link is revoked at its next use, 410.
    await operator.set({ policy: { idleExpiry: "1s" } });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const late = await browser.fetchJson(opened.link.shell, `${api}/ticket`, {
      body: {},
      csrf: opened.shellCsrf,
    });
    expect(late.status, late.body).toBe(410);
    await operator.set({ policy: {} });
  }, 120_000);

  it("serves a host the operator supplies, mints links on it, and gives an unknown host nothing", async () => {
    const { answer: shared } = await share();
    const url = ok<{ url: string }>(shared).url;
    const routeId = routeOf(url);
    const home = String(
      (await operator.calls("limits")).find((call) => call.payload["home"] !== undefined)?.payload[
        "home"
      ],
    );
    const chosen = `survey.content.localhost:${port}`;
    const outside = `pages.acme.localhost:${port}`;
    await operator.set({
      routing: {
        [chosen]: { route: { home, routeId } },
        [outside]: { shell: { domain: outside, home } },
      },
      linkHost: outside,
    });
    // A link minted now goes on the operator's host, and opens there with its frames under the
    // operator's domain, framed only by its shells.
    const { answer: later } = await share();
    const minted = new URL(ok<{ url: string }>(later).url);
    expect(minted.host).toBe(outside);
    const browser = new Browser();
    const opened = await openLink(browser, minted.href);
    expect(new URL(opened.frameOrigin).host).toMatch(
      new RegExp(`^[0-9a-hjkmnp-tv-z]{26}\\.pages\\.acme\\.localhost:${port}$`),
    );
    expect(opened.page.header("content-security-policy")).toContain(
      `frame-ancestors http://${outside}`,
    );
    // The operator's domain serves only the routes of the home it was given for, and a host it
    // answers for is bound to that home forever.
    const recorded = (await operator.calls("routing.resolve")).map((call) => call.payload["host"]);
    expect(recorded).toContain(outside);
    const unknown = await send(port, `stranger.localhost:${port}`, `/a/${routeId}`);
    expect(unknown.status).toBe(421);
    const unknownLabel = await send(port, `nobody.content.localhost:${port}`, "/");
    expect(unknownLabel.status).toBe(421);
    // The chosen label shows the route's shell; another route's path there gets nothing.
    const page = await send(port, chosen, `/a/${routeId}`);
    expect(page.status, page.body).toBe(200);
    // Another route of the same home: the chosen host shows its one route only.
    const other = await send(port, chosen, `/a/${routeOf(minted.href)}`);
    expect(other.status).toBe(404);
    await operator.set({ routing: {}, linkHost: null });
  }, 120_000);

  it("pauses, suspends, revokes, drains and removes through the handle, and the owner can't undo an operator's pause", async () => {
    const { receipt, answer: shared } = await share();
    const url = ok<{ url: string; tokenId: string }>(shared).url;
    const routeId = routeOf(url);
    const artifact = { artifactId: receipt.artifactId };

    // The operator's pause: views keep working and say so, answers are refused with the draft
    // kept, and only the operator resumes it.
    const pausedByOperator = await operator.handle("pause", routeId, "Under review");
    expect(pausedByOperator.status, JSON.stringify(pausedByOperator.json)).toBe(200);
    const paused = await answer(url, "while paused");
    const refused = await paused.submit();
    expect(refused.status).toBe(423);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_SUBMIT_PAUSED");
    const ticket = await paused.browser.fetchJson(
      paused.opened.link.shell,
      `${new URL(url).pathname}/_mostra/ticket`,
      { body: {}, csrf: paused.opened.shellCsrf },
    );
    expect(ticket.json<{ paused?: { by: string } }>().paused?.by).toBe("operator");
    const undo = await owner.client.call("artifact/pause", { artifact, paused: false }, 30_000);
    expect(JSON.stringify(undo.error)).toContain("MOSTRA_REMOTE_PAUSED_BY_OPERATOR");
    expect((await operator.handle("resume", routeId)).status).toBe(200);
    const after = await paused.submit();
    expect(after.status, after.body).toBe(200);

    // The owner's own pause, from its instance: the same refusal, and the owner resumes it.
    const own = ok<{ paused: boolean; by?: string }>(
      await owner.client.call(
        "artifact/pause",
        { artifact, paused: true, reason: "Closed" },
        30_000,
      ),
    );
    expect(own).toEqual({ paused: true, by: "owner" });
    const later = await answer(url, "owner paused");
    expect((await later.submit()).status).toBe(423);
    ok(await owner.client.call("artifact/pause", { artifact, paused: false }, 30_000));
    expect((await later.submit()).status).toBe(200);

    // A suspended home serves nothing, and comes back on resumeHome.
    const home = String(
      (await operator.calls("limits")).find((call) => call.payload["routeId"] === routeId)?.payload[
        "home"
      ],
    );
    expect((await operator.handle("suspendHome", home, "Terms")).status).toBe(200);
    const shellHost = new URL(url).host;
    const suspended = await send(port, shellHost, `/a/${routeId}`);
    expect(suspended.status).toBe(403);
    expect(suspended.body).toContain("MOSTRA_REMOTE_HOME_SUSPENDED");
    expect((await operator.handle("resumeHome", home)).status).toBe(200);
    expect((await send(port, shellHost, `/a/${routeId}`)).status).toBe(200);

    // A drained home answers "moving" until released.
    expect((await operator.handle("drainHome", home)).status).toBe(200);
    const moving = await send(port, shellHost, `/a/${routeId}`);
    expect(moving.status).toBe(503);
    expect(moving.body).toContain("MOSTRA_REMOTE_HOME_MOVING");
    expect((await operator.handle("releaseHome", home)).status).toBe(200);
    await eventually(
      async () => (await send(port, shellHost, `/a/${routeId}`)).status === 200,
      30_000,
      "the released home",
    );

    // A restore from a backup: the home rotates its incarnation before it answers anyone, and its
    // owner, meeting the new incarnation, records the regression once (FAILURE_MODEL §11.2).
    const regressions = async (): Promise<number> =>
      ok<{ events: unknown[] }>(
        await owner.client.call("events/read", { filter: { types: ["remote.regressed"] } }),
      ).events.length;
    const before = await regressions();
    expect((await operator.handle("restored", home)).status).toBe(200);
    await eventually(async () => (await regressions()) === before + 1, 60_000, "remote.regressed");
    expect((await send(port, shellHost, `/a/${routeId}`)).status).toBe(200);

    // Revoking: one link, then every link of the route.
    const second = ok<{ url: string; tokenId: string }>(
      await owner.client.call("share/start", { artifact, via: "remote" }, 60_000),
    );
    expect((await operator.handle("revokeLink", second.tokenId)).status).toBe(200);
    await expect(openLink(new Browser(), second.url)).rejects.toThrow(/410/);
    await answer(url, "the first link still works");
    const revoked = await operator.handle("revokeLinks", routeId);
    expect((revoked.json as { result: number }).result).toBeGreaterThanOrEqual(1);
    await expect(openLink(new Browser(), url)).rejects.toThrow(/410/);

    // Removal: the route is gone, its label is never served again.
    const label = new URL(
      (
        await openLink(
          new Browser(),
          ok<{ url: string }>(
            await owner.client.call("share/start", { artifact, via: "remote" }, 60_000),
          ).url,
        )
      ).frameOrigin,
    ).host;
    const removed = await operator.handle("remove", routeId);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect((await send(port, shellHost, `/a/${routeId}`)).status).toBe(404);
    expect((await send(port, label, "/")).status).toBe(421);
  }, 180_000);

  /** The owner's hosted home, from the server's directory. */
  const homeOf = async (): Promise<string> => {
    const account = ok<{ links: { account: { id: string } }[] }>(
      await owner.client.call("remote/status", {}),
    ).links[0]?.account.id;
    const db = new Database(join(data, "server.sqlite"), { readonly: true, fileMustExist: true });
    try {
      return (
        db.prepare("SELECT id FROM home WHERE owner_account_id = ?").get(account) as { id: string }
      ).id;
    } finally {
      db.close();
    }
  };

  /** An MCP call over `/mcp` with a bearer token: its status and body. */
  const mcpCall = (bearer: string) =>
    send(port, `api.localhost:${port}`, "/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  it("lets a suspended home use /mcp no more than its pages (Fable review, 1)", async () => {
    const token = await mcpAccessToken(port, "Ada");
    expect((await mcpCall(token)).status).toBe(200);
    const home = await homeOf();
    expect((await operator.handle("suspendHome", home, "Terms")).status).toBe(200);
    const refused = await mcpCall(token);
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("MOSTRA_REMOTE_HOME_SUSPENDED");
    expect((await operator.handle("resumeHome", home)).status).toBe(200);
    expect((await mcpCall(token)).status).toBe(200);
  }, 120_000);

  it("suspends an account on the operator's word: its MCP calls, refreshes and binding (Fable review, 6)", async () => {
    const token = await mcpAccessToken(port, "Ada");
    expect((await mcpCall(token)).status).toBe(200);
    const account = ok<{ links: { account: { id: string } }[] }>(
      await owner.client.call("remote/status", {}),
    ).links[0]?.account.id as string;
    expect(account).toBe("op:ada");
    await operator.set({ statuses: { [account]: "suspended" } });
    // Asked within the recheck bound, then refused everywhere the account acts.
    await eventually(async () => (await mcpCall(token)).status === 403, 10_000, "/mcp refused");
    await eventually(
      async () =>
        ok<{ links: { state: string }[] }>(await owner.client.call("remote/status", {})).links[0]
          ?.state !== "connected",
      30_000,
      "the binding closed",
    );
    expect((await operator.calls("accounts.status")).length).toBeGreaterThan(0);
    // The operator lifts it: the account acts again, and the owner's binding comes back.
    await operator.set({ statuses: {} });
    await eventually(async () => (await mcpCall(token)).status === 200, 10_000, "/mcp again");
    await eventually(
      async () =>
        ok<{ links: { state: string }[] }>(await owner.client.call("remote/status", {})).links[0]
          ?.state === "connected",
      90_000,
      "the binding back",
    );
  }, 180_000);

  it("approves a device code through the development form only as the operator resolves it (Fable review, 5)", async () => {
    const pending = async () => {
      const started = await postForm(port, "/oauth/device", { client_id: "mostra-cli" });
      return JSON.parse(started.body) as { device_code: string; user_code: string };
    };
    const poll = async (deviceCode: string) =>
      JSON.parse(
        (
          await postForm(port, "/oauth/token", {
            client_id: "mostra-cli",
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
          })
        ).body,
      ) as { error?: string };
    const approve = (userCode: string, name: string) =>
      postForm(
        port,
        "/device",
        { user_code: userCode, name, provider: "dev", decision: "approve" },
        { origin: `http://api.localhost:${port}` },
      );
    // The operator refuses this person: the form links nothing.
    await operator.set({ accounts: { mallory: { refused: { message: "Not on this server." } } } });
    const refused = await pending();
    const answer = await approve(refused.user_code, "Mallory");
    expect(answer.status).toBe(403);
    expect(answer.body).toContain("Not on this server.");
    expect((await poll(refused.device_code)).error).toBe("authorization_pending");
    // While the operator supplies providers of its own, the page offers no development form, and
    // a post of one is refused too.
    await operator.set({
      accounts: {},
      providers: [{ id: "acme", label: "Acme SSO", behaviour: "ok" }],
    });
    const hidden = await pending();
    expect((await approve(hidden.user_code, "Grace")).status).toBe(400);
    expect((await poll(hidden.device_code)).error).toBe("authorization_pending");
    await operator.set({ providers: [] });
  }, 60_000);

  it("links no instance for an operator's key used on /mcp first (Fable review, 3)", async () => {
    const key = "op-key-bob-3a9c7e1f5d2b8a4c6e0f";
    await operator.set({
      credentials: { [key]: { account: "op:bob", scope: ["mostra"], subject: "laptop" } },
    });
    expect((await mcpCall(key)).status).toBe(200);
    const links = (): { id: string; is_default: number }[] => {
      const db = new Database(join(data, "server.sqlite"), { readonly: true, fileMustExist: true });
      try {
        return db
          .prepare("SELECT id, is_default FROM instance_link WHERE account_id = ?")
          .all("op:bob") as { id: string; is_default: number }[];
      } finally {
        db.close();
      }
    };
    expect(links()).toEqual([]);
    // Its binding links one, the account's default.
    const cell = new GatewayHome();
    await cell.start({ env: ownerEnv(port) });
    try {
      const linked = ok<{ instanceId: string; default: boolean }>(
        await cell.client.call("remote/link", { server: `http://api.localhost:${port}`, key }),
      );
      expect(linked.default).toBe(true);
      expect(links()).toEqual([{ id: linked.instanceId, is_default: 1 }]);
    } finally {
      await cell.stop();
    }
  }, 120_000);

  it("asks for the operator's identity providers at every sign-in, bounded, and checks what they name", async () => {
    const api = `http://api.localhost:${port}`;
    const page = async (): Promise<string> =>
      (await new ApiBrowser(port, `api.localhost:${port}`).ask("GET", "/device")).body;
    expect(await page()).not.toContain("Acme SSO");
    // A provider the operator turns on is offered at the next sign-in, with no restart (D167).
    await operator.set({
      providers: [{ id: "acme", label: "Acme SSO", behaviour: "ok", who: "acme-person" }],
    });
    expect(await page()).toContain("Continue with Acme SSO");
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const toProvider = located(await who.ask("GET", "/signin/acme/start?next=/device"));
    expect(`${toProvider.origin}${toProvider.pathname}`).toBe(`${api}/signin/acme/callback`);
    const signedIn = located(await who.ask("GET", `${toProvider.pathname}${toProvider.search}`));
    expect(signedIn.pathname).toBe("/device");
    const resolved = (await operator.calls("accounts.resolve")).at(-1);
    expect(resolved?.payload["provider"]).toBe("acme");
    // An answer naming nobody signs nobody in.
    await operator.set({ providers: [{ id: "acme", label: "Acme SSO", behaviour: "bad" }] });
    const bad = new ApiBrowser(port, `api.localhost:${port}`);
    const back = located(await bad.ask("GET", "/signin/acme/start?next=/device"));
    const refused = await bad.ask("GET", `${back.pathname}${back.search}`);
    expect(refused.status).toBe(400);
    expect(bad.jar.has("mostra-signin")).toBe(false);
    // A provider that never answers is given up on inside the authorization server's 10 s.
    await operator.set({ providers: [{ id: "acme", label: "Acme SSO", behaviour: "hang" }] });
    const started = Date.now();
    const hung = await new ApiBrowser(port, `api.localhost:${port}`).ask(
      "GET",
      "/signin/acme/start?next=/device",
    );
    expect(hung.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(10_000);
    // Turned off, it's gone at once.
    await operator.set({ providers: [] });
    expect(await page()).not.toContain("Acme SSO");
    expect(
      (await new ApiBrowser(port, `api.localhost:${port}`).ask("GET", "/signin/acme/start")).status,
    ).toBe(404);
  }, 60_000);

  it("sends a person to the operator's first sign-in step and resumes there, once", async () => {
    const api = `http://api.localhost:${port}`;
    await operator.set({
      accounts: { grace: { step: { url: "https://operator.example/welcome" } } },
    });
    const redirect = "https://client.example/callback";
    const clientId = await register(port, redirect, "Step test client");
    const who = new ApiBrowser(port, `api.localhost:${port}`);
    const { challenge } = pkce();
    const first = await who.ask("GET", authorizeUrl(api, clientId, redirect, challenge));
    // The provider names Grace; the operator asks for a step first, on its own origin.
    const step = await signIn(who, first, "Grace");
    expect(step.origin).toBe("https://operator.example");
    const back = new URL(step.searchParams.get("mostra_return") as string);
    expect(`${back.origin}${back.pathname}`).toBe(`${api}/signin/return`);
    expect(back.searchParams.get("step")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The browser's own sign-in cookie, kept to try the return again after it was used.
    const flow = [...who.jar].find(([name]) => name.includes("flow")) as [string, string];
    expect(flow).toBeDefined();
    // The person does what the step asks; the operator now answers with the account.
    await operator.set({ accounts: { grace: { account: "op:grace", status: "active" } } });
    const resumed = located(await who.ask("GET", `${back.pathname}${back.search}`));
    expect(resumed.pathname).toBe("/oauth/authorize/continue");
    const asked = (await operator.calls("accounts.resolve")).filter(
      (call) => call.payload["subject"] === "grace",
    );
    expect(asked).toHaveLength(2);
    // A step's return is single-use, even in the browser that started it with its cookie back,
    // and bound to that browser: another browser holding the link gets nothing.
    who.jar.set(flow[0], flow[1]);
    const again = await who.ask("GET", `${back.pathname}${back.search}`);
    expect(again.status).toBe(400);
    const stranger = new ApiBrowser(port, `api.localhost:${port}`);
    expect((await stranger.ask("GET", `${back.pathname}${back.search}`)).status).toBe(400);
    await operator.set({ accounts: {} });
  }, 60_000);

  it("links an always-on instance with an operator-issued key on /host, /files and /mcp, and counts MCP calls by client", async () => {
    const api = `http://api.localhost:${port}`;
    const key = "op-key-7f3c2a9e5b1d4c8a6e0f2b3d";
    await operator.set({
      credentials: { [key]: { account: "op:ada", scope: ["mostra"], subject: "cell-1" } },
    });
    const cell = new GatewayHome();
    await cell.start({ env: ownerEnv(port) });
    try {
      // A key the operator didn't issue links nothing.
      const refused = await cell.client.call("remote/link", {
        server: api,
        key: "op-key-not-issued-by-the-operator-0000",
      });
      expect(
        (refused as { error?: { data?: { code?: string } } }).error?.data?.code,
        JSON.stringify(refused),
      ).toBe("MOSTRA_REMOTE_LOGIN_FAILED");
      const linked = ok<{
        account: { id: string };
        instanceId: string;
        default: boolean;
      }>(await cell.client.call("remote/link", { server: api, key, default: true }));
      expect(linked.account.id).toBe("op:ada");
      expect(linked.instanceId).toMatch(/^lnk_/);
      expect(linked.default).toBe(true);
      await eventually(async () => {
        const links = ok<{ links: { state: string }[] }>(
          await cell.client.call("remote/status", {}),
        ).links;
        return links[0]?.state === "connected";
      }, 30_000);
      // The binding and the version files run on the key: the instance hosts a page.
      const dir = join(tempDir("op-key"), "single-mdx");
      cpSync(join(FIXTURES, "single-mdx"), dir, { recursive: true });
      const receipt = ok<{ artifactId: string }>(
        await cell.client.call(
          "artifact/publish",
          { source: { path: join(dir, "page.mdx") } },
          120_000,
        ),
      );
      const shared = ok<{ url: string }>(
        await cell.client.call(
          "share/start",
          { artifact: { artifactId: receipt.artifactId }, via: "remote" },
          60_000,
        ),
      );
      expect(new URL(shared.url).pathname).toMatch(/^\/a\/rte_/);
      const resources = (await operator.calls("accounts.authenticate")).map(
        (call) => call.payload["resource"],
      );
      expect(resources).toContain("host");
      expect(resources).toContain("files");
      // MCP takes the key too, and each call is counted under the client's `clientInfo` name.
      const client = new Client({ name: "acme-agent", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${api}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${key}` } },
          fetch: loopbackFetch,
        }),
      );
      expect((await client.listTools()).tools.length).toBe(13);
      await client.close();
      expect(
        (await operator.calls("accounts.authenticate")).map((call) => call.payload["resource"]),
      ).toContain("mcp");
      await eventually(async () => {
        const counters = (await operator.calls("metering")).flatMap(
          (call) =>
            call.payload["counters"] as { name: string; dimensions?: Record<string, string> }[],
        );
        return counters.some(
          (counter) =>
            counter.name === "mcp.calls" && counter.dimensions?.["client"] === "acme-agent",
        );
      }, 20_000);
      // The key is kept only in the home's owner-only credentials file: no ledger, log or other
      // file of the home holds it.
      const holding = readdirSync(cell.home.home, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((file) => readFileSync(file).includes(key));
      expect(holding.map((file) => file.slice(cell.home.home.length))).toEqual([
        expect.stringMatching(/[\\/]keys[\\/]remote[\\/][^\\/]+\.json$/),
      ]);
      // The operator revokes the key: the binding closes within the bound, and stays closed.
      await operator.set({ credentials: {} });
      await eventually(async () => {
        const links = ok<{ links: { state: string }[] }>(
          await cell.client.call("remote/status", {}),
        ).links;
        return links[0]?.state !== "connected";
      }, 30_000);
    } finally {
      await operator.set({ credentials: {} });
      await cell.stop();
    }
  }, 240_000);
});
