/**
 * How the client runtime reaches Mostra (INTERFACES §4): the browser protocol over the artifact's
 * own origin, with its session cookie and CSRF token. A delivery target without a gateway (a
 * static export, an MCP App before its transport, D111) gets another implementation of the same
 * interface, so hooks never know which they talk to.
 */
import {
  BROWSER_PROTOCOL_REVISION,
  type EventRecord,
  type FieldsRequest,
  type MutationResult,
  type PollResult,
  type SignalRequest,
  type StreamSnapshot,
  type SubmissionSummary,
  type SubmitRequest,
} from "@mostra/protocol";
import { type DiagnosticLike, MostraError } from "./errors.ts";

/** The connection to the gateway failed before it answered: the page is offline. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** What a subscription hears. */
export interface StreamHandlers {
  /** Where the page stands, first, and again after a compacted cursor. */
  onSnapshot(snapshot: StreamSnapshot): void;
  /** Durable events after the last cursor, in order. */
  onEvents(events: readonly EventRecord[]): void;
  /** The stream's health: `live` while connected, `offline` while it retries, `revoked` at the end. */
  onStatus(status: "live" | "offline" | "revoked"): void;
}

/** The client runtime's way to Mostra. */
export interface Transport {
  /** Where the page stands: its viewer, draft, the artifact state and their cursor. */
  snapshot(): Promise<StreamSnapshot>;
  /** One mutation (`fields`); `keepalive` lets it outlive the page (`pagehide`). */
  mutate(
    request: FieldsRequest,
    options?: { readonly keepalive?: boolean },
  ): Promise<MutationResult>;
  /** A submit through the artifact channel. */
  submit(request: SubmitRequest): Promise<SubmissionSummary>;
  /** A signal. */
  signal(request: SignalRequest): Promise<{ readonly cursor: string }>;
  /** Hears the page's events after `cursor`; returns the function that stops. */
  subscribe(cursor: string | undefined, handlers: StreamHandlers): () => void;
}

/** The longest body `fetch` sends with `keepalive` (the Fetch standard's 64 KiB budget). */
export const KEEPALIVE_BODY_MAX: number = 64 * 1024 - 1024;

/** After this many stream failures in a row, the client long-polls instead (FAILURE_MODEL §8). */
const STREAM_FAILURES_BEFORE_POLL = 2;

/**
 * The browser protocol over HTTP, on the artifact's origin. The CSRF token comes from
 * `/_mostra/session`, once; a refusal is a {@link MostraError} with the gateway's diagnostic, and
 * an unreachable gateway a {@link NetworkError}.
 */
export class HttpTransport implements Transport {
  readonly #viewId: string;
  readonly #base: string;
  #csrf: Promise<string> | undefined;

  constructor(viewId: string, base = `/_mostra/v/${BROWSER_PROTOCOL_REVISION}`) {
    this.#viewId = viewId;
    this.#base = base;
  }

  #token(): Promise<string> {
    this.#csrf ??= (async () => {
      const session = (await this.#request("/_mostra/session", { method: "GET" })) as {
        csrf: string;
      };
      return session.csrf;
    })().catch((error: unknown) => {
      this.#csrf = undefined;
      throw error;
    });
    return this.#csrf;
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
    } catch (error) {
      throw new NetworkError((error as Error).message);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const diagnostic = (body ?? {}) as Partial<DiagnosticLike> & Record<string, unknown>;
      // A proxy or a restarting gateway answers without a diagnostic: that is a network failure.
      if (typeof diagnostic.code !== "string") {
        throw new NetworkError(`The gateway answered ${response.status}.`);
      }
      throw new MostraError(diagnostic.code, diagnostic.message ?? diagnostic.code, {
        status: response.status,
        diagnostic: diagnostic as DiagnosticLike,
        body: diagnostic,
      });
    }
    return body;
  }

  async #post(path: string, body: unknown, keepalive = false): Promise<unknown> {
    const text = JSON.stringify(body);
    const csrf = await this.#token();
    return this.#request(`${this.#base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mostra-csrf": csrf },
      body: text,
      keepalive: keepalive && text.length < KEEPALIVE_BODY_MAX,
    });
  }

  async snapshot(): Promise<StreamSnapshot> {
    const result = (await this.#request(`${this.#base}/events/poll?view=${this.#viewId}&wait=0`, {
      method: "GET",
    })) as PollResult;
    if (!result.snapshot) throw new NetworkError("The gateway sent no snapshot.");
    return result.snapshot;
  }

  mutate(
    request: FieldsRequest,
    options?: { readonly keepalive?: boolean },
  ): Promise<MutationResult> {
    return this.#post("/fields", request, options?.keepalive === true) as Promise<MutationResult>;
  }

  submit(request: SubmitRequest): Promise<SubmissionSummary> {
    return this.#post("/submit", request) as Promise<SubmissionSummary>;
  }

  signal(request: SignalRequest): Promise<{ readonly cursor: string }> {
    return this.#post("/signal", request) as Promise<{ cursor: string }>;
  }

  subscribe(cursor: string | undefined, handlers: StreamHandlers): () => void {
    let closed = false;
    let last = cursor;
    let source: EventSource | undefined;
    let failures = 0;
    let polling = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const query = (): string =>
      `view=${this.#viewId}${last === undefined ? "" : `&cursor=${last}`}`;

    const poll = async (): Promise<void> => {
      polling = true;
      let backoff = 1_000;
      while (!closed) {
        try {
          const result = (await this.#request(`${this.#base}/events/poll?${query()}&wait=25`, {
            method: "GET",
          })) as PollResult;
          backoff = 1_000;
          handlers.onStatus("live");
          if (result.snapshot) handlers.onSnapshot(result.snapshot);
          if (result.events.length > 0) handlers.onEvents(result.events);
          last = result.cursor;
        } catch (error) {
          if (error instanceof MostraError && error.code === "MOSTRA_HYGIENE_TOKEN_REVOKED") {
            handlers.onStatus("revoked");
            return;
          }
          handlers.onStatus("offline");
          await new Promise((resolve) => {
            retry = setTimeout(resolve, backoff);
          });
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    };

    const open = (): void => {
      if (closed) return;
      if (typeof EventSource === "undefined") {
        void poll();
        return;
      }
      source = new EventSource(`${this.#base}/events?${query()}`);
      source.addEventListener("open", () => {
        failures = 0;
        handlers.onStatus("live");
      });
      source.addEventListener("snapshot", (event) => {
        failures = 0;
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as StreamSnapshot;
        last = snapshot.cursor;
        handlers.onSnapshot(snapshot);
      });
      source.addEventListener("mostra", (event) => {
        failures = 0;
        const record = JSON.parse((event as MessageEvent<string>).data) as EventRecord;
        last = record.cursor;
        handlers.onEvents([record]);
      });
      source.addEventListener("error", () => {
        if (closed) return;
        failures += 1;
        handlers.onStatus("offline");
        // A refused stream (revoked link, gateway gone) is CLOSED; a dropped one reconnects by
        // itself. Either way, after two failures in a row the page long-polls on the same cursor.
        if (source?.readyState === EventSource.CLOSED || failures >= STREAM_FAILURES_BEFORE_POLL) {
          source?.close();
          source = undefined;
          if (!polling) void poll();
        }
      });
    };
    open();
    return () => {
      closed = true;
      source?.close();
      if (retry !== undefined) clearTimeout(retry);
    };
  }
}
