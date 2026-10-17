/**
 * The browser protocol's action and live routes (INTERFACES §4, WP-08): `call/{fnId}` (a plain
 * server-function call, its result streamed as NDJSON), `runs` (start or join a durable run),
 * `runs/attach` (read runs and follow them), `runs/{id}/cancel`, and `live` (read live sources
 * and keep them produced). They run behind the route table's checks (session, CSRF, Origin, scope;
 * D96, D97 item 4), and each function a request names is checked against the link's
 * `action:<name>` scopes. Mostra's cookies never reach a worker: only the call's arguments and its
 * context (viewer, view, run) do (D38).
 */
import {
  CallRequest,
  type CapabilityScope,
  type Diagnostic,
  LiveRequest,
  RpcError,
  RunAttachRequest,
  RunCancelRequest,
  RunRequest,
  refusal,
  scopeAllows,
} from "@mostra/protocol";
import type * as z from "zod";
import type { Actions } from "../actions/index.ts";
import type { Interaction, PageIdentity } from "../interaction/index.ts";
import type { Live } from "../live/index.ts";
import type { Log } from "../log.ts";
import { BASE_HEADERS, isRefusal, jsonResponse, readJsonObject } from "./http.ts";
import type { RouteContext } from "./routes.ts";

/** The largest request body: 16 MiB of arguments and the envelope. */
const ACTION_BODY_MAX: number = 17 * 1024 * 1024;

/** The HTTP status of each diagnostic these routes answer. */
const STATUS: Readonly<Record<string, number>> = {
  MOSTRA_HOST_INVALID_PARAMS: 400,
  MOSTRA_ACTION_UNKNOWN_FUNCTION: 404,
  MOSTRA_ACTION_RUN_NOT_FOUND: 404,
  MOSTRA_ACTION_TOO_LARGE: 413,
  MOSTRA_ACTION_UNSERIALIZABLE: 400,
  MOSTRA_SUBMIT_VIEW_INVALID: 403,
  MOSTRA_HYGIENE_SCOPE_DENIED: 403,
  MOSTRA_RUNTIME_WORKER_PARKED: 503,
  MOSTRA_RUNTIME_WORKER_CRASHED: 503,
  MOSTRA_HOME_DISK_FULL: 507,
  MOSTRA_HOME_GONE: 503,
};

type Handler = (context: RouteContext) => Response | Promise<Response>;

/** The handlers. */
export interface ActionRoutes {
  readonly call: Handler;
  readonly runs: Handler;
  readonly attach: Handler;
  readonly cancel: Handler;
  readonly live: Handler;
}

/** Options for {@link actionRoutes}. */
export interface ActionRoutesOptions {
  readonly interaction: Interaction;
  readonly actions: Actions;
  readonly live: Live;
  readonly log: Log;
  /** The browser-protocol revisions served. */
  readonly revisions: readonly string[];
}

function answer(diagnostic: Diagnostic, status: number): Response {
  return jsonResponse({ ...diagnostic }, { status });
}

function failure(error: unknown): Response {
  if (error instanceof RpcError)
    return answer(error.diagnostic, STATUS[error.diagnostic.code] ?? 500);
  throw error;
}

function denied(fnId: string): Response {
  return answer(
    refusal(
      "MOSTRA_HYGIENE_SCOPE_DENIED",
      `This link may not run the server function ${fnId.slice(0, 200)}.`,
      403,
    ).diagnostic,
    403,
  );
}

async function body<T>(context: RouteContext, schema: z.ZodType<T>): Promise<T | Response> {
  const raw = await readJsonObject(context.request, ACTION_BODY_MAX);
  if (isRefusal(raw)) return answer(raw.diagnostic, raw.status);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  return answer(
    refusal(
      "MOSTRA_HYGIENE_REQUEST_MALFORMED",
      `The request body doesn't match the browser protocol at ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}.`,
    ).diagnostic,
    400,
  );
}

/** The routes' handlers. */
export function actionRoutes(options: ActionRoutesOptions): ActionRoutes {
  const { interaction, actions, live, log } = options;

  const served = (context: RouteContext): Response | undefined => {
    const rev = context.params["rev"];
    if (rev !== undefined && options.revisions.includes(rev)) return undefined;
    return answer(
      refusal(
        "MOSTRA_HYGIENE_NOT_SERVED",
        `This gateway serves browser-protocol revisions ${options.revisions.join(", ")}, not ${String(rev)}.`,
        404,
      ).diagnostic,
      404,
    );
  };

  const pageOf = (context: RouteContext): PageIdentity => {
    const session = context.session;
    const artifactId = context.artifactId;
    if (!session || artifactId === undefined) throw new Error("session route without a session");
    return {
      artifactId,
      viewerId: interaction.viewerOf(session.grant.viewerId),
      tokenId: session.grant.tokenId,
      scopes: session.grant.scopes,
    };
  };

  const may = (page: PageIdentity, fnId: string): boolean =>
    scopeAllows(page.scopes ?? [], `action:${fnId}` as CapabilityScope);

  return {
    async call(context) {
      const refused = served(context);
      if (refused) return refused;
      const fnId = context.params["fn"] ?? "";
      const request = await body(context, CallRequest);
      if (request instanceof Response) return request;
      const page = pageOf(context);
      // The route checked `action:<fnId>` already (D97 item 4); this keeps the rule in one place.
      if (!may(page, fnId)) return denied(fnId);
      let lines: AsyncIterable<unknown>;
      const abort = new AbortController();
      context.request.signal.addEventListener("abort", () => abort.abort(), { once: true });
      try {
        lines = await actions.call(
          page,
          { viewId: request.viewId, fnId, args: request.args },
          abort.signal,
        );
      } catch (error) {
        return failure(error);
      }
      const encoder = new TextEncoder();
      const iterator = lines[Symbol.asyncIterator]();
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const next = await iterator.next();
              if (next.done) {
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
            } catch (error) {
              log.error("gateway.call_failed", { error });
              controller.error(error);
            }
          },
          cancel() {
            abort.abort();
            void iterator.return?.();
          },
        },
        new CountQueuingStrategy({ highWaterMark: 1 }),
      );
      return new Response(stream, {
        headers: {
          ...BASE_HEADERS,
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    },

    async runs(context) {
      const refused = served(context);
      if (refused) return refused;
      const request = await body(context, RunRequest);
      if (request instanceof Response) return request;
      const page = pageOf(context);
      if (!may(page, request.fnId)) return denied(request.fnId);
      try {
        return jsonResponse(
          actions.startRun(page, {
            viewId: request.viewId,
            fnId: request.fnId,
            args: request.args,
            ...(request.key !== undefined ? { key: request.key } : {}),
            clientKey: request.clientKey,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },

    async attach(context) {
      const refused = served(context);
      if (refused) return refused;
      const request = await body(context, RunAttachRequest);
      if (request instanceof Response) return request;
      const page = pageOf(context);
      for (const entry of request.keyed ?? [])
        if (!may(page, entry.fnId)) return denied(entry.fnId);
      try {
        const runs = actions
          .attach(page, {
            viewId: request.viewId,
            ...(request.runIds ? { runIds: request.runIds } : {}),
            ...(request.keyed ? { keyed: request.keyed } : {}),
          })
          // A link sees only the runs of functions it may run.
          .filter((run) => may(page, run.fnId));
        return jsonResponse({ runs });
      } catch (error) {
        return failure(error);
      }
    },

    async cancel(context) {
      const refused = served(context);
      if (refused) return refused;
      const request = await body(context, RunCancelRequest);
      if (request instanceof Response) return request;
      const page = pageOf(context);
      const runId = context.params["run"] ?? "";
      try {
        const row = interaction.runFor(page, request.viewId, runId);
        if (!may(page, row.action)) return denied(row.action);
        return jsonResponse(actions.cancel(page, request.viewId, runId));
      } catch (error) {
        return failure(error);
      }
    },

    async live(context) {
      const refused = served(context);
      if (refused) return refused;
      const request = await body(context, LiveRequest);
      if (request instanceof Response) return request;
      try {
        return jsonResponse({ sources: live.read(pageOf(context), request) });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
