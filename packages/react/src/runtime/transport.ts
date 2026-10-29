/**
 * How the client runtime reaches Mostra (INTERFACES §4): the browser protocol over the artifact's
 * own origin, with its session cookie and CSRF token. A delivery target without a gateway (a
 * static export, an MCP App before its transport, D111) gets another implementation of the same
 * interface, so hooks never know which they talk to.
 */
import {
  BROWSER_PROTOCOL_REVISION,
  type CallLine,
  type CallRequest,
  type EphemeralMessage,
  type EventRecord,
  type FieldsRequest,
  type LiveRequest,
  type LiveState,
  type LiveUpdate,
  type MutationResult,
  type PollResult,
  type RunAttachRequest,
  type RunDelta,
  type RunRequest,
  type RunState,
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
  /** Run and live updates (WP-08): lossy, never events, so a page reads again what it missed. */
  onEphemeral?(message: EphemeralMessage): void;
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
  /** A plain server-function call (D54): its result's lines as they come. */
  call?(fnId: string, request: CallRequest, signal?: AbortSignal): AsyncIterable<CallLine>;
  /** Starts or joins an action run (AC-02, AC-03). */
  startRun?(request: RunRequest): Promise<RunState>;
  /** Reads runs and follows them for a minute. */
  attachRuns?(request: RunAttachRequest): Promise<{ readonly runs: readonly RunState[] }>;
  /** Cancels a run (AC-04). */
  cancelRun?(runId: string, viewId: string): Promise<RunState>;
  /** Reads live sources and keeps them produced for a minute (D56). */
  live?(request: LiveRequest): Promise<{ readonly sources: readonly LiveState[] }>;
}

/** The longest body `fetch` sends with `keepalive` (the Fetch standard's 64 KiB budget). */
export const KEEPALIVE_BODY_MAX: number = 64 * 1024 - 1024;

/** After this many stream failures in a row, the client long-polls instead (FAILURE_MODEL §8). */
const STREAM_FAILURES_BEFORE_POLL = 2;

/**
 * How long a stream may stay silent after it opens before the page long-polls instead: the
 * gateway's first message (`ready`) comes at once, so silence means something holds the stream
 * back (a buffering proxy or tunnel, or a browser that stalled it, WP-13).
 */
export const STREAM_FIRST_MESSAGE_MS = 6_000;

/**
 * The browser protocol over HTTP, on the artifact's origin. The CSRF token comes from
 * `/_mostra/session`, once; a refusal is a {@link MostraError} with the gateway's diagnostic, and
 * an unreachable gateway a {@link NetworkError}.
 */
export class HttpTransport implements Transport {
  readonly #viewId: string;
  readonly #base: string;
  readonly #tickets: boolean;
  readonly #streams: boolean;
  #csrf: Promise<string> | undefined;

  /**
   * `csrf` is the session's token when the caller already read it (the bridge does): a save made
   * as the page closes must not wait for a request the closing page would cancel (IN-02).
   */
  constructor(
    viewId: string,
    options: {
      readonly csrf?: string;
      readonly base?: string;
      /**
       * Worker mode (D70): every stream and poll opens with a single-use ticket, so it bypasses
       * the service worker, which can't carry an endless response in Firefox.
       */
      readonly tickets?: boolean;
      /** `false` where event streams don't pass: the page long-polls from the start (D47). */
      readonly streams?: boolean;
    } = {},
  ) {
    this.#viewId = viewId;
    this.#base = options.base ?? `/_mostra/v/${BROWSER_PROTOCOL_REVISION}`;
    this.#tickets = options.tickets === true;
    this.#streams = options.streams !== false;
    if (options.csrf) this.#csrf = Promise.resolve(options.csrf);
  }

  /** `&ticket=…` for a stream or poll in worker mode, else nothing. */
  async #ticketQuery(): Promise<string> {
    if (!this.#tickets) return "";
    const { ticket } = (await this.#post("/ticket", { purpose: "stream" })) as { ticket: string };
    return `&ticket=${encodeURIComponent(ticket)}`;
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

  async *call(fnId: string, request: CallRequest, signal?: AbortSignal): AsyncIterable<CallLine> {
    const csrf = await this.#token();
    let response: Response;
    try {
      response = await fetch(`${this.#base}/call/${encodeURIComponent(fnId)}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-mostra-csrf": csrf },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new NetworkError((error as Error).message);
    }
    if (!response.ok || !response.body) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const diagnostic = (body ?? {}) as Partial<DiagnosticLike>;
      if (typeof diagnostic.code !== "string") {
        throw new NetworkError(`The gateway answered ${response.status}.`);
      }
      throw new MostraError(diagnostic.code, diagnostic.message ?? diagnostic.code, {
        status: response.status,
        diagnostic: diagnostic as DiagnosticLike,
      });
    }
    // NDJSON: one line per batch, then the end.
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<string>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw new NetworkError((error as Error).message);
        }
        if (chunk.done) break;
        buffer += chunk.value;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() !== "") yield JSON.parse(line) as CallLine;
          newline = buffer.indexOf("\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (buffer.trim() !== "") yield JSON.parse(buffer) as CallLine;
  }

  startRun(request: RunRequest): Promise<RunState> {
    return this.#post("/runs", request) as Promise<RunState>;
  }

  attachRuns(request: RunAttachRequest): Promise<{ readonly runs: readonly RunState[] }> {
    return this.#post("/runs/attach", request) as Promise<{ runs: RunState[] }>;
  }

  cancelRun(runId: string, viewId: string): Promise<RunState> {
    return this.#post(`/runs/${encodeURIComponent(runId)}/cancel`, { viewId }) as Promise<RunState>;
  }

  live(request: LiveRequest): Promise<{ readonly sources: readonly LiveState[] }> {
    return this.#post("/live", request) as Promise<{ sources: LiveState[] }>;
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
          const ticket = await this.#ticketQuery();
          const result = (await this.#request(
            `${this.#base}/events/poll?${query()}&wait=25${ticket}`,
            { method: "GET" },
          )) as PollResult;
          backoff = 1_000;
          handlers.onStatus("live");
          if (result.snapshot) handlers.onSnapshot(result.snapshot);
          if (result.events.length > 0) handlers.onEvents(result.events);
          for (const message of result.ephemeral ?? []) handlers.onEphemeral?.(message);
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

    const open = async (): Promise<void> => {
      if (closed) return;
      if (typeof EventSource === "undefined" || !this.#streams) {
        void poll();
        return;
      }
      let ticket = "";
      try {
        ticket = await this.#ticketQuery();
      } catch {
        // No ticket, no stream: the page long-polls, which asks for its own tickets.
        void poll();
        return;
      }
      if (closed) return;
      const opened = new EventSource(`${this.#base}/events?${query()}${ticket}`);
      source = opened;
      // Silence after opening is a stream held back: poll at once, on the same cursor.
      let heard = false;
      const silent = setTimeout(() => {
        if (heard || closed || source !== opened) return;
        opened.close();
        source = undefined;
        handlers.onStatus("offline");
        if (!polling) void poll();
      }, STREAM_FIRST_MESSAGE_MS);
      const hear = (): void => {
        heard = true;
        clearTimeout(silent);
      };
      opened.addEventListener("ready", hear);
      opened.addEventListener("snapshot", hear);
      opened.addEventListener("mostra", hear);
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
      // Run and live updates carry no `id`, so they never move the stream's cursor.
      source.addEventListener("run", (event) => {
        const run = JSON.parse((event as MessageEvent<string>).data) as RunDelta;
        handlers.onEphemeral?.({ kind: "run", run });
      });
      source.addEventListener("live", (event) => {
        const live = JSON.parse((event as MessageEvent<string>).data) as LiveUpdate;
        handlers.onEphemeral?.({ kind: "live", live });
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
        } else if (this.#tickets) {
          // A ticket opens one connection: EventSource's own reconnect would present it again,
          // so a ticketed stream reconnects itself, with a new ticket.
          source?.close();
          source = undefined;
          retry = setTimeout(() => void open(), 1_000);
        }
      });
    };
    void open();
    return () => {
      closed = true;
      source?.close();
      if (retry !== undefined) clearTimeout(retry);
    };
  }
}
