/**
 * Anonymous answers at volume, with the owner offline (RM-08, D165 item 13; FAILURE_MODEL §11.3):
 * people who aren't signed in answer one hosted poll, each its own anonymous viewer; a burst of
 * them is accepted at once and quickly; past the per-IP and the per-link rate the answer is 429
 * with `Retry-After` and `MOSTRA_REMOTE_RATE_LIMITED`, and the same draft submitted after that wait
 * is accepted, so nothing is dropped; and when the owner returns, every accepted answer reaches it
 * once, in the server's order. (A forged leftmost `X-Forwarded-For` and rotated IPv6 addresses are
 * `clients.test.ts`'s.)
 * The 30-minute run against the container image is `scripts/load-anonymous.ts`.
 */
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, type Opened, openLink } from "../browser-client.ts";
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
import { eventually, tempDir } from "../support.ts";

const REVISION = "2026-10-15";

describe("anonymous answers at volume, the owner offline (RM-08)", () => {
  let port: number;
  let server: RunningServer;
  const owner = new GatewayHome();
  let link: string;
  let artifactId: string;
  const accepted: string[] = [];

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({
      data: tempDir("volume-data"),
      port,
      config: testConfig(port, {
        // The test's browsers connect from loopback: a trusted proxy here, as Caddy is.
        trustedProxies: ["127.0.0.1"],
        rateLimits: {
          perIp: { submissions: { count: 4, per: "4s" } },
          perLink: { submissions: { count: 60, per: "1m" } },
        },
      }),
    });
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    const receipt = await owner.publish("anonymous-poll");
    artifactId = receipt.artifactId;
    link = ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
    ).url;
    // The owner goes offline: everything below is the hosted home's alone.
    await owner.stop();
  }, 180_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  /** A visitor who isn't signed in opens the poll and writes an answer. */
  const visitor = async (
    choice: string,
  ): Promise<{ browser: Browser; opened: Opened; revision: string }> => {
    const browser = new Browser();
    const opened = await openLink(browser, link);
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value: choice }],
      },
      csrf: opened.frameCsrf,
    });
    expect(fields.status, fields.body).toBe(200);
    return { browser, opened, revision: fields.json<{ revision: string }>().revision };
  };

  /** The shell's Submit, through a front that names the visitor's address. */
  const submit = async (
    who: { browser: Browser; opened: Opened; revision: string },
    forwardedFor: string,
  ) => {
    const started = performance.now();
    const answer = await who.browser.ask({
      method: "POST",
      url: `${who.opened.link.shell}/a/${who.opened.link.artifactId}/_mostra/v/${REVISION}/submit`,
      headers: {
        origin: who.opened.link.shell,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-mostra-csrf": who.opened.shellCsrf,
        "x-forwarded-for": forwardedFor,
      },
      body: JSON.stringify({ viewId: who.opened.viewId, expectedRevision: who.revision }),
    });
    return { answer, ms: performance.now() - started };
  };

  it("accepts a burst from many visitors at once, quickly, with the owner offline", async () => {
    const days = ["monday", "tuesday", "wednesday"];
    const visitors = await Promise.all(
      Array.from({ length: 30 }, (_, index) => visitor(days[index % 3] as string)),
    );
    // Thirty submits sent at ten a second, each from its own address.
    const results = await Promise.all(
      visitors.map(async (who, index) => {
        await new Promise((resolve) => setTimeout(resolve, index * 100));
        return submit(who, `198.51.100.${index + 1}`);
      }),
    );
    for (const { answer } of results) {
      expect(answer.status, answer.body).toBe(200);
      accepted.push(answer.json<{ id: string }>().id);
    }
    const latencies = results.map(({ ms }) => ms).sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(500);
  }, 120_000);

  it("answers 429 past the per-IP rate, keeps the draft, and takes it after Retry-After", async () => {
    const one = "203.0.113.7";
    const visitors = await Promise.all(Array.from({ length: 6 }, () => visitor("tuesday")));
    const first = await Promise.all(visitors.map((who) => submit(who, one)));
    const statuses = first.map(({ answer }) => answer.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(4);
    const limited = first.filter(({ answer }) => answer.status === 429);
    expect(limited).toHaveLength(2);
    for (const { answer } of limited) {
      expect(answer.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_RATE_LIMITED");
      expect(Number(answer.header("retry-after"))).toBeGreaterThanOrEqual(1);
    }
    for (const { answer } of first)
      if (answer.status === 200) accepted.push(answer.json<{ id: string }>().id);
    // A recorded answer sent again, while the address is at its rate: the submission it made,
    // never a 429 for an answer that was accepted (Fable review, 8).
    const made = first.findIndex(({ answer }) => answer.status === 200);
    const repeated = await submit(visitors[made] as never, one);
    expect(repeated.answer.status, repeated.answer.body).toBe(200);
    expect(repeated.answer.json<{ id: string; duplicate?: boolean }>()).toMatchObject({
      id: first[made]?.answer.json<{ id: string }>().id,
      duplicate: true,
    });
    // The same drafts, after the wait they were told: accepted, nothing dropped.
    const wait = Math.max(...limited.map(({ answer }) => Number(answer.header("retry-after"))));
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 200));
    for (const [index, { answer }] of first.entries()) {
      if (answer.status !== 429) continue;
      // Each waits as long as it was told; one told the same as another may wait once more.
      for (let attempt = 0; ; attempt++) {
        const again = await submit(visitors[index] as never, one);
        if (again.answer.status === 200) {
          accepted.push(again.answer.json<{ id: string }>().id);
          break;
        }
        expect(again.answer.status, again.answer.body).toBe(429);
        expect(attempt).toBeLessThan(10);
        await new Promise((resolve) =>
          setTimeout(resolve, Number(again.answer.header("retry-after")) * 1000),
        );
      }
    }
  }, 120_000);

  it("answers 429 past the per-link rate, and nothing is dropped", async () => {
    const visitors = await Promise.all(Array.from({ length: 40 }, () => visitor("wednesday")));
    const results = await Promise.all(
      visitors.map((who, index) =>
        submit(who, `100.64.${Math.floor(index / 200)}.${(index % 200) + 1}`),
      ),
    );
    const limited = results.filter(({ answer }) => answer.status === 429);
    // Sixty a minute for the link: about twenty more fit, the rest wait.
    expect(limited.length).toBeGreaterThan(0);
    for (const [index, { answer }] of results.entries()) {
      if (answer.status === 200) {
        accepted.push(answer.json<{ id: string }>().id);
        continue;
      }
      expect(answer.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_RATE_LIMITED");
      // Each tries again after its wait, as the shell's "try again shortly" leads the person to.
      for (let attempt = 0; ; attempt++) {
        const wait = Number(answer.header("retry-after") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 2) * 1000));
        const again = await submit(visitors[index] as never, `100.64.9.${index + 1}`);
        if (again.answer.status === 200) {
          accepted.push(again.answer.json<{ id: string }>().id);
          break;
        }
        expect(again.answer.status).toBe(429);
        expect(attempt).toBeLessThan(60);
      }
    }
  }, 240_000);

  it("delivers every accepted answer to the owner once, in the server's order, when it returns", async () => {
    await owner.start({ env: ownerEnv(port) });
    const imported = async () => {
      const page = ok<{
        events: { payload: { submissionId: string }; origin?: { cursor: string } }[];
      }>(
        await owner.client.call("events/read", {
          filter: { artifacts: [artifactId], types: ["submission.created"] },
          limit: 100,
        }),
      );
      return page.events;
    };
    await eventually(
      async () => (await imported()).length >= accepted.length,
      60_000,
      "every answer delivered",
    );
    const events = await imported();
    const ids = events.map((event) => event.payload.submissionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...accepted].sort());
    // In order: the owner's own log holds them in the order the hosted home made them, which each
    // imported submission's origin records (its hosted cursor).
    const cursors: number[] = [];
    for (const submissionId of ids) {
      const results = ok<{ submission: { origin?: { cursor: string } } }>(
        await owner.client.call("results/get", {
          artifact: { artifactId },
          submission: submissionId,
          format: "json",
        }),
      );
      cursors.push(Number(results.submission.origin?.cursor));
    }
    expect(cursors.every((cursor) => cursor > 0)).toBe(true);
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
  }, 120_000);
});
