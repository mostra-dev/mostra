/**
 * The review layer through the real daemon and gateway (WP-20; RV-02, RV-05, HO-11, CO-06): a
 * host's `capture` port supplies the crop a comment stores and its `reviews` port mirrors each
 * thread; the shell's review routes start, resolve and reopen threads; each page sees only the
 * threads it may; a mention raises one host-only event naming the mentioned viewer; and
 * `review/export` writes Markdown and JSON whose crop paths exist.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BROWSER_PROTOCOL_REVISION,
  CommentId,
  portCaptureScreenshotMethod,
  portReviewsMirrorMethod,
  ThreadId,
} from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { connectTo, initializeParams, type LineClient, type Message, tempDir } from "../support.ts";

/** A 2×1 PNG: one blue pixel, one red. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNQ2f+fgYGBAQAJ7AJ7ZbB2WAAAAABJRU5ErkJggg==";

/** A message from the instance, its params read. */
type Call = Message & { readonly params?: unknown };

const answer = (client: LineClient, message: Message, result: unknown): void =>
  client.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));

interface PageThreads {
  readonly threads: { id: string; crop: { state: string } }[];
  readonly people: { key: string; name?: string; self?: boolean }[];
}

/** One page of the artifact, as its shell calls the review routes. */
class Page {
  readonly browser: Browser;
  readonly opened: Opened;

  constructor(browser: Browser, opened: Opened) {
    this.browser = browser;
    this.opened = opened;
  }

  static async open(url: string): Promise<Page> {
    const browser = new Browser();
    return new Page(browser, await openLink(browser, url));
  }

  path(rest: string): string {
    return `/a/${this.opened.link.artifactId}/_mostra/v/${BROWSER_PROTOCOL_REVISION}/review${rest}`;
  }

  async threads(): Promise<PageThreads> {
    const read = await this.browser.fetchJson(
      this.opened.link.shell,
      this.path(`/threads?view=${this.opened.viewId}`),
    );
    expect(read.status, read.body).toBe(200);
    return read.json<PageThreads>();
  }

  post(rest: string, body: Record<string, unknown>) {
    return this.browser.fetchJson(this.opened.link.shell, this.path(rest), {
      csrf: this.opened.shellCsrf,
      body: { viewId: this.opened.viewId, ...body },
    });
  }

  start(text: string, extra: Record<string, unknown> = {}) {
    const threadId = ThreadId.create();
    const done = this.post("/threads", {
      threadId,
      commentId: CommentId.create(),
      anchor: {
        reviewId: "title",
        selectors: [
          { type: "CssSelector", value: "h1" },
          { type: "TextQuoteSelector", exact: "Hello" },
        ],
        rect: { x: 10, y: 20, width: 300, height: 40 },
        viewport: { width: 1280, height: 800, dpr: 2 },
        label: 'heading "Hello"',
      },
      text,
      ...extra,
    });
    return { threadId, done };
  }
}

describe("review: ports, routes, mentions and export (HO-11, CO-06, RV-05)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt;
  let host: LineClient;

  /** Answers the host's next capture call with the PNG, and every mirror as it comes. */
  const capture = async (threadId: string): Promise<void> => {
    const call = await host.next(
      (message: Call) =>
        message.method === "port/capture.screenshot" &&
        (message.params as { threadId: string }).threadId === threadId,
      20_000,
    );
    // What a host's typed handler reads: the method's own schema (the SDK and the crate check it).
    const parsed = portCaptureScreenshotMethod.params.safeParse((call as Call).params);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    answer(host, call, { png: PNG_BASE64, width: 2, height: 1 });
  };

  /**
   * Answers the host's mirror calls for a thread, in order, until one shows `until`: a host answers
   * each, and the next waits for the answer (best effort, coalesced).
   */
  const mirrored = async (
    threadId: string,
    until: (thread: {
      status: string;
      messages: { text: string }[];
      crop: { path: string; state?: string };
    }) => boolean,
  ): Promise<{
    kind: string;
    artifactId: string;
    thread: {
      status: string;
      messages: { text: string }[];
      crop: { path: string; state?: string };
    };
  }> => {
    for (;;) {
      const call = (await host.next(
        (message: Call) =>
          message.method === "port/reviews.mirror" &&
          (message.params as { thread?: { threadId: string } }).thread?.threadId === threadId,
        20_000,
      )) as Call;
      const parsed = portReviewsMirrorMethod.params.safeParse(call.params);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      answer(host, call, {});
      const params = call.params as {
        kind: string;
        artifactId: string;
        thread: {
          status: string;
          messages: { text: string }[];
          crop: { path: string; state?: string };
        };
      };
      if (until(params.thread)) return params;
    }
  };

  beforeAll(async () => {
    await gateway.start();
    receipt = await gateway.publish("single-tsx", "page.tsx");
    host = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await host.call(
        "mostra/initialize",
        initializeParams({
          client: { name: "review-host", version: "1" },
          ports: ["capture", "reviews"],
        }),
      ),
    );
  }, 180_000);
  afterAll(async () => {
    host?.close();
    await gateway.stop();
  });

  it("stores the crop the capture port supplies, mirrors each change, and exports it", async () => {
    const ada = await Page.open(
      (await gateway.link(receipt.artifactId, { viewer: { ref: "ada", name: "Ada" } })).url,
    );
    const { threadId, done } = ada.start("The title wraps.");
    await capture(threadId);
    const created = await done;
    expect(created.status, created.body).toBe(200);
    const params = await mirrored(
      threadId,
      (thread) => thread.messages[0]?.text === "The title wraps.",
    );
    expect(params.kind).toBe("thread");
    expect(params.artifactId).toBe(receipt.artifactId);
    expect(params.thread.messages[0]?.text).toBe("The title wraps.");

    let state = "pending";
    for (let tries = 0; tries < 100 && state !== "captured"; tries += 1) {
      state =
        (await ada.threads()).threads.find((entry) => entry.id === threadId)?.crop.state ?? "";
      if (state !== "captured") await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(state).toBe("captured");
    const image = await ada.browser.fetchJson(
      ada.opened.link.shell,
      ada.path(`/threads/${threadId}/crop`),
    );
    expect(image.status).toBe(200);
    expect(image.header("content-type")).toBe("image/png");

    for (const status of ["resolved", "open"] as const) {
      const changed = await ada.post(`/threads/${threadId}/status`, { status });
      expect(changed.status, changed.body).toBe(200);
      const mirror = await mirrored(threadId, (thread) => thread.status === status);
      // The mirror names the crop as results do: by its path in the home, which exists.
      expect(mirror.thread.crop.state ?? "captured").toBe("captured");
      expect(existsSync(mirror.thread.crop.path), mirror.thread.crop.path).toBe(true);
    }

    // review/export: JSON and Markdown name the crop by a path that exists.
    const exported = ok<{ content: string; threads: number; crops: number }>(
      await host.call("review/export", {
        artifact: { artifactId: receipt.artifactId },
        format: "json",
      }),
    );
    const review = JSON.parse(exported.content) as {
      comments: { threadId: string; crop: { path: string; width: number; height: number } }[];
    };
    const mine = review.comments.find((entry) => entry.threadId === threadId);
    expect(mine?.crop).toMatchObject({ width: 2, height: 1 });
    expect(readFileSync(mine?.crop.path ?? "").toString("base64")).toBe(PNG_BASE64);
    const markdown = ok<{ content: string }>(
      await host.call("review/export", {
        artifact: { artifactId: receipt.artifactId },
        format: "md",
      }),
    ).content;
    expect(markdown).toContain("The title wraps.");
    expect(markdown).toContain(mine?.crop.path ?? "?");
    expect(markdown).toContain("review ID `title`");
    const out = tempDir("review-export");
    const written = ok<{ path: string }>(
      await host.call("review/export", {
        artifact: { artifactId: receipt.artifactId },
        format: "md",
        out,
      }),
    );
    expect(written.path).toBe(join(out, "review.md"));
    expect(readFileSync(written.path, "utf8")).toContain(join(out, "crops", `${threadId}.png`));
    expect(existsSync(join(out, "crops", `${threadId}.png`))).toBe(true);
  }, 120_000);

  it("shows a page only its own threads, and raises one host-only event per mention (CO-06)", async () => {
    const grace = await Page.open(
      (await gateway.link(receipt.artifactId, { viewer: { ref: "grace", name: "Grace" } })).url,
    );
    const graceStart = grace.start("Grace's note.");
    await capture(graceStart.threadId);
    expect((await graceStart.done).status).toBe(200);
    // The owner (the home's own link) sees every thread and may mention whoever opened the page.
    const owner = await Page.open((await gateway.link(receipt.artifactId)).url);
    const seen = await owner.threads();
    expect(seen.threads.map((thread) => thread.id)).toContain(graceStart.threadId);
    const graceKey = seen.people.find((person) => person.name === "Grace")?.key;
    expect(graceKey).toMatch(/^vk_/);
    const mention = owner.start("@Grace can you look?", { mentions: [{ key: graceKey }] });
    await capture(mention.threadId);
    expect((await mention.done).status).toBe(200);
    // Grace's page shows the owner's thread, which mentions her.
    const graceSees = await grace.threads();
    expect(graceSees.threads.map((thread) => thread.id)).toContain(mention.threadId);
    // A third viewer sees neither.
    const alan = await Page.open(
      (await gateway.link(receipt.artifactId, { viewer: { ref: "alan", name: "Alan" } })).url,
    );
    expect((await alan.threads()).threads).toEqual([]);
    // One durable event names Grace for hosts; no page's stream carries it.
    const events = ok<{ events: { type: string; payload: Record<string, unknown> }[] }>(
      await host.call("events/read", {
        filter: { artifacts: [receipt.artifactId], types: ["review.mentioned"] },
      }),
    ).events;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      threadId: mention.threadId,
      mentioned: { key: graceKey, name: "Grace", ref: "grace" },
    });
    // A mention of someone the page may not name is refused, and nothing is kept.
    const unknown = owner.start("@Nobody", { mentions: [{ key: "vk_000000000000000000000000" }] });
    const refused = await unknown.done;
    expect(refused.status).toBe(400);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_REVIEW_MENTION_UNKNOWN");
  }, 120_000);
});
