/**
 * The interaction ledger through a real `mostra-runtime daemon` (WP-06): a page's mutations,
 * signals and submits over the browser protocol; hosts over the host protocol (`state/*`,
 * `results/get`, `wait`, `events/*`); deliveries to a host's submissions port while it is down,
 * after it returns, and after a crash between its answer and Mostra's record (IN-01, IN-05 to
 * IN-12, LL-01, LL-02).
 */
import { appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { BROWSER_PROTOCOL_REVISION, MutationId, Results } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import {
  connectTo,
  eventually,
  initializeParams,
  type LineClient,
  type Message,
} from "../support.ts";

const V = BROWSER_PROTOCOL_REVISION;

/** A page in a frame: posts to its own origin with its session's CSRF token. */
class Page {
  readonly browser: Browser;
  readonly opened: Opened;

  constructor(browser: Browser, opened: Opened) {
    this.browser = browser;
    this.opened = opened;
  }

  post(path: string, body: unknown): Promise<Answer> {
    return this.browser.fetchJson(this.opened.frameOrigin, `/_mostra/v/${V}/${path}`, {
      body,
      csrf: this.opened.frameCsrf,
    });
  }

  fields(
    ops: unknown[],
    baseRevision: string,
    scope: "viewer" | "artifact" = "viewer",
    mutationId = MutationId.create(),
  ) {
    return this.post("fields", {
      mutationId,
      scope,
      baseRevision,
      viewId: this.opened.viewId,
      ops,
    });
  }

  submit(expectedRevision: string): Promise<Answer> {
    return this.post("submit", {
      viewId: this.opened.viewId,
      expectedRevision,
      channel: "artifact",
    });
  }

  signal(name: string, payload?: unknown): Promise<Answer> {
    return this.post("signal", {
      viewId: this.opened.viewId,
      name,
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  poll(cursor?: string, wait = 0): Promise<Answer> {
    const query = `view=${this.opened.viewId}&wait=${wait}${cursor !== undefined ? `&cursor=${cursor}` : ""}`;
    return this.browser.fetchJson(this.opened.frameOrigin, `/_mostra/v/${V}/events/poll?${query}`);
  }
}

async function page(url: string): Promise<Page> {
  const browser = new Browser();
  return new Page(browser, await openLink(browser, url));
}

/** A host on its own connection: registers ports and answers port calls as told. */
class Host {
  readonly client: LineClient;

  constructor(client: LineClient) {
    this.client = client;
  }

  static async connect(
    gateway: GatewayHome,
    name: string,
    options: { ports?: string[]; expect?: string[]; notifications?: string[] } = {},
  ): Promise<Host> {
    const client = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await client.call(
        "mostra/initialize",
        initializeParams({
          client: { name, version: "1" },
          ports: options.ports ?? [],
          capabilities: { notifications: options.notifications ?? [] },
          ...(options.expect ? { home: { ports: options.expect } } : {}),
        }),
      ),
    );
    return new Host(client);
  }

  /** The next port call of `method`. */
  next(method: string, timeoutMs = 15_000): Promise<Message & { params: Record<string, unknown> }> {
    return this.client.next((message) => message.method === method, timeoutMs) as Promise<
      Message & { params: Record<string, unknown> }
    >;
  }

  answer(message: Message, result: unknown): void {
    this.client.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  }
}

/** Reads an SSE stream until `count` messages arrived; returns them and closes the request. */
function readStream(
  browser: Browser,
  url: string,
  count: number,
  headers: Record<string, string> = {},
): Promise<{ id?: string; event?: string; data?: unknown }[]> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const messages: { id?: string; event?: string; data?: unknown }[] = [];
    let buffer = "";
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          cookie: browser.cookiesFor(url),
          accept: "text/event-stream",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          ...headers,
        },
        agent: false,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`stream answered ${res.statusCode}`));
          return;
        }
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let end = buffer.indexOf("\n\n");
          while (end >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf("\n\n");
            const message: { id?: string; event?: string; data?: unknown } = {};
            for (const line of block.split("\n")) {
              if (line.startsWith("id: ")) message.id = line.slice(4);
              else if (line.startsWith("event: ")) message.event = line.slice(7);
              else if (line.startsWith("data: ")) message.data = JSON.parse(line.slice(6));
            }
            if (message.event !== undefined) messages.push(message);
            if (messages.length >= count) {
              req.destroy();
              resolve(messages);
              return;
            }
          }
        });
      },
    );
    req.on("error", (error) => {
      if (messages.length < count) reject(error);
    });
    req.setTimeout(20_000, () => req.destroy(new Error("stream timed out")));
    req.end();
  });
}

const ENTRIES: Readonly<Record<string, string>> = {
  "single-tsx": "page.tsx",
  "single-mdx": "page.mdx",
};

/** Publishes a fixture; with a policy, publishes its source again under that policy (D102). */
async function publish(
  gateway: GatewayHome,
  fixture: string,
  policy?: unknown,
): Promise<Receipt & { dir: string; entry: string }> {
  const name = ENTRIES[fixture] ?? "";
  const receipt = await gateway.publish(fixture, name);
  const entry = join(receipt.dir, name);
  if (policy === undefined) return { ...receipt, entry };
  const again = ok<Receipt>(
    await gateway.client.call("artifact/publish", { source: { path: entry }, policy }, 120_000),
  );
  return { ...again, dir: receipt.dir, entry };
}

describe("drafts, state and conflicts through the gateway and the protocol (IN-01, LL-01)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string; entry: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await publish(gateway, "single-tsx", { policy: "none" });
  }, 180_000);
  afterAll(() => gateway.stop());

  it("saves a draft with compare-and-set, replays a mutation ID and surfaces a stale base as a per-field conflict", async () => {
    const tab = await page(receipt.url);
    const id = MutationId.create();
    const first = await tab.fields(
      [
        { id: "q.layout", value: "b" },
        { id: "notes", value: "hi" },
      ],
      "0",
      "viewer",
      id,
    );
    expect(first.status).toBe(200);
    expect(first.json()).toEqual({ revision: "1", applied: ["q.layout", "notes"], conflicts: [] });
    // A retry after a timeout replays the result and changes nothing.
    expect(
      (
        await tab.fields(
          [
            { id: "q.layout", value: "b" },
            { id: "notes", value: "hi" },
          ],
          "0",
          "viewer",
          id,
        )
      ).json(),
    ).toEqual(first.json());
    // A second tab of the same viewer edits from revision 1; the first, still at 0, conflicts on notes only.
    const second = new Page(tab.browser, await openLink(tab.browser, receipt.url));
    expect((await second.fields([{ id: "notes", value: "theirs" }], "1")).json()).toMatchObject({
      revision: "2",
      conflicts: [],
    });
    const stale = (
      await tab.fields(
        [
          { id: "notes", value: "mine" },
          { id: "extra", value: 1 },
        ],
        "1",
      )
    ).json<{
      revision: string;
      applied: string[];
      conflicts: { id: string; value: unknown }[];
    }>();
    expect(stale.applied).toEqual(["extra"]);
    expect(stale.conflicts).toEqual([
      expect.objectContaining({ id: "notes", value: "theirs", revision: "2" }),
    ]);
    // The wrong contents under a used mutation ID are refused.
    const reused = await tab.fields([{ id: "q.layout", value: "z" }], "0", "viewer", id);
    expect(reused.status).toBe(409);
    expect(reused.json<{ code: string }>().code).toBe("MOSTRA_FIELD_MUTATION_ID_REUSED");
  });

  it("makes an agent's and a viewer's overlapping writes of one artifact field a conflict on both sides, and lets a host filter state.changed", async () => {
    const host = await Host.connect(gateway, "dashboard-host", {
      notifications: ["events/notify"],
    });
    const subscription = ok<{ subscriptionId: string }>(
      await host.client.call("events/subscribe", {
        filter: { artifacts: [receipt.artifactId], types: ["state.changed"] },
      }),
    );
    const viewer = await page(receipt.url);
    const artifact = { artifactId: receipt.artifactId };
    const start = ok<{ revision: string }>(
      await gateway.client.call("state/patch", {
        artifact,
        mutationId: MutationId.create(),
        ops: [{ id: "tasks.today", value: ["write"] }],
      }),
    );
    // Both read revision `start`; the agent writes first.
    const agentWrite = ok<{ conflicts: unknown[] }>(
      await gateway.client.call("state/patch", {
        artifact,
        mutationId: MutationId.create(),
        baseRevision: start.revision,
        ops: [{ id: "tasks.today", value: ["write", "ship"] }],
      }),
    );
    expect(agentWrite.conflicts).toEqual([]);
    const viewerWrite = (
      await viewer.fields(
        [{ id: "tasks.today", value: ["write", "review"] }],
        start.revision,
        "artifact",
      )
    ).json<{
      conflicts: { id: string; value: unknown; updatedBy: { kind: string } }[];
    }>();
    expect(viewerWrite.conflicts).toEqual([
      expect.objectContaining({
        id: "tasks.today",
        value: ["write", "ship"],
        updatedBy: expect.objectContaining({ kind: "agent" }),
      }),
    ]);
    // The viewer keeps theirs (a new write on the current revision); the agent's stale write now conflicts.
    const state = ok<{ revision: string; fields: Record<string, { value: unknown }> }>(
      await gateway.client.call("state/get", { artifact }),
    );
    expect(
      (
        await viewer.fields(
          [{ id: "tasks.today", value: ["write", "review"] }],
          state.revision,
          "artifact",
        )
      ).json(),
    ).toMatchObject({ conflicts: [] });
    const agentAgain = ok<{ conflicts: { id: string; updatedBy: { kind: string } }[] }>(
      await gateway.client.call("state/patch", {
        artifact,
        mutationId: MutationId.create(),
        baseRevision: state.revision,
        ops: [{ id: "tasks.today", value: ["agent"] }],
      }),
    );
    expect(agentAgain.conflicts).toEqual([
      expect.objectContaining({
        id: "tasks.today",
        updatedBy: expect.objectContaining({ kind: "viewer" }),
      }),
    ]);
    // The host's filtered subscription saw every state.changed and nothing else.
    const seen: { type: string }[] = [];
    await eventually(async () => {
      for (;;) {
        const note = await host.client
          .next((message) => message.method === "events/notify", 200)
          .catch(() => undefined);
        if (!note) break;
        seen.push(...(note as unknown as { params: { events: { type: string }[] } }).params.events);
      }
      return seen.length >= 3;
    });
    expect(seen.every((event) => event.type === "state.changed")).toBe(true);
    expect(seen).toHaveLength(3);
    ok(
      await host.client.call("events/ack", {
        subscriptionId: subscription.subscriptionId,
        cursor: "0",
      }),
    );
    host.client.close();
  });

  it("refuses submit under policy none, while state and signals work (LL-02)", async () => {
    const viewer = await page(receipt.url);
    const refusedSubmit = await viewer.submit("0");
    expect(refusedSubmit.status).toBe(409);
    expect(refusedSubmit.json<{ code: string }>().code).toBe("MOSTRA_SUBMIT_POLICY_NONE");
    const signal = await viewer.signal("ping-agent", { note: "look" });
    expect(signal.status).toBe(200);
    const read = ok<{ events: { type: string; payload: Record<string, unknown> }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [receipt.artifactId], types: ["signal.raised"] },
      }),
    );
    expect(read.events.at(-1)).toMatchObject({
      payload: { name: "ping-agent", source: "artifact", payload: { note: "look" } },
    });
    expect(
      refused(
        await gateway.client.call("wait", {
          artifact: { artifactId: receipt.artifactId },
          until: "submitted",
          timeoutMs: 0,
        }),
      ),
    ).toBe("MOSTRA_SUBMIT_POLICY_NONE");
  });

  it("streams a page's snapshot and then its events, resumes from Last-Event-ID, and never shows another viewer's draft", async () => {
    const ana = await page(
      ok<{ url: string }>(
        await gateway.client.call("view/url", {
          artifact: { artifactId: receipt.artifactId },
          viewer: { ref: "ana", name: "Ana" },
        }),
      ).url,
    );
    const ben = await page(
      ok<{ url: string }>(
        await gateway.client.call("view/url", {
          artifact: { artifactId: receipt.artifactId },
          viewer: { ref: "ben" },
        }),
      ).url,
    );
    const url = `${ana.opened.frameOrigin}/_mostra/v/${V}/events?view=${ana.opened.viewId}`;
    const reading = readStream(ana.browser, url, 3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await ben.fields([{ id: "secret.answer", value: "bens-private-draft" }], "0");
    await ana.fields([{ id: "mine", value: "anas" }], "0");
    await ana.signal("hello");
    const messages = await reading;
    expect(messages[0]?.event).toBe("snapshot");
    expect(messages[0]?.data).toMatchObject({
      viewer: { name: "Ana", kind: "token" },
      draft: { revision: "0" },
    });
    expect(messages.slice(1).map((message) => (message.data as { type: string }).type)).toEqual([
      "draft.changed",
      "signal.raised",
    ]);
    expect(JSON.stringify(messages)).not.toContain("bens-private-draft");
    // Resume after the first event: the next one is the signal.
    const resumed = await readStream(ana.browser, url, 1, {
      "last-event-id": messages[1]?.id as string,
    });
    expect(resumed[0]?.data).toMatchObject({ type: "signal.raised" });
    // An EventSource that opened at a cursor reconnects to the same URL with Last-Event-ID: the
    // newer of the two wins, so nothing repeats (Claude review finding 3).
    const reconnected = await readStream(ana.browser, `${url}&cursor=${messages[0]?.id}`, 1, {
      "last-event-id": messages[1]?.id as string,
    });
    expect(reconnected[0]?.id).toBe(messages[2]?.id);
    expect(reconnected[0]?.data).toMatchObject({ type: "signal.raised" });
    // A large backlog arrives whole and in order through the pull-based stream (finding 6).
    const before = messages[2]?.id as string;
    const big = "x".repeat(256 * 1024);
    for (let index = 0; index < 24; index++) {
      ok(
        await gateway.client.call("state/patch", {
          artifact: { artifactId: receipt.artifactId },
          mutationId: MutationId.create(),
          ops: [{ id: `big.${index}`, value: big }],
        }),
      );
    }
    const backlog = await readStream(ana.browser, `${url}&cursor=${before}`, 24);
    const ids = backlog.map((message) => Number(message.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(24);
    expect(
      backlog.every((message) => (message.data as { type: string }).type === "state.changed"),
    ).toBe(true);
    // Long-poll on the same cursor (D47).
    const polled = (await ana.poll(messages[1]?.id, 0)).json<{ events: { type: string }[] }>();
    expect(polled.events[0]?.type).toBe("signal.raised");
  });
});

describe("a long poll after its link died (GPT review finding 1)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string; entry: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await publish(gateway, "single-tsx", { policy: "none" });
  }, 180_000);
  afterAll(() => gateway.stop());

  it("answers 410 and none of what was written after the link was revoked", async () => {
    const link = ok<{ url: string; tokenId: string }>(
      await gateway.client.call("view/url", { artifact: { artifactId: receipt.artifactId } }),
    );
    const viewer = await page(link.url);
    const snapshot = (await viewer.poll()).json<{ cursor: string }>();
    const waiting = viewer.poll(snapshot.cursor, 10);
    await new Promise((resolve) => setTimeout(resolve, 200));
    ok(await gateway.client.call("view/revoke", { tokenId: link.tokenId }));
    ok(
      await gateway.client.call("state/patch", {
        artifact: { artifactId: receipt.artifactId },
        mutationId: MutationId.create(),
        ops: [{ id: "private", value: "after-revocation" }],
      }),
    );
    const answer = await waiting;
    expect(answer.status).toBe(410);
    expect(answer.body).not.toContain("after-revocation");
  });
});

describe("submissions, wait and results through the protocol (IN-05, IN-07, IN-09, IN-10, IN-11)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string; entry: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await publish(gateway, "single-tsx");
  }, 180_000);
  afterAll(() => gateway.stop());

  it("waits with still_waiting on timeout, then returns the submission made since from its cursor, as complete results in JSON and Markdown", async () => {
    const artifact = { artifactId: receipt.artifactId };
    const timedOut = ok<{ status: string; cursor: string }>(
      await gateway.client.call("wait", { artifact, until: "submitted", timeoutMs: 100 }),
    );
    expect(timedOut.status).toBe("still_waiting");
    const viewer = await page(receipt.url);
    await viewer.fields(
      [{ id: "reply.m1", value: "Thursday works", label: "Reply to Alice" }],
      "0",
    );
    // A wait in progress is satisfied by the commit, not a poll.
    const waiting = gateway.client.call("wait", {
      artifact,
      until: "submitted",
      after: timedOut.cursor,
      timeoutMs: 30_000,
    });
    const submitted = await viewer.submit("1");
    expect(submitted.status).toBe(200);
    const summary = submitted.json<{
      id: string;
      versionId: string;
      viewId: string;
      staleView: boolean;
    }>();
    expect(summary).toMatchObject({
      versionId: receipt.versionId,
      viewId: viewer.opened.viewId,
      staleView: false,
    });
    expect(
      ok<{ status: string; event: { payload: { submissionId: string } } }>(await waiting),
    ).toMatchObject({
      status: "satisfied",
      event: { payload: { submissionId: summary.id } },
    });
    // Level-triggered under once: a wait from any later cursor is satisfied at once (D103).
    expect(
      ok<{ status: string }>(
        await gateway.client.call("wait", {
          artifact,
          until: "submitted",
          timeoutMs: 0,
          after: "999999",
        }),
      ).status,
    ).toBe("satisfied");
    // The submit is the standard signal.
    expect(
      ok<{ status: string }>(
        await gateway.client.call("wait", {
          artifact,
          until: "signal:submit",
          after: timedOut.cursor,
          timeoutMs: 0,
        }),
      ).status,
    ).toBe("satisfied");
    const results = ok<Results>(await gateway.client.call("results/get", { artifact }));
    expect(Results.safeParse(results).success).toBe(true);
    expect(results).toMatchObject({
      artifact: { id: receipt.artifactId },
      submission: {
        id: summary.id,
        versionId: receipt.versionId,
        version: receipt.version,
        channel: "artifact",
        policy: { policy: "once", scope: "per-artifact" },
      },
      answers: { reply: { m1: "Thursday works" } },
    });
    const markdown = ok<{ markdown: string }>(
      await gateway.client.call("results/get", { artifact, format: "md" }),
    ).markdown;
    expect(markdown).toContain(`submission ${summary.id}`);
    expect(markdown).toContain('- "Reply to Alice" (`reply.m1`): "Thursday works"');
    // A second submit from another tab is the typed conflict carrying the first (H-02).
    const tab = await page(receipt.url);
    const again = await tab.submit("1");
    expect(again.status).toBe(409);
    expect(again.json<{ code: string; submission: { id: string } }>()).toMatchObject({
      code: "MOSTRA_SUBMIT_ALREADY",
      submission: { id: summary.id },
    });
    // The same submit repeated returns the original.
    expect((await viewer.submit("1")).json()).toMatchObject({ id: summary.id, duplicate: true });
  });

  it("gives each viewer of a once per-viewer artifact one submission, and flags a stale view (D104, H-10)", async () => {
    const survey = await publish(gateway, "single-mdx", { policy: "once", scope: "per-viewer" });
    const link = async (ref: string) =>
      ok<{ url: string }>(
        await gateway.client.call("view/url", {
          artifact: { artifactId: survey.artifactId },
          version: 1,
          viewer: { ref },
        }),
      ).url;
    const ana = await page(await link("ana"));
    const ben = await page(await link("ben"));
    expect((await ana.submit("0")).status).toBe(200);
    expect((await ben.submit("0")).status).toBe(200);
    expect((await (await page(await link("ana"))).submit("0")).status).toBe(409);
    const results = ok<Results>(
      await gateway.client.call("results/get", { artifact: { artifactId: survey.artifactId } }),
    );
    expect(results.submission.viewer).toMatchObject({ kind: "token", ref: "ben" });
    // A newer version is published while Cy still has version 1 open: Cy's submission names
    // version 1 and says it was stale (H-10).
    const cy = await page(await link("cy"));
    appendFileSync(survey.entry, "\nA second version.\n");
    const v2 = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: survey.entry } }, 120_000),
    );
    expect(v2.version).toBe(2);
    const stale = (await cy.submit("0")).json<{
      id: string;
      version: number;
      staleView: boolean;
    }>();
    expect(stale).toMatchObject({ version: 1, staleView: true });
    const staleResults = ok<Results>(
      await gateway.client.call("results/get", {
        artifact: { artifactId: survey.artifactId },
        submission: stale.id,
      }),
    );
    expect(staleResults.submission).toMatchObject({
      version: 1,
      staleView: true,
      latestVersion: 2,
    });
  });
});

describe("delivery to a host's submissions port (IN-12, IN-06, H-04)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string; entry: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await publish(gateway, "single-tsx", { policy: "epochs" });
  }, 180_000);
  afterAll(() => gateway.stop());

  it("keeps submissions made while the host is down durable and pending, replays them in order when it returns, and never retries a terminal answer", async () => {
    // The host registers once, says it always provides the port, and goes away.
    const first = await Host.connect(gateway, "jcode-like", {
      ports: ["submissions"],
      expect: ["submissions"],
    });
    first.client.close();
    await first.client.closed;
    const viewer = await page(receipt.url);
    const made: string[] = [];
    for (let round = 1; round <= 3; round++) {
      await viewer.fields([{ id: "round", value: round }], String(round - 1));
      const submitted = await viewer.submit(String(round));
      expect(submitted.status).toBe(200);
      made.push(submitted.json<{ id: string; delivery: string }>().id);
    }
    const status = ok<{ deliveries: { owner: string; pending: number; connected: boolean }[] }>(
      await gateway.client.call("instance/status", {}),
    );
    expect(status.deliveries).toEqual([
      expect.objectContaining({ owner: "jcode-like", pending: 3, connected: false }),
    ]);
    expect(
      ok<Results>(
        await gateway.client.call("results/get", { artifact: { artifactId: receipt.artifactId } }),
      ).submission.delivery,
    ).toBe("pending");
    // The host returns: the three arrive in submission order, one at a time.
    const host = await Host.connect(gateway, "jcode-like", { ports: ["submissions"] });
    const delivered: string[] = [];
    for (let index = 0; index < 3; index++) {
      const call = await host.next("port/submissions.deliver");
      expect(call.params).toMatchObject({ kind: "submission", attempt: 1 });
      delivered.push(call.params["submissionId"] as string);
      host.answer(
        call,
        index === 2
          ? { accepted: false, reason: "undeliverable", retry: false }
          : { accepted: true },
      );
    }
    expect(delivered).toEqual(made);
    await eventually(async () => {
      const counts = ok<{ deliveries: { delivered: number; undeliverable: number }[] }>(
        await gateway.client.call("instance/status", {}),
      ).deliveries[0];
      return counts?.delivered === 2 && counts.undeliverable === 1;
    });
    // A terminal answer is never retried.
    await expect(host.next("port/submissions.deliver", 2500)).rejects.toThrow();
    const last = ok<Results>(
      await gateway.client.call("results/get", {
        artifact: { artifactId: receipt.artifactId },
        submission: made[2],
      }),
    );
    expect(last.submission.deliveries).toEqual([
      expect.objectContaining({
        owner: "jcode-like",
        state: "undeliverable",
        reason: "undeliverable",
      }),
    ]);
    host.client.close();
  });

  it("redelivers with the same deliveryId after a crash between the host's answer and Mostra's record", async () => {
    await gateway.stop();
    await gateway.start({ env: { MOSTRA_TEST_FAULTS: "deliver:after-answer:crash" } });
    const host = await Host.connect(gateway, "crash-host", {
      ports: ["submissions"],
      expect: ["submissions"],
    });
    const viewer = await page(receipt.url);
    const snapshot = (await viewer.poll()).json<{ snapshot: { draft: { revision: string } } }>()
      .snapshot;
    await viewer.submit(snapshot.draft.revision);
    const first = await host.next("port/submissions.deliver");
    host.answer(first, { accepted: true });
    // The supervisor dies after the answer arrives and before it records it.
    const exited = await gateway.daemon.exited;
    expect(exited.signal).toBe("SIGKILL");
    await gateway.start();
    const again = await Host.connect(gateway, "crash-host", { ports: ["submissions"] });
    const second = await again.next("port/submissions.deliver");
    expect(second.params["deliveryId"]).toBe(first.params["deliveryId"]);
    expect(second.params["submissionId"]).toBe(first.params["submissionId"]);
    expect(second.params["attempt"]).toBe(2);
    again.answer(second, { accepted: false, reason: "duplicate", retry: false });
    await eventually(async () =>
      ok<{ deliveries: { owner: string; delivered: number }[] }>(
        await gateway.client.call("instance/status", {}),
      ).deliveries.some((entry) => entry.owner === "crash-host" && entry.delivered === 1),
    );
    again.client.close();
    host.client.close();
  });

  it("resumes a named subscription after a restart from its acknowledged cursor, without gaps", async () => {
    // Enough events of its own, whatever ran before it.
    for (let index = 0; index < 6; index++) {
      ok(
        await gateway.client.call("state/patch", {
          artifact: { artifactId: receipt.artifactId },
          mutationId: MutationId.create(),
          ops: [{ id: "counter", value: index }],
        }),
      );
    }
    const host = await Host.connect(gateway, "events-host", { notifications: ["events/notify"] });
    const sub = ok<{ subscriptionId: string; cursor: string }>(
      await host.client.call("events/subscribe", {
        name: "events-host",
        after: "0",
        filter: { artifacts: [receipt.artifactId] },
      }),
    );
    const note = (await host.next("events/notify")) as unknown as {
      params: { events: { cursor: string }[]; cursor: string };
    };
    const firstCursors = note.params.events.map((event) => event.cursor);
    const acked = firstCursors[2] as string;
    ok(await host.client.call("events/ack", { subscriptionId: sub.subscriptionId, cursor: acked }));
    host.client.close();
    await gateway.stop();
    await gateway.start();
    const back = await Host.connect(gateway, "events-host", { notifications: ["events/notify"] });
    ok(
      await back.client.call("events/subscribe", {
        name: "events-host",
        filter: { artifacts: [receipt.artifactId] },
      }),
    );
    const resumed = (await back.next("events/notify")) as unknown as {
      params: { events: { cursor: string }[] };
    };
    expect(resumed.params.events[0]?.cursor).toBe(firstCursors[3]);
    const all = ok<{ events: { cursor: string }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [receipt.artifactId] },
        limit: 1000,
      }),
    );
    expect(resumed.params.events.map((event) => event.cursor)).toEqual(
      all.events
        .map((event) => event.cursor)
        .filter((cursor) => Number(cursor) > Number(acked))
        .slice(0, resumed.params.events.length),
    );
    back.client.close();
  });
});

describe("a host that never answers (FAILURE_MODEL §4, §9)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string; entry: string };

  beforeAll(async () => {
    // The 30 s port-call limit, shortened so the test sees it pass.
    await gateway.start({ env: { MOSTRA_TEST_PORT_TIMEOUT_MS: "500" } });
    receipt = await publish(gateway, "single-tsx");
  }, 180_000);
  afterAll(() => gateway.stop());

  it("counts a port call past its time limit as a retryable failure and delivers the same delivery again", async () => {
    const host = await Host.connect(gateway, "slow-host", { ports: ["submissions"] });
    const viewer = await page(receipt.url);
    expect((await viewer.submit("0")).status).toBe(200);
    const ignored = await host.next("port/submissions.deliver");
    // No answer: after the limit and the first backoff, the same delivery comes again.
    const retried = await host.next("port/submissions.deliver", 10_000);
    expect(retried.params["deliveryId"]).toBe(ignored.params["deliveryId"]);
    expect(retried.params["attempt"]).toBe(2);
    host.answer(retried, { accepted: true });
    await eventually(async () =>
      ok<{ deliveries: { owner: string; delivered: number }[] }>(
        await gateway.client.call("instance/status", {}),
      ).deliveries.some((entry) => entry.owner === "slow-host" && entry.delivered === 1),
    );
    host.client.close();
  });
});
