/**
 * Route declarations (D96): every gateway endpoint declares what it is for (its intent), whether
 * it needs a session, whether it takes a capability token or ticket, and the scope it needs. One
 * runner applies the checks in one order for all of them, so an endpoint a later package adds is
 * behind the same checks by construction:
 *
 * 1. the `Origin` and content type its intent needs (`checkRequest`; the envelope was checked
 *    before routing);
 * 2. the rate limit, on token paths;
 * 3. the session, bound to this origin, with a live token (401, 410);
 * 4. the session's CSRF token, on mutations;
 * 5. the scope.
 *
 * A route declared without a handler is a browser-protocol path a later package serves
 * (INTERFACES §4): it answers 501 once every check has passed.
 */
import {
  type CapabilityScope,
  checkRequest,
  type Refusal,
  type RequestIntent,
  type RequestPolicy,
  refusal,
  scopeAllows,
} from "@mostra/protocol";
import type { Context, Hono } from "hono";
import type { Log } from "../log.ts";
import type { Capabilities, ResolvedSession } from "./capabilities.ts";
import {
  cookieValues,
  type HttpEnv,
  headerPairs,
  isRefusal,
  refusalResponse,
  wantsDocument,
} from "./http.ts";

/** What a route needs before its handler runs. */
export interface RouteSpec {
  readonly method: "GET" | "POST";
  /** A Hono path pattern. */
  readonly path: string;
  readonly intent: RequestIntent;
  /** `session`: a session of this origin, for the listener's artifact, is required. */
  readonly auth: "none" | "session";
  /** The route takes a capability token or a frame ticket: failures are rate-limited (D97 item 8). */
  readonly tokenPath?: boolean;
  /**
   * The scope the request needs beyond `view`, from its path parameters. `any-action` means some
   * action scope; the handler checks the exact function (D96).
   */
  readonly scope?: (params: Readonly<Record<string, string>>) => CapabilityScope | "any-action";
  /** Serves the request. Absent: declared for a later package, answered with 501. */
  readonly handler?: (context: RouteContext) => Response | Promise<Response>;
}

/** What a handler receives. */
export interface RouteContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  /** The artifact this request is for; always set on `auth: "session"` routes. */
  readonly artifactId: string | undefined;
  /** The session, for `auth: "session"` routes. */
  readonly session?: ResolvedSession;
  /** Whether the client is navigating (answer with HTML rather than JSON). */
  readonly document: boolean;
}

/** What a listener contributes to every route's checks. */
export interface ListenerChecks {
  /** The listener's origin and Host allowlist, known once it is bound. */
  readonly policy: () => RequestPolicy;
  readonly capabilities: Capabilities;
  readonly log: Log;
  /** The session cookie's name on this listener: `mostra-<port>` (D98 item 1). */
  readonly cookieName: () => string;
  /** Who may frame this listener's refusal pages: `'none'` on the shell, the shell's origin on artifacts. */
  readonly frameAncestors: () => string;
  /** The artifact a request is for: fixed on an artifact's listener, from the path on the shell. */
  readonly artifactOf: (params: Readonly<Record<string, string>>) => string | undefined;
}

/** Logs a refusal without any of the request's capability material, and answers it. */
export function refuse(
  checks: Pick<ListenerChecks, "log" | "policy" | "frameAncestors">,
  refused: Refusal & { readonly retryAfter?: number },
  request: { readonly method: string; readonly path: string; readonly document: boolean },
): Response {
  checks.log.warn("gateway.refused", {
    code: refused.diagnostic.code,
    status: refused.status,
    method: request.method,
    // The path never carries a token (links keep it in the fragment); a ticket query is redacted
    // by the log's redactor all the same.
    path: request.path,
    origin: checks.policy().origin,
  });
  return refusalResponse(refused, {
    document: request.document,
    method: request.method,
    frameAncestors: checks.frameAncestors(),
  });
}

const NOT_SERVED_YET = (method: string, path: string): Refusal =>
  refusal(
    "MOSTRA_HYGIENE_NOT_SERVED",
    `This Mostra release doesn't serve ${method} ${path} yet.`,
    501,
  );

/** Mounts routes on a listener's Hono app behind the common checks. */
export function mount(
  app: Hono<HttpEnv>,
  checks: ListenerChecks,
  routes: readonly RouteSpec[],
): void {
  for (const route of routes) {
    const handle = async (c: Context<HttpEnv>): Promise<Response> => {
      const request = c.req.raw;
      const url = new URL(request.url);
      const document = wantsDocument(request.headers);
      const meta = { method: request.method, path: url.pathname, document };
      const params = c.req.param() as Record<string, string>;
      const incoming = c.env.incoming;
      const facts = {
        method: request.method,
        target: incoming.url ?? url.pathname,
        headers: headerPairs(incoming),
      };
      // 1. Origin and content type; CSRF comes once the session is known.
      const policy = checks.policy();
      const early = checkRequest(policy, {
        ...facts,
        intent: route.intent === "mutation" ? "exchange" : route.intent,
      });
      if (early) return refuse(checks, early, meta);
      const artifactId = checks.artifactOf(params);
      if (route.auth === "session" && artifactId === undefined) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "No artifact is served at this path."),
          meta,
        );
      }
      // 2. The rate limit holds every attempt while too many failed.
      if (route.tokenPath && artifactId !== undefined) {
        const limited = checks.capabilities.limited(artifactId);
        if (limited) return refuse(checks, limited, meta);
      }
      // 3. The session.
      let session: ResolvedSession | undefined;
      if (route.auth === "session" && artifactId !== undefined) {
        const resolved = checks.capabilities.session(
          cookieValues(request.headers.get("cookie"), checks.cookieName()),
          policy.origin,
          artifactId,
        );
        if (isRefusal(resolved)) return refuse(checks, resolved, meta);
        session = resolved;
        // 4. The CSRF token of this session.
        if (route.intent === "mutation") {
          const csrf = checkRequest(policy, { ...facts, intent: "mutation", csrf: session.csrf });
          if (csrf) return refuse(checks, csrf, meta);
        }
        // 5. The scope.
        const needed = route.scope?.(params);
        const allowed =
          needed === undefined
            ? true
            : needed === "any-action"
              ? session.grant.scopes.some((scope) => scope.startsWith("action:"))
              : scopeAllows(session.grant.scopes, needed);
        if (!allowed) {
          return refuse(
            checks,
            refusal(
              "MOSTRA_HYGIENE_SCOPE_DENIED",
              `This link doesn't carry the ${needed === "any-action" ? "action" : needed} scope.`,
            ),
            meta,
          );
        }
      }
      if (!route.handler) return refuse(checks, NOT_SERVED_YET(request.method, url.pathname), meta);
      return route.handler({
        request,
        params,
        artifactId,
        ...(session ? { session } : {}),
        document,
      });
    };
    if (route.method === "GET") app.get(route.path, handle);
    else app.post(route.path, handle);
  }
}
