/**
 * The browser protocol's interaction routes (INTERFACES §4, D106): `fields`, `submit`, `signal`,
 * `events` (SSE) and `events/poll` on an artifact's origin. They run behind the route table's
 * checks (session, CSRF, scope; `routes.ts`), act as the session's viewer (D104), and hand every
 * change to the interaction core, so a page and a host go through one path.
 */
import {
  BROWSER_PROTOCOL_REVISIONS,
  ChooseRequest,
  type Diagnostic,
  type EphemeralMessage,
  type EventRecord,
  FieldsRequest,
  FollowRequest,
  RpcError,
  refusal,
  ShellSubmitRequest,
  SignalRequest,
  type StreamSnapshot,
  type SubmissionSummary,
  SubmitRequest,
  ViewId,
} from "@mostra/protocol";
import type * as z from "zod";
import {
  type EphemeralBus,
  type Interaction,
  type PageIdentity,
  SubmitConflict,
} from "../interaction/index.ts";
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
  MOSTRA_SUBMIT_CHANNEL_DENIED: 403,
  MOSTRA_FIELD_MUTATION_ID_REUSED: 409,
  MOSTRA_HOST_CURSOR_COMPACTED: 410,
  MOSTRA_HOME_DISK_FULL: 507,
  MOSTRA_HOME_GONE: 503,
  MOSTRA_HYGIENE_SCOPE_DENIED: 403,
};

/** Options for {@link browserRoutes}. */
export interface BrowserRoutesOptions {
  readonly interaction: Interaction;
  readonly capabilities: Capabilities;
  readonly log: Log;
  /**
   * The browser-protocol revisions served, oldest first: every revision Mostra ever shipped
   * (`BROWSER_PROTOCOL_REVISIONS`, VR-10), and in tests a newer one the release doesn't have yet.
   */
  readonly revisions?: readonly string[];
  /** A version of an artifact by number, for the carry-over route. */
  readonly versionOf: (
    artifactId: string,
    number: number,
  ) => { readonly id: string; readonly number: number } | undefined;
  /**
   * Run and live updates for pages (WP-08): a stream sends them as `event: run` and `event: live`
   * without an `id`, a poll as its `ephemeral` (LL-04). Absent: neither carries any.
   */
  readonly bus?: EphemeralBus;
  /** Tells a host with a `trustedControls` port that a trusted control was used (D108). */
  readonly activated: (event: {
    readonly artifactId: string;
    readonly control: "submit" | "choose";
    readonly viewerId: string;
    readonly viewId: string;
    readonly detail: Readonly<Record<string, string>>;
  }) => void;
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
function revisionServed(context: RouteContext, revisions: readonly string[]): Response | undefined {
  const rev = context.params["rev"];
  if (rev !== undefined && revisions.includes(rev)) return undefined;
  return answer(
    refusal(
      "MOSTRA_HYGIENE_NOT_SERVED",
      `This gateway serves browser-protocol revisions ${revisions.join(", ")}, not ${String(rev)}.`,
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

/**
 * The cursor a stream or poll resumes from: the newer of `?cursor=` and `Last-Event-ID`. An
 * `EventSource` reconnects to the URL it opened, query included, and adds `Last-Event-ID` with
 * the last event it received, which is never older; taking the newer never repeats an event
 * (Claude review finding 3).
 */
function cursorOf(request: Request): number | undefined | "invalid" {
  const url = new URL(request.url);
  let resume: number | undefined;
  for (const value of [url.searchParams.get("cursor"), request.headers.get("last-event-id")]) {
    if (value === null || value === "") continue;
    if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) return "invalid";
    resume = Math.max(resume ?? 0, Number(value));
  }
  return resume;
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
  /** The shell's trusted Submit (the `shell` channel, D40), on the shell origin. */
  readonly shellSubmit: Handler;
  /** The shell's trusted Choose (D65, D113), on the shell origin. */
  readonly choose: Handler;
  /** "Always follow this artifact" (D63), on the shell origin. */
  readonly follow: Handler;
  /** The viewer's answers a version doesn't carry over (D42, D109), on the shell origin. */
  readonly carry: Handler;
}

/** The browser protocol's interaction routes' handlers. */
export function browserRoutes(options: BrowserRoutesOptions): BrowserRoutes {
  const { interaction, capabilities, log } = options;
  const served: readonly string[] = options.revisions ?? BROWSER_PROTOCOL_REVISIONS;
  const knownRevision = (context: RouteContext): Response | undefined =>
    revisionServed(context, served);

  const pageOf = (context: RouteContext): PageIdentity => {
    const session = context.session;
    const artifactId = context.artifactId;
    if (!session || artifactId === undefined) throw new Error("session route without a session");
    return {
      artifactId,
      viewerId: interaction.viewerOf(session.grant.viewerId),
      // A page names only views its own link opened (Claude review finding 11).
      tokenId: session.grant.tokenId,
      scopes: session.grant.scopes,
    };
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

  /** The page's view, from the query (checked by {@link viewOf} first). */
  const viewIdOf = (context: RouteContext): string =>
    new URL(context.request.url).searchParams.get("view") ?? "";

  /** The most ephemeral messages a stream holds for a slow reader; older ones are dropped. */
  const EPHEMERAL_HELD = 1000;

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
    // Pull-based: a page of events is read only when the client took the last one, so a slow
    // reader or a long backlog never makes the gateway buffer more than a page, and every page
    // yields to the event loop (Claude review finding 6).
    let cursor = resume ?? -1;
    let open = true;
    let dirty = false;
    let wake: (() => void) | undefined;
    const unsubscribe = interaction.onCommit(() => {
      dirty = true;
      wake?.();
    });
    // Run and live updates for this view: lossy by design (a page reads what it missed), so a
    // slow reader drops the oldest rather than making the gateway hold more.
    // Held as messages and coalesced while the reader is behind (Opus review 12): a newer live
    // value replaces an older one of its source, and a run's deltas merge.
    const held: EphemeralMessage[] = [];
    const heldText = (): string =>
      held
        .splice(0)
        .map(
          (message) =>
            `event: ${message.kind}\ndata: ${JSON.stringify(message.kind === "run" ? message.run : message.live)}\n\n`,
        )
        .join("");
    const unlisten =
      options.bus?.listen(page.artifactId, viewIdOf(context), (message) => {
        options.bus?.coalesce(page.artifactId, viewIdOf(context), held, message);
        if (held.length > EPHEMERAL_HELD) held.splice(0, held.length - EPHEMERAL_HELD);
        wake?.();
      }) ?? (() => {});
    const close = (controller?: ReadableStreamDefaultController<Uint8Array>): void => {
      if (!open) return;
      open = false;
      unsubscribe();
      unlisten();
      wake?.();
      context.request.signal.removeEventListener("abort", aborted);
      try {
        controller?.close();
      } catch {
        // Already closed by the client.
      }
    };
    const aborted = (): void => close();
    context.request.signal.addEventListener("abort", aborted, { once: true });
    const snapshotText = (value: StreamSnapshot): string => {
      cursor = Number(value.cursor);
      return `id: ${value.cursor}\nevent: snapshot\ndata: ${JSON.stringify(value)}\n\n`;
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          let text = "retry: 2000\n\n";
          if (resume === undefined) text += snapshotText(interaction.pageSnapshot(page));
          controller.enqueue(encoder.encode(text));
        },
        async pull(controller) {
          await new Promise((resolve) => setImmediate(resolve));
          for (;;) {
            if (!open) return;
            if (!live(context)) {
              close(controller);
              return;
            }
            dirty = false;
            let read: ReturnType<typeof next>;
            try {
              read = next(page, cursor);
            } catch (error) {
              log.error("gateway.stream_failed", { error });
              close(controller);
              return;
            }
            if ("snapshot" in read) {
              controller.enqueue(encoder.encode(snapshotText(read.snapshot)));
              return;
            }
            cursor = read.cursor;
            const ephemeral = heldText();
            if (read.events.length > 0 || ephemeral !== "") {
              controller.enqueue(
                encoder.encode(
                  read.events
                    .map(
                      (event) =>
                        `id: ${event.cursor}\nevent: mostra\ndata: ${JSON.stringify(event)}\n\n`,
                    )
                    .join("") + ephemeral,
                ),
              );
              return;
            }
            // Nothing new: wait for a commit or an update, or send a heartbeat after a while.
            if (dirty || held.length > 0) continue;
            const woke = await new Promise<"commit" | "heartbeat">((resolve) => {
              const timer = setTimeout(() => resolve("heartbeat"), HEARTBEAT_MS);
              timer.unref?.();
              wake = () => {
                clearTimeout(timer);
                resolve("commit");
              };
              if (held.length > 0) wake();
            });
            wake = undefined;
            if (woke === "heartbeat" && open) {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              return;
            }
          }
        },
        cancel() {
          close();
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );
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
    const viewId = viewIdOf(context);
    const bus = options.bus;
    // Polling views collect their run and live updates between polls (LL-04).
    // Taking what is queued also starts the queue, so updates during the wait are kept.
    let early = bus?.drain(page.artifactId, viewId) ?? [];
    const withEphemeral = <T extends object>(value: T): T & { ephemeral?: unknown[] } => {
      const ephemeral = [...early, ...(bus?.drain(page.artifactId, viewId) ?? [])];
      early = [];
      return ephemeral.length > 0 ? { ...value, ephemeral } : value;
    };
    if (resume === undefined) {
      const snapshot = interaction.pageSnapshot(page);
      return jsonResponse(withEphemeral({ cursor: snapshot.cursor, events: [], snapshot }));
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
      if (first.events.length > 0 || "snapshot" in first || waitS === 0 || early.length > 0) {
        return jsonResponse(withEphemeral(first));
      }
      let ended = false;
      const stopWaiting = new AbortController();
      const result = await new Promise<ReturnType<typeof once>>((resolve, reject) => {
        let done = false;
        const finish = (value?: ReturnType<typeof once>): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          unsubscribe();
          context.request.signal.removeEventListener("abort", aborted);
          // A failing read here (the ledger closing at shutdown, say) answers this request; it
          // never escapes the timer as an uncaught exception (Claude review finding 8).
          try {
            resolve(value ?? once());
          } catch (error) {
            reject(error);
          }
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
        // A run or live update for this view answers the poll too.
        void bus?.wait(page.artifactId, viewId, waitS * 1000, stopWaiting.signal).then(() => {
          if (!done) finish(first);
        });
      });
      stopWaiting.abort();
      // The link is checked again at the end: nothing read after it died leaves (HY-03).
      if (ended || !live(context)) return revoked();
      return jsonResponse(withEphemeral(result));
    } catch (error) {
      return failure(error);
    }
  };

  // ── The shell's own routes (WP-07) ─────────────────────────────────────────────────────
  // They run on the shell origin behind the shell's session, its exact Origin and its CSRF
  // token, none of which an artifact's page holds: only the trusted page can call them (SH-02).

  const shellSubmit = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, ShellSubmitRequest);
    if (request instanceof Response) return request;
    const page = pageOf(context);
    let submission: SubmissionSummary & { readonly duplicate?: true };
    try {
      submission = interaction.submit(page, {
        viewId: request.viewId,
        expectedRevision: Number(request.expectedRevision),
        channel: "shell",
      });
    } catch (error) {
      return failure(error);
    }
    if (submission.duplicate !== true) {
      options.activated({
        artifactId: page.artifactId,
        control: "submit",
        viewerId: page.viewerId,
        viewId: request.viewId,
        detail: { submissionId: submission.id },
      });
    }
    return jsonResponse(submission);
  };

  const choose = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, ChooseRequest);
    if (request instanceof Response) return request;
    const page = pageOf(context);
    try {
      const result = interaction.choose(page, {
        viewId: request.viewId,
        mutationId: request.mutationId,
        baseRevision: Number(request.baseRevision),
        reviewSetId: request.reviewSetId,
        candidateId: request.candidateId,
        ...(request.label !== undefined ? { label: request.label } : {}),
      });
      if (result.applied.length > 0) {
        options.activated({
          artifactId: page.artifactId,
          control: "choose",
          viewerId: page.viewerId,
          viewId: request.viewId,
          detail: { reviewSetId: request.reviewSetId, candidateId: request.candidateId },
        });
      }
      return jsonResponse(result);
    } catch (error) {
      return failure(error);
    }
  };

  const follow = async (context: RouteContext): Promise<Response> => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const request = await body(context, FollowRequest);
    if (request instanceof Response) return request;
    try {
      interaction.setFollowing(pageOf(context), request.follow);
      return jsonResponse({ follow: request.follow });
    } catch (error) {
      return failure(error);
    }
  };

  const carry = (context: RouteContext): Response => {
    const refused = knownRevision(context);
    if (refused) return refused;
    const page = pageOf(context);
    const wanted = Number(new URL(context.request.url).searchParams.get("version"));
    if (!Number.isSafeInteger(wanted) || wanted < 1) {
      return malformed("`version` must be a version number.");
    }
    // A link that names a version learns nothing of another (D97 item 9).
    const pinned = context.session?.grant.pinnedVersion;
    if (pinned !== undefined && wanted !== pinned) {
      return answer(
        refusal("MOSTRA_HYGIENE_SCOPE_DENIED", `This link opens version ${pinned} only.`)
          .diagnostic,
        403,
      );
    }
    const version = options.versionOf(page.artifactId, wanted);
    if (!version) {
      return answer(
        refusal("MOSTRA_HYGIENE_NOT_SERVED", `This artifact has no version ${wanted}.`, 404)
          .diagnostic,
        404,
      );
    }
    try {
      return jsonResponse(interaction.carryOver(page, version));
    } catch (error) {
      return failure(error);
    }
  };

  return { fields, submit, signal, stream, poll, shellSubmit, choose, follow, carry };
}
