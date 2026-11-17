/**
 * The app channel's dispatcher (D175 item 4, `gateway/app.ts`): it runs a route's own spec after
 * the session and scope checks, and hands the route its caller, so the routes' rates (a hosted
 * home's per-address submissions) count each caller apart rather than every app request as one.
 */

import { describe, expect, it } from "vitest";
import { appCallerOf, appRoutesOf, dispatchAppRequest } from "../../src/gateway/app.ts";
import type { Capabilities } from "../../src/gateway/capabilities.ts";
import type { RouteContext, RouteSpec } from "../../src/gateway/routes.ts";
import { silentLog } from "../../src/log.ts";

const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";

/** The artifact routes the app channel names, each answering with the context it was given. */
function specs(seen: RouteContext[]): RouteSpec[] {
  const paths = [
    "/_mostra/v/:rev/fields",
    "/_mostra/v/:rev/submit",
    "/_mostra/v/:rev/signal",
    "/_mostra/v/:rev/call/:fn{.+}",
    "/_mostra/v/:rev/runs",
    "/_mostra/v/:rev/runs/attach",
    "/_mostra/v/:rev/runs/:run/cancel",
    "/_mostra/v/:rev/live",
    "/_mostra/v/:rev/respondents",
    "/_mostra/v/:rev/events/poll",
  ];
  return paths.map((path) => ({
    method: path.endsWith("events/poll") ? "GET" : "POST",
    path,
    intent: "mutation",
    auth: "session",
    ...(path.endsWith("submit") ? { scope: () => "submit" as const } : {}),
    handler: (context: RouteContext) => {
      seen.push(context);
      return Response.json({ ok: true });
    },
  }));
}

function capabilities(scopes: string[]): Capabilities {
  return {
    session: (secrets: readonly string[], origin: string, artifactId: string, mode: string) =>
      secrets[0] === "good" && origin === "mostra-app:" && artifactId === ARTIFACT && mode === "app"
        ? { id: "ses", csrf: "", mode: "app", grant: { tokenId: "tok_1", scopes } }
        : {
            status: 401,
            diagnostic: {
              code: "MOSTRA_HYGIENE_SESSION_MISSING",
              message: "no",
              severity: "error",
            },
          },
  } as unknown as Capabilities;
}

describe("the app channel's dispatcher (D175 item 4)", () => {
  it("hands every route its caller, so no two callers share a route's rates", async () => {
    const seen: RouteContext[] = [];
    const routes = appRoutesOf(specs(seen));
    const dispatch = { routes, capabilities: capabilities(["view", "submit"]), log: silentLog };
    const params = { artifactId: ARTIFACT, session: "good", route: "submit" as const, body: {} };
    expect((await dispatchAppRequest(dispatch, params, "account:acct_ada")).status).toBe(200);
    expect((await dispatchAppRequest(dispatch, params, "account:acct_bo")).status).toBe(200);
    expect(seen.map((context) => context.client)).toEqual(["account:acct_ada", "account:acct_bo"]);
  });

  it("names a hosted home's caller by the account its grant names, never by an address", () => {
    expect(appCallerOf(true, { accountId: "acct_ada" })).toBe("account:acct_ada");
    expect(appCallerOf(true, { accountId: "acct_bo" })).not.toBe(
      appCallerOf(true, { accountId: "acct_ada" }),
    );
    expect(appCallerOf(false, { accountId: "acct_ada" })).toBe("local");
  });

  it("checks the session and the route's scope before the route runs", async () => {
    const seen: RouteContext[] = [];
    const routes = appRoutesOf(specs(seen));
    const viewOnly = { routes, capabilities: capabilities(["view"]), log: silentLog };
    const submit = { artifactId: ARTIFACT, session: "good", route: "submit" as const };
    expect((await dispatchAppRequest(viewOnly, submit, "local")).body).toMatchObject({
      code: "MOSTRA_HYGIENE_SCOPE_DENIED",
    });
    expect(
      (await dispatchAppRequest(viewOnly, { ...submit, session: "guessed" }, "local")).status,
    ).toBe(401);
    expect(seen).toEqual([]);
  });
});
