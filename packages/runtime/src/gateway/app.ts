/**
 * The app channel (D175 item 4): an inline page, which an MCP Apps host shows, reaches the same
 * browser-protocol routes a browser page does, through the gateway's own route table, with an app
 * session in place of a cookie. `app/request` hands each request to its route's handler after the
 * same session and scope checks the HTTP runner applies (`routes.ts`, steps 3 and 5). The HTTP
 * envelope's checks (Host, Origin, CSRF) guard a browser's ambient cookie, which the app channel
 * doesn't have: its session secret travels only in the call.
 */
import {
  type AppRequestParams,
  type AppRequestResult,
  type AppRoute,
  BROWSER_PROTOCOL_REVISION,
  createDiagnostic,
  type Refusal,
  refusal,
} from "@mostra/protocol";
import type { Log } from "../log.ts";
import type { Capabilities } from "./capabilities.ts";
import { isRefusal } from "./http.ts";
import { type RouteContext, type RouteSpec, scopeRefusal } from "./routes.ts";

/** The origin an app session is bound to: none of a browser's, so no browser can present it. */
export const APP_SESSION_ORIGIN = "mostra-app:";

/** The base a page's route is read at; nothing is ever fetched from it. */
const APP_BASE = "http://app.mostra.invalid";

/** Each app route's path in the gateway's route table (INTERFACES §4). */
const ROUTE_PATHS: Readonly<Record<AppRoute, string>> = {
  fields: "/_mostra/v/:rev/fields",
  submit: "/_mostra/v/:rev/submit",
  signal: "/_mostra/v/:rev/signal",
  call: "/_mostra/v/:rev/call/:fn{.+}",
  runs: "/_mostra/v/:rev/runs",
  "runs/attach": "/_mostra/v/:rev/runs/attach",
  "runs/cancel": "/_mostra/v/:rev/runs/:run/cancel",
  live: "/_mostra/v/:rev/live",
  respondents: "/_mostra/v/:rev/respondents",
  "events/poll": "/_mostra/v/:rev/events/poll",
};

/** The longest a route may take for the app channel: a long poll's 25 s and a call's run. */
/**
 * How long one app request may take: under a chat host's own limit on a tool call (about a
 * minute), so a page always hears an answer; a long poll waits at most 25 s of it.
 */
const ROUTE_TIMEOUT_MS = 55_000;
/**
 * How long a plain call may run before it is stopped (review finding Fable 6): a call isn't
 * durable, so past the host's limit its result would be lost while it ran on unobserved. Long work
 * is an action run, which outlives any call.
 */
export const APP_CALL_MS = 45_000;

/** The app routes of the gateway's artifact routes, by name. */
export function appRoutesOf(specs: readonly RouteSpec[]): ReadonlyMap<AppRoute, RouteSpec> {
  const routes = new Map<AppRoute, RouteSpec>();
  for (const [name, path] of Object.entries(ROUTE_PATHS) as [AppRoute, string][]) {
    const spec = specs.find((candidate) => candidate.path === path);
    if (!spec) throw new Error(`The gateway has no route ${path} for the app channel.`);
    routes.set(name, spec);
  }
  return routes;
}

/**
 * Who calls through the app channel, as routes and admissions count callers: on a hosted home the
 * account the session's grant names, since every user of one chat host calls from its servers'
 * addresses; on a home of one person's, that home.
 */
export function appCallerOf(
  hosted: boolean,
  attributes: Readonly<Record<string, unknown>>,
): string {
  const account = hosted ? attributes["accountId"] : undefined;
  return typeof account === "string" ? `account:${account}` : "local";
}

/** What {@link dispatchAppRequest} needs. */
export interface AppDispatch {
  readonly routes: ReadonlyMap<AppRoute, RouteSpec>;
  readonly capabilities: Capabilities;
  readonly log: Log;
}

/**
 * Runs one route for an app session: the session (live, of this artifact, made for the app
 * channel), the route's scope, then its handler on a request built as a browser's would be.
 */
export async function dispatchAppRequest(
  dispatch: AppDispatch,
  params: AppRequestParams,
  /**
   * Who calls, as the routes' rates count callers (`RouteContext.client`): an app request has no
   * address of its own, so the caller names it, and no two callers share one count.
   */
  caller: string,
): Promise<AppRequestResult> {
  // A refusal is logged as the HTTP runner logs one, without any of the request's secrets.
  const refused = (answer: Refusal): AppRequestResult => {
    dispatch.log.warn("gateway.app_refused", {
      code: answer.diagnostic.code,
      status: answer.status,
      route: params.route,
      artifactId: params.artifactId,
    });
    return { status: answer.status, body: answer.diagnostic };
  };
  const spec = dispatch.routes.get(params.route);
  if (!spec) return refused(refusal("MOSTRA_HYGIENE_NOT_SERVED", "No such app route."));
  // The session: one made for the app channel, of this artifact, whose link still works.
  const session = dispatch.capabilities.session(
    [params.session],
    APP_SESSION_ORIGIN,
    params.artifactId,
    "app",
  );
  if (isRefusal(session)) return refused(session);
  const rev = params.revision ?? BROWSER_PROTOCOL_REVISION;
  const routeParams: Record<string, string> = { rev };
  if (params.route === "call") {
    if (params.fnId === undefined) {
      return refused(refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "A call names its fnId."));
    }
    routeParams["fn"] = params.fnId;
  }
  if (params.route === "runs/cancel") {
    if (params.runId === undefined) {
      return refused(refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "A cancel names its runId."));
    }
    routeParams["run"] = params.runId;
  }
  // The scope, by the HTTP runner's own rule (routes.ts, step 5).
  const denied = scopeRefusal(spec, routeParams, session.grant.scopes);
  if (denied) return refused(denied);
  if (!spec.handler) {
    return refused(
      refusal(
        "MOSTRA_HYGIENE_NOT_SERVED",
        `This Mostra release doesn't serve ${params.route} yet.`,
      ),
    );
  }
  const path = ROUTE_PATHS[params.route]
    .replace(":rev", encodeURIComponent(rev))
    .replace(":fn{.+}", encodeURIComponent(params.fnId ?? ""))
    .replace(":run", encodeURIComponent(params.runId ?? ""));
  const url = new URL(`${APP_BASE}${path}`);
  if (params.route === "events/poll") {
    if (params.view !== undefined) url.searchParams.set("view", params.view);
    if (params.cursor !== undefined) url.searchParams.set("cursor", params.cursor);
    url.searchParams.set("wait", String(params.wait ?? 0));
  }
  const controller = new AbortController();
  const limit = params.route === "call" ? APP_CALL_MS : ROUTE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), limit);
  });
  try {
    const request = new Request(url, {
      method: spec.method,
      signal: controller.signal,
      ...(spec.method === "POST"
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(params.body ?? {}),
          }
        : {}),
    });
    const context: RouteContext = {
      request,
      params: routeParams,
      artifactId: params.artifactId,
      session,
      document: false,
      remote: undefined,
      client: caller,
    };
    const handler = spec.handler;
    const answered = (async () => readAnswer(await handler(context), dispatch.log))();
    const outcome = await Promise.race([answered, late]);
    if (outcome !== "late") return outcome;
    // Past the bound: the call is stopped (its function hears its abort signal), and the page
    // told why, rather than a host ending the tool call with nothing.
    controller.abort();
    answered.catch(() => undefined);
    return refused({
      status: 504,
      diagnostic:
        params.route === "call"
          ? createDiagnostic("MOSTRA_TARGET_CALL_TOO_LONG", {
              message: `The call of ${params.fnId ?? "a server function"} didn't finish within ${APP_CALL_MS / 1000} seconds, so it was stopped.`,
            })
          : createDiagnostic("MOSTRA_HOST_TIMEOUT", {
              message: `The app request ${params.route} didn't finish within ${limit / 1000} seconds.`,
            }),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A route's answer as the app channel returns it: its JSON body, or a call's NDJSON lines. A line
 * that isn't JSON is logged and left out, never the whole answer lost (review finding Opus 16).
 */
async function readAnswer(response: Response, log: Log): Promise<AppRequestResult> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (type.includes("ndjson")) {
    const lines: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        lines.push(JSON.parse(line) as unknown);
      } catch {
        log.warn("gateway.app_line_unreadable", { length: line.length });
      }
    }
    return { status: response.status, lines };
  }
  if (text.trim() === "") return { status: response.status };
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}
