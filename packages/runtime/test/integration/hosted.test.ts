/**
 * Hosted pages and their answers (WP-29, RM-02; INTERFACES §18.2, §18.4; D165 items 1, 1a, 7,
 * 8): an owner instance shares a published version to a real `mostra-runtime server`
 * (`share/start { via: "remote" }`); a browser opens the hosted link on the user-content domain's
 * apex, with no cookie anywhere and its session in a header, its frame on the route's own label
 * in worker mode; it answers and submits; the respondent learns only that the answer was sent;
 * the owner instance receives the submission through its outbox, its `wait` returns and its
 * `results` hold the answer with where it came from.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
} from "../server-support.ts";
import { tempDir } from "../support.ts";

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
});
