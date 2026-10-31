/**
 * A small HTTP client that behaves like a browser towards the gateway, for the hygiene and
 * gateway suites: one cookie jar per host (browsers keep cookies per host, not per port, D98),
 * `Origin` and `Sec-Fetch-*` headers as a page would send them, and raw requests for the cases no
 * browser would send. It never follows redirects on its own.
 */
import { request as httpRequest } from "node:http";
import { connect } from "node:net";

/** A response: status, every header as sent (repeats kept), and the body. */
export interface Answer {
  readonly status: number;
  /** Header name (lowercase) → every value. */
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
  header(name: string): string | undefined;
  json<T = Record<string, unknown>>(): T;
}

/** One request. */
export interface Ask {
  readonly method?: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Leave out the jar's cookies. */
  readonly noCookies?: boolean;
}

interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly httpOnly: boolean;
  readonly sameSite: string | undefined;
  readonly secure: boolean;
  readonly maxAge: number | undefined;
}

/** Every response the client saw, for checks that apply to all of them. */
export const seen: Answer[] = [];

/** A browser-like client with a per-host cookie jar. */
export class Browser {
  readonly jar = new Map<string, Cookie>();
  /**
   * Worker-mode frame sessions by artifact origin (D70): what the service worker adds to every
   * request of that origin as `X-Mostra-Frame`, except the ticketed streams it lets bypass it.
   */
  readonly frames = new Map<string, string>();

  /** The cookies the jar sends to `url`: every cookie of the host whose path matches. */
  cookiesFor(url: string): string {
    const { pathname } = new URL(url);
    return [...this.jar.values()]
      .filter(
        (cookie) =>
          pathname === cookie.path ||
          pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  /** Stores the cookies of a response, as a browser would. */
  store(answer: Answer): void {
    for (const line of answer.headers["set-cookie"] ?? []) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const lower = attributes.map((attribute) => attribute.toLowerCase());
      const get = (key: string): string | undefined =>
        attributes
          .find((attribute) => attribute.toLowerCase().startsWith(`${key}=`))
          ?.split("=")[1];
      const path = get("path") ?? "/";
      this.jar.set(`${name} ${path}`, {
        name,
        value: pair.slice(index + 1),
        path,
        httpOnly: lower.includes("httponly"),
        sameSite: get("samesite"),
        secure: lower.includes("secure"),
        maxAge: get("max-age") === undefined ? undefined : Number(get("max-age")),
      });
    }
  }

  /** Sends a request with the jar's cookies and stores what comes back. */
  async ask(ask: Ask): Promise<Answer> {
    const cookie = ask.noCookies ? "" : this.cookiesFor(ask.url);
    const url = new URL(ask.url);
    const frame =
      ask.noCookies || url.searchParams.has("ticket") ? undefined : this.frames.get(url.origin);
    const navigation = ask.headers?.["sec-fetch-mode"] === "navigate";
    const answer = await send({
      ...ask,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(frame
          ? { "x-mostra-frame": frame, ...(navigation ? { "x-mostra-navigation": "1" } : {}) }
          : {}),
        ...ask.headers,
      },
    });
    this.store(answer);
    return answer;
  }

  /** A page on `origin` fetching JSON from its own origin (a same-origin `fetch`). */
  fetchJson(
    origin: string,
    path: string,
    init: { method?: string; body?: unknown; csrf?: string } = {},
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
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  /** A navigation of a frame on `parent` to `url`. */
  navigate(url: string, parent?: string): Promise<Answer> {
    return this.ask({
      url,
      headers: {
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": parent ? "iframe" : "document",
        "sec-fetch-site": parent
          ? new URL(parent).host === new URL(url).host
            ? "same-origin"
            : "same-site"
          : "none",
      },
    });
  }
}

/** Sends one request; resolves with the full answer. */
export function send(ask: Ask): Promise<Answer> {
  const url = new URL(ask.url);
  // `localhost` and its subdomains are loopback (RFC 6761), as browsers resolve them: the test
  // tunnels' sites (`<name>.localhost`) live there.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host.endsWith(".localhost");
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: loopback ? "127.0.0.1" : host,
        // The Host the URL names, as a browser sends it, whatever address it connects to.
        setHost: false,
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
          const answer = answerOf(
            res.statusCode ?? 0,
            headers,
            Buffer.concat(chunks).toString("utf8"),
          );
          seen.push(answer);
          resolve(answer);
        });
      },
    );
    req.on("error", reject);
    if (ask.body !== undefined) req.write(ask.body);
    req.end();
  });
}

function answerOf(status: number, headers: Record<string, string[]>, body: string): Answer {
  return {
    status,
    headers,
    body,
    header: (name) => headers[name.toLowerCase()]?.[0],
    json: <T>() => JSON.parse(body) as T,
  };
}

/** Writes raw bytes to a port and resolves with the status line and the rest, for malformed requests. */
export function raw(
  port: number,
  text: string | Buffer,
  host = "127.0.0.1",
  options: {
    /**
     * Reads nothing until the whole request is sent and this long has passed, as a busy client
     * would: an answer the server reset in the meantime is then lost, as it would be for that
     * client (a server that closes without reading what was sent resets the connection).
     */
    readonly readAfterMs?: number;
  } = {},
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let received = "";
    let idle: NodeJS.Timeout | undefined;
    socket.setTimeout(10_000, () => socket.destroy(new Error("raw request timed out")));
    if (options.readAfterMs !== undefined) socket.pause();
    socket.on("connect", () =>
      socket.write(text, () => {
        if (options.readAfterMs !== undefined) {
          setTimeout(() => socket.resume(), options.readAfterMs);
        }
      }),
    );
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      // A complete answer on a connection the server keeps open: stop waiting once it goes quiet.
      clearTimeout(idle);
      idle = setTimeout(() => socket.destroy(), 300);
    });
    socket.on("error", (error) => {
      if (received) resolve({ status: statusOf(received), text: received });
      else reject(error);
    });
    socket.on("close", () => resolve({ status: statusOf(received), text: received }));
  });
}

function statusOf(text: string): number {
  return Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? 0);
}

/** A capability link split into its parts. */
export interface Link {
  readonly shell: string;
  readonly artifactId: string;
  readonly version?: number;
  readonly secret: string;
}

export function parseLink(url: string): Link {
  const parsed = new URL(url);
  const match = /^\/a\/(art_[0-9A-Z]{26})(?:\/v\/(\d+))?$/.exec(parsed.pathname);
  if (!match?.[1]) throw new Error(`not a link: ${url}`);
  return {
    shell: parsed.origin,
    artifactId: match[1],
    ...(match[2] ? { version: Number(match[2]) } : {}),
    secret: new URLSearchParams(parsed.hash.slice(1)).get("t") ?? "",
  };
}

/** What opening a link through the shell gave the browser. */
export interface Opened {
  readonly link: Link;
  readonly shellCsrf: string;
  readonly frameOrigin: string;
  readonly frameCsrf: string;
  readonly ticketSrc: string;
  /** The view this frame load is (D104), from the ticket's answer. */
  readonly viewId: string;
  readonly page: Answer;
}

/**
 * Opens a link as the shell does: the token for a shell session, a frame ticket, the frame's
 * entry and its first page. Throws when a step is refused.
 */
export async function openLink(browser: Browser, url: string, version?: number): Promise<Opened> {
  const link = parseLink(url);
  const api = `/a/${link.artifactId}/_mostra`;
  const exchange = await browser.fetchJson(link.shell, `${api}/session`, {
    body: { token: link.secret },
  });
  if (exchange.status !== 200) throw new Error(`exchange: ${exchange.status} ${exchange.body}`);
  const shellCsrf = exchange.json<{ csrf: string }>().csrf;
  const ticket = await browser.fetchJson(link.shell, `${api}/ticket`, {
    body: version === undefined ? {} : { version },
    csrf: shellCsrf,
  });
  if (ticket.status !== 200) throw new Error(`ticket: ${ticket.status} ${ticket.body}`);
  const { src, artifactOrigin, viewId } = ticket.json<{
    src: string;
    artifactOrigin: string;
    viewId: string;
  }>();
  let page: Answer;
  const worker = new URL(src).hash.startsWith("#t=");
  if (worker) {
    // Worker mode (D70): the bootstrap page, then its exchange of the fragment's ticket for the
    // frame session its service worker sends from then on.
    const boot = await browser.navigate(src.replace(/#.*$/, ""), link.shell);
    if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status} ${boot.body}`);
    const entered = await browser.fetchJson(artifactOrigin, "/_mostra/enter", {
      body: { ticket: new URL(src).hash.slice(3) },
    });
    if (entered.status !== 200) throw new Error(`enter: ${entered.status} ${entered.body}`);
    browser.frames.set(artifactOrigin, entered.json<{ session: string }>().session);
    page = await browser.navigate(`${artifactOrigin}/`, link.shell);
  } else {
    const enter = await browser.navigate(src, link.shell);
    if (enter.status !== 303) throw new Error(`enter: ${enter.status} ${enter.body}`);
    page = await browser.navigate(`${artifactOrigin}${enter.header("location")}`, link.shell);
  }
  const session = await browser.fetchJson(artifactOrigin, "/_mostra/session");
  if (session.status !== 200) throw new Error(`frame session: ${session.status} ${session.body}`);
  return {
    link,
    shellCsrf,
    frameOrigin: artifactOrigin,
    frameCsrf: session.json<{ csrf: string }>().csrf,
    ticketSrc: src,
    viewId,
    page,
  };
}
