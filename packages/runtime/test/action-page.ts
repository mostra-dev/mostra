/**
 * A page that calls server functions, starts and follows action runs and reads live sources over
 * the browser protocol, and a counting fake mail server (WP-08's suites).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  BROWSER_PROTOCOL_REVISION,
  deserializeAll,
  type Frame,
  serializeAll,
} from "@mostra/protocol";
import { type Answer, Browser, type Opened, openLink } from "./browser-client.ts";
import { eventually } from "./support.ts";

const V = BROWSER_PROTOCOL_REVISION;

export interface RunState {
  runId: string;
  fnId: string;
  key?: string;
  status: string;
  reason?: string;
  progress?: { fraction?: number; message?: string };
  log: string[];
  batches: Frame[][];
  error?: { code?: string; message: string };
  joined?: boolean;
}

let clientKeys = 0;
export const clientKey = (): string => `ck-${process.pid}-${Date.now()}-${clientKeys++}`;

/** A page in a frame, posting to its own origin with its session's CSRF token. */
export class ActionPage {
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

  /** A plain call: the NDJSON lines, decoded. */
  async call(
    fnId: string,
    args: unknown[],
  ): Promise<{ status: number; value?: unknown; end?: Record<string, unknown>; body: string }> {
    const answer = await this.post(`call/${encodeURIComponent(fnId)}`, {
      viewId: this.opened.viewId,
      args: await serializeAll(args, { mode: "argument" }),
    });
    if (answer.status !== 200) return { status: answer.status, body: answer.body };
    const lines = answer.body
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { batch?: Frame[]; end?: Record<string, unknown> });
    const batches = lines.flatMap((line) => (line.batch ? [line.batch] : []));
    const end = lines.find((line) => line.end)?.end;
    return {
      status: 200,
      ...(batches.length > 0 ? { value: await deserializeAll(batches) } : {}),
      ...(end ? { end } : {}),
      body: answer.body,
    };
  }

  async run(
    fnId: string,
    args: unknown[],
    key?: string,
    ck: string = clientKey(),
  ): Promise<Answer> {
    return this.post("runs", {
      viewId: this.opened.viewId,
      fnId,
      args: await serializeAll(args, { mode: "argument" }),
      ...(key !== undefined ? { key } : {}),
      clientKey: ck,
    });
  }

  attach(input: { runIds?: string[]; keyed?: { fnId: string; key: string }[] }): Promise<Answer> {
    return this.post("runs/attach", { viewId: this.opened.viewId, ...input });
  }

  cancel(runId: string): Promise<Answer> {
    return this.post(`runs/${runId}/cancel`, { viewId: this.opened.viewId });
  }

  live(keys: { key: string; window?: number }[]): Promise<Answer> {
    return this.post("live", { viewId: this.opened.viewId, keys });
  }

  poll(cursor?: string, wait = 0): Promise<Answer> {
    const query = `view=${this.opened.viewId}&wait=${wait}${cursor !== undefined ? `&cursor=${cursor}` : ""}`;
    return this.browser.fetchJson(this.opened.frameOrigin, `/_mostra/v/${V}/events/poll?${query}`);
  }

  /** Waits for a run to end, re-attaching as a reloaded page would. */
  async settled(runId: string, timeoutMs = 20_000): Promise<RunState> {
    let state: RunState | undefined;
    await eventually(async () => {
      const answer = await this.attach({ runIds: [runId] });
      state = answer.json<{ runs: RunState[] }>().runs[0];
      return ["succeeded", "failed", "cancelled"].includes(state?.status ?? "");
    }, timeoutMs);
    return state as RunState;
  }
}

export async function openPage(url: string): Promise<ActionPage> {
  const browser = new Browser();
  return new ActionPage(browser, await openLink(browser, url));
}

/** The result of a run, from its stored batches. */
export async function resultOf(state: RunState): Promise<unknown> {
  return state.batches.length === 0 ? undefined : deserializeAll(state.batches);
}

/** A counting fake mail server: every accepted POST is one email (J3's "Send"). */
export class FakeMail {
  readonly received: { to: string; body: string; authorization: string | undefined }[] = [];
  server!: Server;
  url = "";

  async start(): Promise<this> {
    this.server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.method === "GET") {
          response.end("hello from the network");
          return;
        }
        const parsed = JSON.parse(body) as { to: string; body: string };
        this.received.push({ ...parsed, authorization: request.headers.authorization });
        // A slow provider, so a double click arrives while the first send is in flight.
        setTimeout(() => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ id: `mail-${this.received.length}` }));
        }, 300);
      });
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => this.server.once("listening", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/send`;
    return this;
  }

  close(): void {
    this.server.close();
  }
}
