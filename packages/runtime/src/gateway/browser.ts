/**
 * The browser protocol's interaction routes (INTERFACES §4, D106): `fields`, `submit`, `signal`,
 * `events` (SSE) and `events/poll` on an artifact's origin. They run behind the route table's
 * checks (session, CSRF, scope; `routes.ts`), act as the session's viewer (D104), and hand every
 * change to the interaction core, so a page and a host go through one path.
 */
import {
  BROWSER_PROTOCOL_REVISIONS,
  type Diagnostic,
  type EventRecord,
  FieldsRequest,
  RpcError,
  refusal,
  SignalRequest,
  type StreamSnapshot,
  SubmitRequest,
  ViewId,
} from "@mostra/protocol";
import type * as z from "zod";
import { type Interaction, type PageIdentity, SubmitConflict } from "../interaction/index.ts";
import type { Log } from "../log.ts";
import type { Capabilities } from "./capabilities.ts";
import { BASE_HEADERS, isRefusal, jsonResponse, readJsonObject } from "./http.ts";
import type { RouteContext } from "./routes.ts";

/** The largest `fields` body: a mutation may carry up to a whole document (DATA_MODEL §5). */
export const FIELDS_BODY_MAX: number = 17 * 1024 * 1024;

/** The largest `signal` body: a 64 KiB payload and its envelope. */
const SIGNAL_BODY_MAX: number = 80 * 1024;

/** How often an idle event stream sends a comment, so proxies and browsers keep it open. */
export const HEARTBEAT_MS = 15_000;

/** The longest a poll waits for an event (D47), in seconds. */
export const POLL_MAX_WAIT_S = 25;

/** Events per stream message batch. */
const BATCH = 100;

/** The HTTP status of each diagnostic a browser route answers. */
const STATUS: Readonly<Record<string, number>> = {
  MOSTRA_HOST_INVALID_PARAMS: 400,
  MOSTRA_FIELD_ID_INVALID: 400,
  MOSTRA_SUBMIT_SIGNAL_INVALID: 400,
  MOSTRA_FIELD_TOO_LARGE: 413,
  MOSTRA_SUBMIT_VIEW_INVALID: 403,
  MOSTRA_SUBMIT_ALREADY: 409,
  MOSTRA_SUBMIT_REVISION_MOVED: 409,
  MOSTRA_SUBMIT_POLICY_NONE: 409,
  MOSTRA_FIELD_MUTATION_ID_REUSED: 409,
  MOSTRA_HOST_CURSOR_COMPACTED: 410,
  MOSTRA_HOME_DISK_FULL: 507,
  MOSTRA_HOME_GONE: 503,
};

/** Options for {@link browserRoutes}. */
export interface BrowserRoutesOptions {
  readonly interaction: Interaction;
  readonly capabilities: Capabilities;
  readonly log: Log;
}

/** A refusal or a diagnostic as the browser gets it. */
function answer(
  diagnostic: Diagnostic,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ ...diagnostic, ...extra }, { status });
}

function malformed(message: string): Response {
  return answer(refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", message).diagnostic, 400);
}

/** Turns an interaction refusal into its response; anything else is a defect for `onError`. */
function failure(error: unknown): Response {
  if (error instanceof SubmitConflict) {
    return answer(error.diagnostic, 409, { submission: error.submission });
  }
  if (error instanceof RpcError)
    return answer(error.diagnostic, STATUS[error.diagnostic.code] ?? 500);
  throw error;
}

/** The revision a route was called at, when this gateway serves it (FAILURE_MODEL §7). */
function knownRevision(context: RouteContext): Response | undefined {
  const rev = context.params["rev"];
  if (rev !== undefined && (BROWSER_PROTOCOL_REVISIONS as readonly string[]).includes(rev))
    return undefined;
  return answer(
    refusal(
      "MOSTRA_HYGIENE_NOT_SERVED",
      `This gateway serves browser-protocol revisions ${BROWSER_PROTOCOL_REVISIONS.join(", ")}, not ${String(rev)}.`,
      404,
    ).diagnostic,
    404,
  );
}

/** Reads and validates a JSON body against a schema. */
async function body<T>(
  context: RouteContext,
  schema: z.ZodType<T>,
  maxBytes?: number,
): Promise<T | Response> {
  const raw = await readJsonObject(context.request, maxBytes);
  if (isRefusal(raw)) return answer(raw.diagnostic, raw.status);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return malformed(
    `The request body doesn't match the browser protocol at ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}.`,
  );
}

/** The `cursor` a stream or poll resumes from: the query, else `Last-Event-ID`. */
function cursorOf(request: Request): number | undefined | "invalid" {
  const url = new URL(request.url);
  const value = url.searchParams.get("cursor") ?? request.headers.get("last-event-id");
  if (value === null || value === "") return undefined;
  return /^(0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : "invalid";
}

/** A route handler. */
type Handler = (context: RouteContext) => Response | Promise<Response>;

/** The handlers of the browser protocol's interaction routes. */
export interface BrowserRoutes {
  readonly fields: Handler;
  readonly submit: Handler;
  readonly signal: Handler;
  readonly stream: Handler;
  readonly poll: Handler;
}

/** The browser protocol's interaction routes' handlers. */
export function browserRoutes(options: BrowserRoutesOptions): BrowserRoutes {
  const { interaction, capabilities, log } = options;

  const pageOf = (context: RouteContext): PageIdentity => {
    const session = context.session;
    const artifactId = context.artifactId;
    if (!session || artifactId === undefined) throw new Error("session route without a session");
    return { artifactId, viewerId: interaction.viewerOf(session.grant.viewerId) };
  };

  /** The view a stream or poll is for, checked against the page (D104). */
  const viewOf = (context: RouteContext, page: PageIdentity): Response | undefined => {
    const view = new URL(context.request.url).searchParams.get("view");
    if (view === null || !ViewId.is(view)) return malformed("The stream needs the page's `view`.");
    try {
      interaction.checkView(page, view);
    } catch (error) {
      return failure(error);
    }
    return undefined;
  };

  const fields = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, FieldsRequest, FIELDS_BODY_MAX);
    if (request instanceof Response) return request;
    try {
      return jsonResponse(
        interaction.mutate(pageOf(context), {
          viewId: request.viewId,
          scope: request.scope,
          mutationId: request.mutationId,
          baseRevision: Number(request.baseRevision),
          ops: request.ops,
        }),
      );
    } catch (error) {
      return failure(error);
    }
  };

  const submit = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, SubmitRequest);
    if (request instanceof Response) return request;
    try {
      return jsonResponse(
        interaction.submit(pageOf(context), {
          viewId: request.viewId,
          expectedRevision: Number(request.expectedRevision),
          channel: "artifact",
        }),
      );
    } catch (error) {
      return failure(error);
    }
  };

  const signal = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, SignalRequest, SIGNAL_BODY_MAX);
    if (request instanceof Response) return request;
    try {
      const cursor = interaction.signal(pageOf(context), {
        viewId: request.viewId,
        name: request.name,
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
      });
      return jsonResponse({ cursor });
    } catch (error) {
      return failure(error);
    }
  };

  /** Whether the session's link still works; a revoked link ends its streams. */
  const live = (context: RouteContext): boolean => {
    const tokenId = context.session?.grant.tokenId;
    return tokenId !== undefined && capabilities.grant(tokenId)?.live === true;
  };

  /** The page's events after a cursor; a compacted cursor gets a fresh snapshot instead. */
  const next = (
    page: PageIdentity,
    after: number,
  ): { events: EventRecord[]; cursor: number } | { snapshot: StreamSnapshot } => {
    try {
      const read = interaction.pageEvents(page, after, BATCH);
      return { events: read.events, cursor: Number(read.cursor) };
    } catch (error) {
      if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_HOST_CURSOR_COMPACTED") {
        return { snapshot: interaction.pageSnapshot(page) };
      }
      throw error;
    }
  };

  const stream = (context: RouteContext): Response => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const page = pageOf(context);
    const badView = viewOf(context, page);
    if (badView) return badView;
    const resume = cursorOf(context.request);
    if (resume === "invalid") return malformed("`cursor` must be an event cursor.");
    const encoder = new TextEncoder();
    let cleanup = (): void => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let cursor = resume ?? -1;
        let open = true;
        const send = (text: string): void => {
          if (open) controller.enqueue(encoder.encode(text));
        };
        const snapshot = (value: StreamSnapshot): void => {
          cursor = Number(value.cursor);
          send(`id: ${value.cursor}\nevent: snapshot\ndata: ${JSON.stringify(value)}\n\n`);
        };
        const close = (): void => {
          if (!open) return;
          open = false;
          unsubscribe();
          clearInterval(heartbeat);
          context.request.signal.removeEventListener("abort", close);
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        };
        const pump = (): void => {
          if (!open) return;
          if (!live(context)) {
            close();
            return;
          }
          try {
            for (;;) {
              const read = next(page, cursor);
              if ("snapshot" in read) {
                snapshot(read.snapshot);
                return;
              }
              for (const event of read.events) {
                send(`id: ${event.cursor}\nevent: mostra\ndata: ${JSON.stringify(event)}\n\n`);
              }
              cursor = read.cursor;
              // A page cut short by size is not the end: read on until nothing is left.
              if (read.events.length === 0) return;
            }
          } catch (error) {
            log.error("gateway.stream_failed", { error });
            close();
          }
        };
        const unsubscribe = interaction.onCommit(() => setImmediate(pump));
        const heartbeat = setInterval(() => send(": keepalive\n\n"), HEARTBEAT_MS);
        heartbeat.unref?.();
        context.request.signal.addEventListener("abort", close, { once: true });
        cleanup = close;
        send("retry: 2000\n\n");
        if (resume === undefined) snapshot(interaction.pageSnapshot(page));
        pump();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(body, {
      headers: {
        ...BASE_HEADERS,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  };

  const poll = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const page = pageOf(context);
    const badView = viewOf(context, page);
    if (badView) return badView;
    const resume = cursorOf(context.request);
    if (resume === "invalid") return malformed("`cursor` must be an event cursor.");
    const waitParam = new URL(context.request.url).searchParams.get("wait");
    const waitS = waitParam === null ? POLL_MAX_WAIT_S : Number(waitParam);
    if (!Number.isInteger(waitS) || waitS < 0 || waitS > POLL_MAX_WAIT_S) {
      return malformed(`\`wait\` must be a whole number of seconds from 0 to ${POLL_MAX_WAIT_S}.`);
    }
    if (resume === undefined) {
      const snapshot = interaction.pageSnapshot(page);
      return jsonResponse({ cursor: snapshot.cursor, events: [], snapshot });
    }
    const revoked = (): Response =>
      answer(
        refusal(
          "MOSTRA_HYGIENE_TOKEN_REVOKED",
          "The link this page came from was revoked or has expired.",
          410,
        ).diagnostic,
        410,
      );
    const once = () => {
      const read = next(page, resume);
      return "snapshot" in read
        ? { cursor: read.snapshot.cursor, events: [], snapshot: read.snapshot }
        : { cursor: String(read.cursor), events: read.events };
    };
    try {
      const first = once();
      if (first.events.length > 0 || "snapshot" in first || waitS === 0) return jsonResponse(first);
      let ended = false;
      const result = await new Promise<ReturnType<typeof once>>((resolve, reject) => {
        let done = false;
        const finish = (value?: ReturnType<typeof once>): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          unsubscribe();
          context.request.signal.removeEventListener("abort", aborted);
          resolve(value ?? once());
        };
        const aborted = (): void => finish(first);
        const unsubscribe = interaction.onCommit(() =>
          setImmediate(() => {
            if (done) return;
            // A revoked or expired link ends the poll before it reads anything more.
            if (!live(context)) {
              ended = true;
              finish(first);
              return;
            }
            try {
              const value = once();
              if (value.events.length > 0 || "snapshot" in value) finish(value);
            } catch (error) {
              done = true;
              clearTimeout(timer);
              unsubscribe();
              reject(error);
            }
          }),
        );
        const timer = setTimeout(() => finish(), waitS * 1000);
        context.request.signal.addEventListener("abort", aborted, { once: true });
      });
      // The link is checked again at the end: nothing read after it died leaves (HY-03).
      if (ended || !live(context)) return revoked();
      return jsonResponse(result);
    } catch (error) {
      return failure(error);
    }
  };

  return { fields, submit, signal, stream, poll };
}
