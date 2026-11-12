/**
 * Teams on a remote server (WP-31, D168): an owner instance shares a team form to a real
 * `mostra-runtime server` with expected respondents, each getting a personal hosted link; the
 * operator's `invitations` port receives one invitation per respondent with an email, queued by its
 * link's token and never by its URL; respondents answer on hosted pages; the owner's
 * `wait --until submitted:all` answers once the last answer is imported, with every submission
 * there to read; the roster lives on the hosted home (roster/get from the owner forwards there);
 * and `roster.completed` reaches the operator's events (CO-01, CO-02, CO-03, HO-09).
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { control } from "../operator-support.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/artifacts/team", import.meta.url));

const PEOPLE = [
  { ref: "ada@example.com", name: "Ada", email: "ada@example.com" },
  { ref: "grace@example.com", name: "Grace", email: "grace@example.com" },
  { ref: "alan", name: "Alan" },
];

describe("a team form on a remote server (CO-01, CO-02, CO-03)", () => {
  let port: number;
  let controlPort: number;
  let server: RunningServer;
  let data: string;
  const owner = new GatewayHome();
  let operator: ReturnType<typeof control>;

  beforeAll(async () => {
    port = await freePort();
    controlPort = await freePort();
    data = tempDir("team-hosted-data");
    server = await startServer({
      data,
      port,
      config: testConfig(port, { operator: OPERATOR }),
      env: {
        MOSTRA_TEST_OPERATOR_PORT: String(controlPort),
        MOSTRA_TEST_OPERATOR_DISPATCH_MS: "100",
        // The invitations wait in the queue until the test lets them through.
        MOSTRA_TEST_OPERATOR_STATE: JSON.stringify({ invitations: "fail" }),
      },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada Owner");
  }, 120_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  it("names respondents on a hosted share, invites them without queueing a secret, and wakes the owner when the last one answers", async () => {
    const dir = join(tempDir("team-hosted"), "team");
    cpSync(FIXTURE, dir, { recursive: true });
    const { artifactId } = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    );
    const shared = ok<{
      url: string;
      respondents: { ref: string; link: { url: string; tokenId: string } }[];
    }>(
      await owner.client.call(
        "share/start",
        { artifact: { artifactId }, via: "remote", respondents: PEOPLE },
        60_000,
      ),
    );
    expect(shared.respondents.map((entry) => entry.ref)).toEqual(PEOPLE.map((one) => one.ref));
    const shell = new URL(shared.url).origin;
    for (const entry of shared.respondents) expect(new URL(entry.link.url).origin).toBe(shell);

    // The roster is the hosted home's: the owner reads it there.
    const roster = ok<{ counts: { total: number; notOpened: number } }>(
      await owner.client.call("roster/get", { artifact: { artifactId } }),
    );
    expect(roster.counts).toMatchObject({ total: 3, notOpened: 3 });

    // A respondent the owner's own `roster/add` names is forwarded there too, and their hosted
    // link's secret is protected here as the share's are (Opus review 3): a durable event of this
    // home that names it keeps none of it, even without the `#t=` that marks it in a URL.
    const more = ok<{ links: { ref: string; link: { url: string } }[] }>(
      await owner.client.call("roster/add", {
        artifact: { artifactId },
        respondents: [{ ref: "barbara", name: "Barbara" }],
      }),
    );
    const barbara = more.links.find((entry) => entry.ref === "barbara")?.link.url ?? "";
    expect(barbara.startsWith(shell)).toBe(true);
    const secret = new URL(barbara).hash.slice("#t=".length);
    expect(secret.length).toBeGreaterThan(20);
    const notesDir = join(tempDir("team-hosted-notes"), "notes");
    cpSync(FIXTURE, notesDir, { recursive: true });
    const notes = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: notesDir } }, 120_000),
    );
    ok(
      await owner.client.call("state/patch", {
        artifact: { artifactId: notes.artifactId },
        ops: [{ id: "actions", value: `Barbara's link: ${barbara}, its secret ${secret}` }],
        mutationId: MutationId.create(),
      }),
    );
    const changed = ok<{ events: unknown[] }>(
      await owner.client.call("events/read", {
        filter: { artifacts: [notes.artifactId], types: ["state.changed"] },
      }),
    );
    expect(changed.events).toHaveLength(1);
    expect(JSON.stringify(changed.events)).not.toContain(secret);
    // The operator's `limits` was asked for the links each call mints (Opus review 10): three for
    // the share's respondents, one for Barbara, and nothing for respondents whose links are kept.
    const linkQuantities = async () =>
      (await operator.calls("limits"))
        .map((call) => call.payload)
        .filter((query) => query["operation"] === "link" && query["quantity"] !== undefined)
        .map((query) => query["quantity"]);
    expect(await linkQuantities()).toEqual([3, 1]);
    ok(
      await owner.client.call("roster/add", {
        artifact: { artifactId },
        respondents: [...PEOPLE, { ref: "barbara", name: "Barbara Liskov" }],
      }),
    );
    expect(await linkQuantities()).toEqual([3, 1]);
    ok(await owner.client.call("roster/remove", { artifact: { artifactId }, refs: ["barbara"] }));

    // Two invitations wait (Alan has no email), each by its link's token: no URL, no secret.
    await eventually(async () => (await operator.calls("invitations.attempt")).length >= 2);
    const directory = new Database(join(data, "server.sqlite"), { readonly: true });
    try {
      const rows = directory
        .prepare("SELECT id, payload_json FROM outbound WHERE port = 'invitations'")
        .all() as { id: string; payload_json: string }[];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.payload_json).not.toContain("#t=");
        for (const entry of shared.respondents) {
          const secret = new URL(entry.link.url).hash.slice("#t=".length);
          expect(row.payload_json).not.toContain(secret);
        }
      }
    } finally {
      directory.close();
    }
    // Let them through: each carries its respondent's own link, built at delivery.
    await operator.set({ invitations: "ok" });
    await eventually(async () => (await operator.calls("invitations")).length === 2);
    const invitations = (await operator.calls("invitations")).map((call) => call.payload);
    expect(invitations.map((one) => (one["respondent"] as { email: string }).email).sort()).toEqual(
      ["ada@example.com", "grace@example.com"],
    );
    for (const invitation of invitations) {
      const ref = (invitation["respondent"] as { ref: string }).ref;
      const link = shared.respondents.find((entry) => entry.ref === ref)?.link;
      expect(invitation["url"]).toBe(link?.url);
      expect(String(invitation["invitationId"]).endsWith(`:${link?.tokenId}`)).toBe(true);
      expect(invitation["title"]).toBe("Retro");
      expect((invitation["sender"] as { name?: string }).name).toBe("Ada Owner");
    }

    // The owner waits for everyone; each respondent answers on the hosted page.
    const waiting = owner.client.call(
      "wait",
      { artifact: { artifactId }, until: "submitted:all", timeoutMs: 90_000 },
      100_000,
    );
    let woke = false;
    void waiting.then(() => {
      woke = true;
    });
    for (const [index, entry] of shared.respondents.entries()) {
      const browser = new Browser();
      const opened = await openLink(browser, entry.link.url);
      const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
        body: {
          mutationId: MutationId.create(),
          scope: "viewer",
          baseRevision: "0",
          viewId: opened.viewId,
          ops: [{ id: "went", value: `answer ${index}` }],
        },
        csrf: opened.frameCsrf,
      });
      expect(fields.status, fields.body).toBe(200);
      const api = `${new URL(entry.link.url).pathname}/_mostra`;
      const submitted = await browser.fetchJson(opened.link.shell, `${api}/v/${REVISION}/submit`, {
        body: {
          viewId: opened.viewId,
          expectedRevision: fields.json<{ revision: string }>().revision,
        },
        csrf: opened.shellCsrf,
      });
      expect(submitted.status, submitted.body).toBe(200);
      if (index < shared.respondents.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(woke).toBe(false);
      }
    }
    const done = ok<{ status: string; event: { type: string } }>(await waiting);
    expect(done.status).toBe("satisfied");
    expect(done.event.type).toBe("roster.completed");
    // Every answer the completion counts is in the owner's own ledger.
    const listed = ok<{ results: { answers: { went?: string } }[] }>(
      await owner.client.call("results/list", { artifact: { artifactId } }),
    );
    expect(listed.results.map((one) => one.answers.went).sort()).toEqual([
      "answer 0",
      "answer 1",
      "answer 2",
    ]);
    // The operator hears the completion, with each respondent's submission.
    await eventually(async () =>
      (await operator.calls("events")).some((call) => call.payload["kind"] === "roster.completed"),
    );
    const completed = (await operator.calls("events")).find(
      (call) => call.payload["kind"] === "roster.completed",
    );
    const payload = completed?.payload["payload"] as { submissions?: unknown[] } | undefined;
    expect(payload?.submissions).toHaveLength(3);
  }, 240_000);
});
