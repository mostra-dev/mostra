/**
 * Hosted pages and their answers (WP-29, RM-02; INTERFACES §18.2, §18.4; D165 items 1, 1a, 7,
 * 8): an owner instance shares a published version to a real `mostra-runtime server`
 * (`share/start { via: "remote" }`); a browser opens the hosted link on the user-content domain's
 * apex, with no cookie anywhere and its session in a header, its frame on the route's own label
 * in worker mode; it answers and submits; the respondent learns only that the answer was sent;
 * the owner instance receives the submission through its outbox, its `wait` returns and its
 * `results` hold the answer with where it came from.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserializeAll, type Frame, MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink, seen } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { connectTo, eventually, initializeParams, tempDir } from "../support.ts";

const REVISION = "2026-10-15";

describe("hosted pages (§18.4)", () => {
  let port: number;
  let server: RunningServer;
  const owner = new GatewayHome();

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({ data: tempDir("server-data"), port });
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
  }, 120_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  it("serves a shared version on its route, takes an answer and hands it to the owner", async () => {
    const receipt = await owner.publish("single-tsx", "page.tsx");
    const share = ok<{ url: string; via: string; tokenId: string; hostname: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
      }),
    );
    expect(share.via).toBe("remote");
    // The link is the hosted home's: the active domain's apex, the route's ID, never the
    // artifact's own ID (INTERFACES §18.4).
    const url = new URL(share.url);
    expect(url.host).toBe(`content.localhost:${port}`);
    expect(url.pathname).toMatch(/^\/a\/rte_[0-9A-Z]{26}$/);
    expect(share.url).not.toContain(receipt.artifactId);

    const browser = new Browser();
    const before = seen.length;
    const opened = await openLink(browser, share.url);
    // The frame is on the route's label, in worker mode: cross-origin to the shell.
    expect(new URL(opened.frameOrigin).host).toMatch(
      new RegExp(`^[0-9a-hjkmnp-tv-z]{26}\\.content\\.localhost:${port}$`),
    );
    expect(opened.ticketSrc).toContain("/_mostra/enter#t=");
    expect(opened.page.status).toBe(200);
    // No hosted answer ever sets a cookie, and every one keeps its agent cluster.
    for (const answer of seen.slice(before)) {
      expect(answer.headers["set-cookie"]).toBeUndefined();
    }
    expect(opened.page.header("origin-agent-cluster")).toBe("?1");

    // The respondent answers in the frame and submits through the trusted Submit.
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value: "yes, ship it" }],
      },
      csrf: opened.frameCsrf,
    });
    expect(fields.status, fields.body).toBe(200);
    const revision = fields.json<{ revision: string }>().revision;
    const api = `${url.pathname}/_mostra`;
    const submitted = await browser.fetchJson(opened.link.shell, `${api}/v/${REVISION}/submit`, {
      body: { viewId: opened.viewId, expectedRevision: revision },
      csrf: opened.shellCsrf,
    });
    expect(submitted.status, submitted.body).toBe(200);
    // "Your answer was sent." and nothing about delivery (D165 item 1a).
    const summary = submitted.json<{ id: string; delivery: string; deliveries?: unknown }>();
    expect(summary.delivery).toBe("delivered");
    expect(summary.deliveries).toBeUndefined();

    // The owner's agent waits and reads it locally: the hosted home delivered it to the owner
    // instance, which stored the same submission and its own deliveries in one transaction.
    const waited = ok<{ status: string }>(
      await owner.client.call(
        "wait",
        { artifact: { artifactId: receipt.artifactId }, until: "submitted", timeoutMs: 20_000 },
        30_000,
      ),
    );
    expect(waited.status).toBe("satisfied");
    const results = ok<{
      answers: Record<string, unknown>;
      submission: { id: string; origin?: { server: string } };
    }>(await owner.client.call("results/get", { artifact: { artifactId: receipt.artifactId } }));
    expect(results.submission.id).toBe(summary.id);
    expect(results.answers).toEqual({ answer: "yes, ship it" });
    expect(results.submission.origin?.server).toBe(`http://api.localhost:${port}`);

    // The respondent's own poll carries no delivery event, however the owner's delivery went.
    const poll = await browser.fetchJson(
      opened.link.shell,
      `${api}/v/${REVISION}/events/poll?view=${opened.viewId}&cursor=0&wait=0`,
    );
    expect(poll.status, poll.body).toBe(200);
    const types = poll.json<{ events: { type: string }[] }>().events.map((event) => event.type);
    expect(types).toContain("submission.created");
    expect(
      types.filter((type) => type.startsWith("submission.") && type !== "submission.created"),
    ).toEqual([]);
  }, 120_000);

  it("refuses a session sent for another route, and a cookie stands for nothing", async () => {
    const first = await owner.publish("directory");
    const second = await owner.publish("single-mdx", "page.mdx");
    const shareOf = async (artifactId: string) =>
      ok<{ url: string }>(
        await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
      ).url;
    const a = new URL(await shareOf(first.artifactId));
    const b = new URL(await shareOf(second.artifactId));
    const browser = new Browser();
    await openLink(browser, a.toString());
    const secret = [...browser.shells.values()][0] as string;
    const other = await browser.ask({
      url: `${b.origin}${b.pathname}/_mostra/session`,
      headers: { "x-mostra-shell": secret, "sec-fetch-site": "same-origin" },
    });
    expect(other.status).toBe(401);
    // Only the header counts: the same secret as a cookie opens nothing.
    const cookie = await browser.ask({
      url: `${a.origin}${a.pathname}/_mostra/session`,
      headers: { cookie: `mostra-0=${secret}`, "sec-fetch-site": "same-origin" },
      noCookies: true,
    });
    expect(cookie.status).toBe(401);
  }, 120_000);

  it("stops a remote share by revoking its hosted link", async () => {
    const receipt = await owner.publish("directory");
    const share = ok<{ shareId: string; url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
      }),
    );
    const listed = ok<{ shares: { shareId: string; url?: string; via: string }[] }>(
      await owner.client.call("share/list", {}),
    ).shares.find((found) => found.shareId === share.shareId);
    expect(listed).toMatchObject({ via: "remote", url: share.url });
    ok(await owner.client.call("share/stop", { shareId: share.shareId }));
    const browser = new Browser();
    await expect(openLink(browser, share.url)).rejects.toThrow(/exchange: 410/);
  }, 120_000);
  it("brings a hosted page's signals and state to the owner's local waits (the sync cursor)", async () => {
    const receipt = await owner.publish("single-tsx", "page.tsx");
    const url = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
      }),
    ).url;
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const waiting = owner.client.call(
      "wait",
      { artifact: { artifactId: receipt.artifactId }, until: "signal:ping", timeoutMs: 20_000 },
      30_000,
    );
    const raised = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/signal`, {
      body: { viewId: opened.viewId, name: "ping", payload: { n: 1 } },
      csrf: opened.frameCsrf,
    });
    expect(raised.status, raised.body).toBe(200);
    const satisfied = ok<{ status: string; event: { type: string; payload: { name: string } } }>(
      await waiting,
    );
    expect(satisfied).toMatchObject({ status: "satisfied", event: { type: "signal.raised" } });
    // Artifact state a hosted viewer writes reaches the owner's `wait` the same way.
    const stateWait = owner.client.call(
      "wait",
      { artifact: { artifactId: receipt.artifactId }, until: "state:board", timeoutMs: 20_000 },
      30_000,
    );
    const wrote = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XH",
        scope: "artifact",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "board", value: ["one task"] }],
      },
      csrf: opened.frameCsrf,
    });
    expect(wrote.status, wrote.body).toBe(200);
    expect(ok<{ status: string }>(await stateWait).status).toBe("satisfied");
  }, 120_000);

  it("counts a hosted tally in the submit transaction and serves it with the owner offline (RM-07)", async () => {
    const dir = join(tempDir("hosted-tally"), "poll");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.tsx"),
      `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Hosted poll",
  submission: { policy: "epochs" },
  tally: [{ field: "decision", choices: ["ship", "wait", "drop"] }],
});

export default function Page() {
  const [decision, setDecision] = useField("decision", "ship");
  return <input value={decision} onChange={(event) => setDecision(event.target.value)} />;
}
`,
    );
    const receipt = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    );
    const url = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
      }),
    ).url;
    // The owner goes away: the hosted home counts and serves the tally alone, with no worker.
    await owner.stop();
    try {
      const browser = new Browser();
      const opened = await openLink(browser, url);
      const api = `${new URL(url).pathname}/_mostra/v/${REVISION}`;
      const choices = ["ship", "wait", "drop"];
      const expected: Record<string, number> = { ship: 0, wait: 0, drop: 0 };
      let revision = "0";
      for (let n = 0; n < 300; n += 1) {
        const choice = choices[n % 3] as string;
        expected[choice] = (expected[choice] ?? 0) + 1;
        const fields = await browser.fetchJson(
          opened.frameOrigin,
          `/_mostra/v/${REVISION}/fields`,
          {
            body: {
              mutationId: MutationId.create(),
              scope: "viewer",
              baseRevision: revision,
              viewId: opened.viewId,
              ops: [{ id: "decision", value: choice }],
            },
            csrf: opened.frameCsrf,
          },
        );
        expect(fields.status, fields.body).toBe(200);
        revision = fields.json<{ revision: string }>().revision;
        const submitted = await browser.fetchJson(opened.link.shell, `${api}/submit`, {
          body: { viewId: opened.viewId, expectedRevision: revision },
          csrf: opened.shellCsrf,
        });
        expect(submitted.status, submitted.body).toBe(200);
      }
      // A value outside the choices counts nothing.
      const outside = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
        body: {
          mutationId: MutationId.create(),
          scope: "viewer",
          baseRevision: revision,
          viewId: opened.viewId,
          ops: [{ id: "decision", value: "free text" }],
        },
        csrf: opened.frameCsrf,
      });
      revision = outside.json<{ revision: string }>().revision;
      await browser.fetchJson(opened.link.shell, `${api}/submit`, {
        body: { viewId: opened.viewId, expectedRevision: revision },
        csrf: opened.shellCsrf,
      });
      const read = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/live`, {
        body: { viewId: opened.viewId, keys: [{ key: "$tally/decision" }] },
        csrf: opened.frameCsrf,
      });
      expect(read.status, read.body).toBe(200);
      const [source] = read.json<{ sources: { revision?: string; value?: Frame[][] }[] }>().sources;
      expect(source?.revision).toBe("300");
      expect(await deserializeAll(source?.value ?? [])).toEqual({ counts: expected, total: 300 });
      expect(JSON.stringify(source)).not.toContain("free text");
      // A page that reads the tally hears each new count on its live channel, with no worker.
      const first = await browser.fetchJson(
        opened.frameOrigin,
        `/_mostra/v/${REVISION}/events/poll?view=${opened.viewId}&wait=0`,
      );
      const cursor = first.json<{ cursor: string }>().cursor;
      const more = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
        body: {
          mutationId: MutationId.create(),
          scope: "viewer",
          baseRevision: revision,
          viewId: opened.viewId,
          ops: [{ id: "decision", value: "drop" }],
        },
        csrf: opened.frameCsrf,
      });
      revision = more.json<{ revision: string }>().revision;
      await browser.fetchJson(opened.link.shell, `${api}/submit`, {
        body: { viewId: opened.viewId, expectedRevision: revision },
        csrf: opened.shellCsrf,
      });
      const poll = await browser.fetchJson(
        opened.frameOrigin,
        `/_mostra/v/${REVISION}/events/poll?view=${opened.viewId}&cursor=${cursor}&wait=2`,
      );
      const pushed = poll
        .json<{ ephemeral?: { kind: string; live?: { key: string; revision: string } }[] }>()
        .ephemeral?.find((message) => message.live?.key === "$tally/decision");
      expect(pushed?.live?.revision).toBe("301");
    } finally {
      await owner.start({ env: ownerEnv(port) });
    }
  }, 240_000);
  it("delivers each hosted submission once, to its owner's own host, and nothing to another instance of the account", async () => {
    // The owner's own host, registered for submissions on the owner instance.
    const host = await connectTo(owner.daemon.status.socket as string);
    ok(
      await host.call(
        "mostra/initialize",
        initializeParams({ client: { name: "my-host", version: "1" }, ports: ["submissions"] }),
      ),
    );
    const delivered: { deliveryId: string; submissionId: string }[] = [];
    let listening = true;
    void (async () => {
      while (listening) {
        const request = await host
          .next((message) => message.method === "port/submissions.deliver", 1000)
          .catch(() => undefined);
        if (!request) continue;
        const params = (request as { params?: unknown }).params as {
          deliveryId: string;
          submissionId: string;
        };
        delivered.push({ deliveryId: params.deliveryId, submissionId: params.submissionId });
        host.sendRaw(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { accepted: true } }),
        );
      }
    })();
    // A second instance of the same account.
    const other = new GatewayHome();
    const otherTrace = join(tempDir("hosted-other"), "binding.ndjson");
    await other.start({ env: { ...ownerEnv(port), MOSTRA_TEST_BINDING_TRACE: otherTrace } });
    try {
      await ownerSignIn(other.client, port, "Ada");
      const links = ok<{ links: { default: boolean }[] }>(
        await other.client.call("remote/status", {}),
      ).links;
      expect(links[0]?.default).toBe(false);

      // An artifact of its own, answered in rounds.
      const dir = join(tempDir("hosted-rounds"), "rounds");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "index.tsx"),
        `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({ title: "Rounds", submission: { policy: "epochs" } });

export default function Page() {
  const [answer, setAnswer] = useField("answer", "");
  return <input value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
`,
      );
      const receipt = ok<{ artifactId: string }>(
        await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
      );
      const url = ok<{ url: string }>(
        await owner.client.call("share/start", {
          artifact: { artifactId: receipt.artifactId },
          via: "remote",
        }),
      ).url;
      const answer = async (value: string): Promise<string> => {
        const browser = new Browser();
        const opened = await openLink(browser, url);
        const fields = await browser.fetchJson(
          opened.frameOrigin,
          `/_mostra/v/${REVISION}/fields`,
          {
            body: {
              mutationId: MutationId.create(),
              scope: "viewer",
              baseRevision: "0",
              viewId: opened.viewId,
              ops: [{ id: "answer", value }],
            },
            csrf: opened.frameCsrf,
          },
        );
        const revision = fields.json<{ revision: string }>().revision;
        const submitted = await browser.fetchJson(
          opened.link.shell,
          `${new URL(url).pathname}/_mostra/v/${REVISION}/submit`,
          { body: { viewId: opened.viewId, expectedRevision: revision }, csrf: opened.shellCsrf },
        );
        expect(submitted.status, submitted.body).toBe(200);
        return submitted.json<{ id: string }>().id;
      };
      const first = await answer("first");
      await eventually(() => delivered.some((entry) => entry.submissionId === first), 20_000);

      // Signing out and in again keeps the instance's link and the artifacts it owns.
      const before = ok<{ links: { instanceId: string }[] }>(
        await owner.client.call("remote/status", {}),
      ).links[0]?.instanceId;
      ok(await owner.client.call("remote/logout", {}));
      const back = await ownerSignIn(owner.client, port, "Ada");
      expect(back.instanceId).toBe(before);
      const second = await answer("second");
      await eventually(() => delivered.some((entry) => entry.submissionId === second), 30_000);

      // Once each, however often the hosted home delivered it.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      for (const id of [first, second]) {
        expect(
          new Set(delivered.filter((entry) => entry.submissionId === id).map((e) => e.deliveryId))
            .size,
        ).toBe(1);
      }
      // The other instance of the account received nothing and imported nothing.
      const events = ok<{ events: unknown[] }>(
        await other.client.call("events/read", { filter: { types: ["submission.*"] } }),
      ).events;
      expect(events).toEqual([]);
      // Nor did the hosted home send it one: an artifact's deliveries go to its owner link only.
      expect(readFileSync(otherTrace, "utf8")).not.toContain("port/submissions.deliver");
    } finally {
      listening = false;
      host.close();
      await other.stop();
    }
  }, 180_000);
});

describe("hosted links across a domain move (D137)", () => {
  it("keeps issued links on their domain and mints new ones on the active one", async () => {
    const port = await freePort();
    const data = tempDir("server-data");
    let server = await startServer({ data, port });
    const owner = new GatewayHome();
    try {
      await owner.start({ env: ownerEnv(port) });
      await ownerSignIn(owner.client, port, "Ada");
      const receipt = await owner.publish("single-tsx", "page.tsx");
      const share = (): Promise<string> =>
        owner.client
          .call("share/start", { artifact: { artifactId: receipt.artifactId }, via: "remote" })
          .then((answer) => ok<{ url: string }>(answer).url);
      const before = await share();
      expect(new URL(before).host).toBe(`content.localhost:${port}`);

      // The operator moves new links to another domain: no release, the old one a spare.
      await stopServer(server);
      server = await startServer({
        data,
        port,
        config: testConfig(port, {
          domains: { active: `fresh.localhost:${port}`, spares: [`content.localhost:${port}`] },
        }),
      });
      await eventually(async () => {
        const links = ok<{ links: { state: string }[] }>(
          await owner.client.call("remote/status", {}),
        ).links;
        return links[0]?.state === "connected";
      }, 30_000);
      // The issued link still opens, on the domain it was minted on.
      const old = await openLink(new Browser(), before);
      expect(old.page.status).toBe(200);
      expect(new URL(old.frameOrigin).host).toMatch(new RegExp(`\\.content\\.localhost:${port}$`));
      // A new link is on the active domain, and opens there.
      const after = await share();
      expect(new URL(after).host).toBe(`fresh.localhost:${port}`);
      const fresh = await openLink(new Browser(), after);
      expect(fresh.page.status).toBe(200);
      expect(new URL(fresh.frameOrigin).host).toMatch(new RegExp(`\\.fresh\\.localhost:${port}$`));
      // A link works only on the domain it was minted on.
      const moved = before.replace(`content.localhost:${port}`, `fresh.localhost:${port}`);
      await expect(openLink(new Browser(), moved)).rejects.toThrow();
    } finally {
      await owner.stop();
      await stopServer(server);
    }
  }, 180_000);
});

describe("one artifact shared to two servers (D165, after the second Opus review)", () => {
  it("hosts it on each, imports each server's answers with their origin, and pushes later publishes to both", async () => {
    const ports = [await freePort(), await freePort()];
    const servers = await Promise.all(
      ports.map((port) => startServer({ data: tempDir("server-data"), port })),
    );
    const owner = new GatewayHome();
    try {
      // A bare address: every server URL keeps its own port.
      await owner.start({ env: { MOSTRA_TEST_SERVER_ADDRESS: "127.0.0.1" } });
      for (const port of ports) await ownerSignIn(owner.client, port, "Ada");
      const receipt = await owner.publish("single-tsx", "page.tsx");
      const urls: string[] = [];
      for (const port of ports) {
        const shared = ok<{ url: string }>(
          await owner.client.call("share/start", {
            artifact: { artifactId: receipt.artifactId },
            via: "remote",
            server: `http://api.localhost:${port}`,
          }),
        );
        urls.push(shared.url);
      }
      expect(urls.map((url) => new URL(url).host)).toEqual(
        ports.map((port) => `content.localhost:${port}`),
      );
      const ids: string[] = [];
      for (const [index, url] of urls.entries()) {
        const browser = new Browser();
        const opened = await openLink(browser, url);
        const fields = await browser.fetchJson(
          opened.frameOrigin,
          `/_mostra/v/${REVISION}/fields`,
          {
            body: {
              mutationId: MutationId.create(),
              scope: "viewer",
              baseRevision: "0",
              viewId: opened.viewId,
              ops: [{ id: "answer", value: `server ${index}` }],
            },
            csrf: opened.frameCsrf,
          },
        );
        expect(fields.status, fields.body).toBe(200);
        const submitted = await browser.fetchJson(
          opened.link.shell,
          `${new URL(url).pathname}/_mostra/v/${REVISION}/submit`,
          {
            body: {
              viewId: opened.viewId,
              expectedRevision: fields.json<{ revision: string }>().revision,
            },
            csrf: opened.shellCsrf,
          },
        );
        expect(submitted.status, submitted.body).toBe(200);
        ids.push(submitted.json<{ id: string }>().id);
      }
      for (const [index, id] of ids.entries()) {
        let results: { answers: unknown; submission: { origin?: { server: string } } } | undefined;
        await eventually(async () => {
          const read = (await owner.client.call("results/get", {
            artifact: { artifactId: receipt.artifactId },
            submission: id,
          })) as {
            result?: { answers: unknown; submission: { origin?: { server: string } } };
          };
          results = read.result;
          return results !== undefined;
        }, 30_000);
        if (!results) throw new Error(`${id} never reached the owner`);
        expect(results.answers).toEqual({ answer: `server ${index}` });
        expect(results.submission.origin?.server).toBe(`http://api.localhost:${ports[index]}`);
      }
      // A later publish reaches both servers: each hosted shell now names version 2 as latest.
      const page = join(receipt.dir, "page.tsx");
      writeFileSync(
        page,
        readFileSync(page, "utf8").replace("Sidebar density", "Sidebar density, again"),
      );
      const republished = ok<{ artifactId: string; version: number }>(
        await owner.client.call("artifact/publish", { source: { path: page } }, 120_000),
      );
      expect(republished).toMatchObject({ artifactId: receipt.artifactId, version: 2 });
      for (const url of urls) {
        await eventually(async () => {
          const browser = new Browser();
          const opened = await openLink(browser, url);
          const ticket = await browser.fetchJson(
            opened.link.shell,
            `${new URL(url).pathname}/_mostra/ticket`,
            { body: {}, csrf: opened.shellCsrf },
          );
          return ticket.json<{ latest?: { number: number } }>().latest?.number === 2;
        }, 30_000);
      }
    } finally {
      await owner.stop();
      for (const server of servers) await stopServer(server);
    }
  }, 240_000);
});
