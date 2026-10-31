/**
 * A viewer as the kit plays one: it opens a capability link the way the shell does (the token for
 * a shell session, a frame ticket, the frame's entry) and speaks the browser protocol the way a
 * page does, with a per-host cookie jar (browsers keep cookies per host, not per port, D98) and the
 * `Origin`, `Sec-Fetch-*` and CSRF headers a browser sends. It also sends what no browser would,
 * for the hygiene scenarios. It never follows redirects. Where the shell and the artifact are two
 * sites (a host's external bases, a Cloudflare share), it enters the frame as the bootstrap page
 * does and signs the frame's requests as Mostra's service worker does (D70, D158 item 5).
 */
import { request as httpRequest } from "node:http";
import {
  BROWSER_PROTOCOL_REVISIONS,
  deserializeAll,
  type Frame,
  type FrameTicket,
  MutationId,
  serializeAll,
} from "@mostra/protocol";

/** The browser-protocol revision the kit speaks: the first, which every gateway serves. */
const REVISION: string = BROWSER_PROTOCOL_REVISIONS[0] as string;

/** One HTTP answer. */
export interface Answer {
  /** The HTTP status. */
  readonly status: number;
  /** Each header (lowercase name) with every value it was sent with. */
  readonly headers: Readonly<Record<string, readonly string[]>>;
  /** The body as text. */
  readonly body: string;
  /** The body as JSON (`{}` when it isn't). */
  json<T = Record<string, unknown>>(): T;
}

/** One request. */
export interface Ask {
  /** The HTTP method; default `GET`. */
  readonly method?: string;
  /** The full URL. */
  readonly url: string;
  /** The request's headers, exactly as sent. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The body, if any. */
  readonly body?: string;
  /** Leave out the jar's cookies. */
  readonly noCookies?: boolean;
}

/** Sends one request, never following a redirect. */
export function send(ask: Ask): Promise<Answer> {
  const url = new URL(ask.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        // `localhost` and its subdomains are this machine, as browsers resolve them (WHATWG URL,
        // RFC 6761); Mostra's listeners bind 127.0.0.1.
        host: /(^|\.)localhost$/i.test(url.hostname)
          ? "127.0.0.1"
          : url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port,
        method: ask.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host, ...ask.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const headers: Record<string, string[]> = {};
          for (let index = 0; index + 1 < res.rawHeaders.length; index += 2) {
            const name = (res.rawHeaders[index] as string).toLowerCase();
            const values = headers[name] ?? [];
            values.push(res.rawHeaders[index + 1] as string);
            headers[name] = values;
          }
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body,
            json: <T>() => {
              try {
                return JSON.parse(body) as T;
              } catch {
                return {} as T;
              }
            },
          });
        });
      },
    );
    req.setTimeout(60_000, () => req.destroy(new Error(`${ask.url} didn't answer in 60 s`)));
    req.on("error", reject);
    if (ask.body !== undefined) req.write(ask.body);
    req.end();
  });
}

/** A link's parts: its shell origin, artifact, token secret and pinned version. */
export interface ParsedLink {
  /** The shell's origin. */
  readonly origin: string;
  /** The artifact the link opens. */
  readonly artifactId: string;
  /** The token's secret, from the fragment. */
  readonly secret: string;
  /** The version number the link pins, if it pins one. */
  readonly version?: string;
}

/** Reads a capability link (`http://host:port/a/<artifactId>[/v/<n>]#t=<secret>`). */
export function parseLink(link: string): ParsedLink {
  const url = new URL(link);
  const match = /^\/a\/(art_[0-9A-Z]{26})(?:\/v\/(\d+))?$/.exec(url.pathname);
  const secret = new URLSearchParams(url.hash.slice(1)).get("t");
  if (!match?.[1] || !secret)
    throw new Error(`${url.origin}${url.pathname} isn't a capability link.`);
  return {
    origin: url.origin,
    artifactId: match[1],
    secret,
    ...(match[2] !== undefined ? { version: match[2] } : {}),
  };
}

/** A browser-like client with a per-host cookie jar. */
export class Browser {
  readonly #jar = new Map<string, { value: string; path: string }>();
  /** Worker-mode frame sessions by origin: the header Mostra's service worker adds (D70). */
  readonly #frames = new Map<string, string>();

  /** Signs every later request to `origin` with a worker-mode frame session, as its worker does. */
  enterFrame(origin: string, secret: string): void {
    this.#frames.set(origin, secret);
  }

  /** Whether `origin` has a worker-mode frame session in this browser. */
  workerFrame(origin: string): boolean {
    return this.#frames.has(origin);
  }

  /** The cookies the jar sends to `url`: every cookie of the host whose path matches. */
  cookiesFor(url: string): string {
    const { pathname } = new URL(url);
    return [...this.#jar]
      .filter(([, cookie]) => {
        const prefix = cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`;
        return pathname === cookie.path || pathname.startsWith(prefix);
      })
      .map(([key, cookie]) => `${key.split(" ")[0]}=${cookie.value}`)
      .join("; ");
  }

  /** Sends a request with the jar's cookies and keeps the ones that come back. */
  async ask(ask: Ask): Promise<Answer> {
    const cookie = ask.noCookies ? "" : this.cookiesFor(ask.url);
    const url = new URL(ask.url);
    // The service worker signs every same-origin request but a ticketed one, which bypasses it.
    const frame = url.searchParams.has("ticket") ? undefined : this.#frames.get(url.origin);
    const answer = await send({
      ...ask,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(frame !== undefined ? { "x-mostra-frame": frame } : {}),
        ...ask.headers,
      },
    });
    for (const line of answer.headers["set-cookie"] ?? []) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const at = pair.indexOf("=");
      const path =
        attributes.find((attribute) => attribute.toLowerCase().startsWith("path="))?.slice(5) ??
        "/";
      this.#jar.set(`${pair.slice(0, at)} ${path}`, { value: pair.slice(at + 1), path });
    }
    return answer;
  }

  /** A page on `origin` posting or fetching JSON from its own origin. */
  fetchJson(
    origin: string,
    path: string,
    init: { method?: string; body?: unknown; csrf?: string; headers?: Record<string, string> } = {},
  ): Promise<Answer> {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    return this.ask({
      method,
      url: `${origin}${path}`,
      headers: {
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        ...(method === "GET" ? {} : { origin, "content-type": "application/json" }),
        ...(init.csrf ? { "x-mostra-csrf": init.csrf } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
}

/** Why a viewer couldn't open its link: the step and the gateway's answer. */
export class OpenError extends Error {
  /** The HTTP status of the refused step. */
  readonly status: number;
  /** The diagnostic code (`MOSTRA_…`). */
  readonly code: string | undefined;

  constructor(step: string, answer: Answer) {
    const code = answer.json<{ code?: string }>().code;
    super(`${step}: HTTP ${answer.status}${code ? ` ${code}` : ""}`);
    this.name = "OpenError";
    this.status = answer.status;
    this.code = code;
  }
}

/** A run's state, as `runs` and `runs/attach` answer it. */
export interface RunState {
  /** The run's ID (`run_…`). */
  readonly runId: string;
  /** `queued`, `running`, `succeeded`, `failed` or `cancelled` (D130). */
  readonly status: string;
  /** Its result, as serializer batches. */
  readonly batches: readonly Frame[][];
  /** The rest of the run's state (progress, log, error). */
  readonly [key: string]: unknown;
}

/** One opened view: a shell session, a frame session and the view they show. */
export class Viewer {
  /** The cookie jar this viewer's requests use. */
  readonly browser: Browser;
  /** The link it opened. */
  readonly link: ParsedLink;
  /** The frame ticket the shell got: the view, its version, channels and controls. */
  readonly ticket: FrameTicket;
  readonly #shellCsrf: string;
  readonly #frameCsrf: string;

  private constructor(
    browser: Browser,
    link: ParsedLink,
    ticket: FrameTicket,
    shellCsrf: string,
    frameCsrf: string,
  ) {
    this.browser = browser;
    this.link = link;
    this.ticket = ticket;
    this.#shellCsrf = shellCsrf;
    this.#frameCsrf = frameCsrf;
  }

  /**
   * Opens `link` as the shell does. `headers` go with the session exchange (the request the
   * `identity` port judges, D143). Throws an {@link OpenError} for a refused step.
   */
  static async open(
    link: string,
    options: { browser?: Browser; headers?: Record<string, string> } = {},
  ): Promise<Viewer> {
    const browser = options.browser ?? new Browser();
    const parsed = parseLink(link);
    const api = `/a/${parsed.artifactId}/_mostra`;
    const exchange = await browser.fetchJson(parsed.origin, `${api}/session`, {
      body: { token: parsed.secret },
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (exchange.status !== 200) throw new OpenError("exchange", exchange);
    const shellCsrf = exchange.json<{ csrf: string }>().csrf;
    const ticketAnswer = await browser.fetchJson(parsed.origin, `${api}/ticket`, {
      body: parsed.version !== undefined ? { version: Number(parsed.version) } : {},
      csrf: shellCsrf,
    });
    if (ticketAnswer.status !== 200) throw new OpenError("ticket", ticketAnswer);
    const ticket = ticketAnswer.json<FrameTicket>();
    if (ticket.mode === "worker") {
      // The bootstrap page (D70): it loads, then exchanges the ticket in its fragment.
      const page = await browser.ask({
        url: ticket.src.replace(/#.*$/, ""),
        headers: {
          accept: "text/html",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "iframe",
          "sec-fetch-site": "cross-site",
        },
      });
      if (page.status !== 200) throw new OpenError("bootstrap", page);
      const fragment = new URLSearchParams(new URL(ticket.src).hash.slice(1)).get("t") ?? "";
      const entered = await browser.fetchJson(ticket.artifactOrigin, "/_mostra/enter", {
        body: { ticket: fragment },
      });
      if (entered.status !== 200) throw new OpenError("enter", entered);
      browser.enterFrame(ticket.artifactOrigin, entered.json<{ session: string }>().session);
      const session = await browser.fetchJson(ticket.artifactOrigin, "/_mostra/session");
      if (session.status !== 200) throw new OpenError("frame session", session);
      return new Viewer(browser, parsed, ticket, shellCsrf, session.json<{ csrf: string }>().csrf);
    }
    const enter = await browser.ask({
      url: ticket.src,
      headers: {
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-site",
      },
    });
    if (enter.status !== 303) throw new OpenError("enter", enter);
    const session = await browser.fetchJson(ticket.artifactOrigin, "/_mostra/session");
    if (session.status !== 200) throw new OpenError("frame session", session);
    return new Viewer(browser, parsed, ticket, shellCsrf, session.json<{ csrf: string }>().csrf);
  }

  /** The view this frame load is (D104). */
  get viewId(): string {
    return this.ticket.viewId;
  }

  /** A browser-protocol request from the page. */
  page(path: string, body: unknown): Promise<Answer> {
    return this.browser.fetchJson(this.ticket.artifactOrigin, `/_mostra/v/${REVISION}/${path}`, {
      body,
      csrf: this.#frameCsrf,
    });
  }

  /** A request of the shell (its own origin, under `/a/<artifactId>`). */
  shell(path: string, body?: unknown, method?: string): Promise<Answer> {
    return this.browser.fetchJson(this.link.origin, `/a/${this.link.artifactId}/_mostra/${path}`, {
      ...(body === undefined ? {} : { body }),
      ...(method ? { method } : {}),
      csrf: this.#shellCsrf,
    });
  }

  /**
   * Writes fields of the viewer's draft (or, with `scope: "artifact"`, the artifact state), with
   * the labels a page sends for them (D106).
   */
  write(
    fields: Record<string, unknown>,
    options: {
      baseRevision?: string;
      scope?: "viewer" | "artifact";
      labels?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<Answer> {
    return this.page("fields", {
      mutationId: MutationId.create(),
      scope: options.scope ?? "viewer",
      baseRevision: options.baseRevision ?? "0",
      viewId: this.viewId,
      ops: Object.entries(fields).map(([id, value]) => ({
        id,
        value,
        ...(options.labels?.[id] !== undefined ? { label: options.labels[id] } : {}),
      })),
    });
  }

  /** Submits on the artifact channel (D40). */
  submit(expectedRevision: string): Promise<Answer> {
    return this.page("submit", { viewId: this.viewId, expectedRevision, channel: "artifact" });
  }

  /** The trusted Submit, on the shell channel (D40, D108). */
  shellSubmit(expectedRevision: string): Promise<Answer> {
    return this.shell(`v/${REVISION}/submit`, { viewId: this.viewId, expectedRevision });
  }

  /** Writes `fields`, then submits on `channel`; answers the submit. */
  async answer(
    fields: Record<string, unknown>,
    channel: "artifact" | "shell" = "artifact",
    labels?: Readonly<Record<string, string>>,
  ): Promise<Answer> {
    const written = await this.write(fields, labels ? { labels } : {});
    if (written.status !== 200) return written;
    const { revision } = written.json<{ revision: string }>();
    return channel === "artifact" ? this.submit(revision) : this.shellSubmit(revision);
  }

  /** Raises a signal from the page (IN-09). */
  signal(name: string, payload?: unknown): Promise<Answer> {
    return this.page("signal", {
      viewId: this.viewId,
      name,
      ...(payload === undefined ? {} : { payload }),
    });
  }

  /** Starts an action run (D130) and follows it until it ends. */
  async run(fnId: string, args: unknown[], timeoutMs = 60_000): Promise<RunState> {
    const started = await this.page("runs", {
      viewId: this.viewId,
      fnId,
      args: await serializeAll(args, { mode: "argument" }),
      clientKey: `ck-${MutationId.create()}`,
    });
    if (started.status !== 200) throw new OpenError("run", started);
    const runId = started.json<{ runId: string }>().runId;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const attached = await this.page("runs/attach", { viewId: this.viewId, runIds: [runId] });
      const state = attached.json<{ runs: RunState[] }>().runs?.[0];
      if (state && ["succeeded", "failed", "cancelled"].includes(state.status)) return state;
      if (Date.now() > deadline) throw new Error(`run ${runId} didn't end in ${timeoutMs} ms`);
      await new Promise((done) => setTimeout(done, 100));
    }
  }

  /** The page's long poll: events after `cursor` (D47); in worker mode with its ticket (D70). */
  async poll(cursor?: string): Promise<Answer> {
    let query = `view=${this.viewId}&wait=0${cursor !== undefined ? `&cursor=${cursor}` : ""}`;
    if (this.browser.workerFrame(this.ticket.artifactOrigin)) {
      const ticket = await this.page("ticket", { purpose: "stream" });
      if (ticket.status !== 200) return ticket;
      query += `&ticket=${ticket.json<{ ticket: string }>().ticket}`;
    }
    return this.browser.fetchJson(
      this.ticket.artifactOrigin,
      `/_mostra/v/${REVISION}/events/poll?${query}`,
    );
  }
}

/** A run's result, from its stored batches. */
export async function resultOf(state: RunState): Promise<unknown> {
  return state.batches.length === 0 ? undefined : deserializeAll([...state.batches]);
}
