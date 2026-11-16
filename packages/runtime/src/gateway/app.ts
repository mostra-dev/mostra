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
  type Refusal,
  refusal,
  scopeAllows,
} from "@mostra/protocol";
import type { Log } from "../log.ts";
import type { Capabilities } from "./capabilities.ts";
import { isRefusal } from "./http.ts";
import type { RouteContext, RouteSpec } from "./routes.ts";

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
const ROUTE_TIMEOUT_MS = 10 * 60_000;

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
  // The scope, as the HTTP runner checks it (routes.ts, step 5).
  const needed = spec.scope?.(routeParams);
  const allowed =
    needed === undefined
      ? true
      : needed === "any-action"
        ? session.grant.scopes.some((scope) => scope.startsWith("action:"))
        : scopeAllows(session.grant.scopes, needed);
  if (!allowed) {
    return refused(
      refusal(
        "MOSTRA_HYGIENE_SCOPE_DENIED",
        `This link doesn't carry the ${needed === "any-action" ? "action" : needed} scope.`,
      ),
    );
  }
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
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
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
      client: undefined,
    };
    const response = await spec.handler(context);
    return await readAnswer(response);
  } finally {
    clearTimeout(timer);
  }
}

/** A route's answer as the app channel returns it: its JSON body, or a call's NDJSON lines. */
async function readAnswer(response: Response): Promise<AppRequestResult> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (type.includes("ndjson")) {
    const lines = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown);
    return { status: response.status, lines };
  }
  if (text.trim() === "") return { status: response.status };
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}
