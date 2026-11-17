"use client";

/**
 * The client runtime's way to Mostra inside an MCP Apps host (D175 item 6): the browser protocol's
 * routes, carried by the app-only tools through the host's `tools/call` to Mostra's MCP server,
 * which runs each through the gateway's own checks (`app/request`). Hooks never know which
 * transport they talk to. A long poll (`app_events`, up to 25 s) stands in for the event stream,
 * since a host relays requests, not streams; a call's batches arrive with its end.
 */
import {
  APP_TOOLS,
  BROWSER_PROTOCOL_REVISION,
  type CallLine,
  type CallRequest,
  type FieldsRequest,
  type LiveRequest,
  type LiveState,
  type McpCallToolResult,
  type MutationResult,
  type PollResult,
  type RosterForPage,
  type RunAttachRequest,
  type RunRequest,
  type RunState,
  type SignalRequest,
  type StreamSnapshot,
  type SubmissionSummary,
  type SubmitRequest,
} from "@mostra/protocol";
import { type DiagnosticLike, MostraError } from "./errors.ts";
import type { McpHostConnection } from "./mcp-host.ts";
import { NetworkError, type StreamHandlers, type Transport } from "./transport.ts";

/** How long one long poll waits for an event, in seconds (the gateway's longest). */
const POLL_WAIT_SECONDS = 25;

/** What an app tool answers: the route's status and body (`app/request`). */
interface RouteAnswer {
  readonly status: number;
  readonly body?: unknown;
  readonly lines?: readonly unknown[];
}

/** A tool result's error: the diagnostic its text carries (`{ "error": … }`), if any. */
function diagnosticOf(result: McpCallToolResult): DiagnosticLike | undefined {
  const text = result.content?.find((block) => block.type === "text")?.["text"];
  if (typeof text !== "string") return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: DiagnosticLike };
    return typeof parsed.error?.code === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** The browser protocol over the app-only tools. */
export class McpAppTransport implements Transport {
  readonly #host: McpHostConnection;
  readonly #artifactId: string;
  readonly #session: string;
  readonly #viewId: string;
  /** Whether a call's batches came at once: a degradation the page states (D175 item 7). */
  readonly #onBatched: (() => void) | undefined;
  /** Hears of a version newer than the page's, which only the full page's banner offers. */
  readonly #onNewer: ((version: number) => void) | undefined;

  constructor(
    host: McpHostConnection,
    handles: {
      readonly artifactId: string;
      readonly session: string;
      readonly viewId: string;
      readonly onBatched?: () => void;
      readonly onNewer?: (version: number) => void;
    },
  ) {
    this.#host = host;
    this.#artifactId = handles.artifactId;
    this.#session = handles.session;
    this.#viewId = handles.viewId;
    this.#onBatched = handles.onBatched;
    this.#onNewer = handles.onNewer;
  }

  /** Calls an app tool and answers the route's body, or throws its refusal. */
  async #route(tool: string, args: Readonly<Record<string, unknown>>): Promise<RouteAnswer> {
    let result: McpCallToolResult;
    try {
      result = await this.#host.callTool(tool, {
        artifactId: this.#artifactId,
        session: this.#session,
        revision: BROWSER_PROTOCOL_REVISION,
        ...args,
      });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : String(error));
    }
    if (result.isError === true) {
      // The instance refused the call itself (its diagnostic), or the host couldn't reach it.
      const diagnostic = diagnosticOf(result);
      if (diagnostic === undefined) throw new NetworkError(`${tool} failed in the host.`);
      throw new MostraError(diagnostic.code, diagnostic.message ?? diagnostic.code, { diagnostic });
    }
    const answer = result.structuredContent as RouteAnswer | undefined;
    if (answer === undefined || typeof answer.status !== "number") {
      throw new NetworkError(`${tool} answered nothing the page can read.`);
    }
    if (answer.status >= 400) {
      const diagnostic = (answer.body ?? {}) as Partial<DiagnosticLike>;
      if (typeof diagnostic.code !== "string") {
        throw new NetworkError(`The gateway answered ${answer.status}.`);
      }
      throw new MostraError(diagnostic.code, diagnostic.message ?? diagnostic.code, {
        status: answer.status,
        diagnostic: diagnostic as DiagnosticLike,
        body: diagnostic,
      });
    }
    return answer;
  }

  async #body<T>(tool: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    return (await this.#route(tool, args)).body as T;
  }

  async snapshot(): Promise<StreamSnapshot> {
    const result = await this.#body<PollResult>(APP_TOOLS.events, { view: this.#viewId, wait: 0 });
    if (!result.snapshot) throw new NetworkError("The gateway sent no snapshot.");
    return result.snapshot;
  }

  mutate(request: FieldsRequest): Promise<MutationResult> {
    return this.#body(APP_TOOLS.fields, { body: request });
  }

  submit(request: SubmitRequest): Promise<SubmissionSummary> {
    return this.#body(APP_TOOLS.submit, { body: request });
  }

  signal(request: SignalRequest): Promise<{ readonly cursor: string }> {
    return this.#body(APP_TOOLS.signal, { body: request });
  }

  async *call(fnId: string, request: CallRequest, signal?: AbortSignal): AsyncIterable<CallLine> {
    signal?.throwIfAborted();
    const answer = await this.#route(APP_TOOLS.call, { fnId, body: request });
    const lines = (answer.lines ?? []) as CallLine[];
    if (lines.filter((line) => "batch" in line).length > 1) this.#onBatched?.();
    for (const line of lines) {
      signal?.throwIfAborted();
      yield line;
    }
  }

  startRun(request: RunRequest): Promise<RunState> {
    return this.#body(APP_TOOLS.run, { body: request });
  }

  attachRuns(request: RunAttachRequest): Promise<{ readonly runs: readonly RunState[] }> {
    return this.#body(APP_TOOLS.runStatus, { body: request });
  }

  cancelRun(runId: string, viewId: string): Promise<RunState> {
    return this.#body(APP_TOOLS.runCancel, { runId, body: { viewId } });
  }

  live(request: LiveRequest): Promise<{ readonly sources: readonly LiveState[] }> {
    return this.#body(APP_TOOLS.live, { body: request });
  }

  respondents(request: { readonly viewId: string }): Promise<RosterForPage> {
    return this.#body(APP_TOOLS.respondents, { body: request });
  }

  subscribe(cursor: string | undefined, handlers: StreamHandlers): () => void {
    let closed = false;
    let last = cursor;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      let backoff = 1_000;
      while (!closed) {
        try {
          const result = await this.#body<PollResult>(APP_TOOLS.events, {
            view: this.#viewId,
            ...(last !== undefined ? { cursor: last } : {}),
            wait: POLL_WAIT_SECONDS,
          });
          if (closed) return;
          backoff = 1_000;
          handlers.onStatus("live");
          if (result.snapshot) {
            if (result.snapshot.latest) this.#onNewer?.(result.snapshot.latest.number);
            handlers.onSnapshot(result.snapshot);
          }
          for (const event of result.events) {
            if (event.type !== "version.published") continue;
            const number = (event.payload as { number?: unknown } | undefined)?.number;
            if (typeof number === "number") this.#onNewer?.(number);
          }
          if (result.events.length > 0) handlers.onEvents(result.events);
          for (const message of result.ephemeral ?? []) handlers.onEphemeral?.(message);
          last = result.cursor;
        } catch (error) {
          if (closed) return;
          if (
            error instanceof MostraError &&
            (error.code === "MOSTRA_HYGIENE_TOKEN_REVOKED" ||
              error.code === "MOSTRA_HYGIENE_SESSION_MISSING")
          ) {
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
    void poll();
    return () => {
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
    };
  }
}
