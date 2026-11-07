import {
  AccountResolution,
  AuthenticatedCredential,
  defineOperator,
  LimitAnswer,
  LinkHost,
  LinkPolicy,
  OPERATOR_REVISION,
  PushedAnswer,
  RoutingAnswer,
  SignInIdentity,
} from "@mostra/protocol/operator";
import { describe, expect, it } from "vitest";

describe("the operator boundary's answers (INTERFACES §18.6, HO-09)", () => {
  it("takes every answer the types allow", () => {
    expect(LimitAnswer.safeParse({ allowed: true }).success).toBe(true);
    expect(
      LimitAnswer.safeParse({
        allowed: false,
        code: "PLAN_LIMIT",
        message: "Limit reached.",
        retryAfterMs: 60_000,
        cacheForMs: 5_000,
      }).success,
    ).toBe(true);
    expect(
      AccountResolution.safeParse({ account: "acme-1", name: "Ada", status: "active" }).success,
    ).toBe(true);
    expect(
      AccountResolution.safeParse({ step: { url: "https://operator.example/terms" } }).success,
    ).toBe(true);
    expect(AccountResolution.safeParse({ refused: { message: "Not here." } }).success).toBe(true);
    expect(AuthenticatedCredential.safeParse(null).success).toBe(true);
    expect(
      AuthenticatedCredential.safeParse({ account: "a", scope: ["mostra"], subject: "key_1" })
        .success,
    ).toBe(true);
    expect(PushedAnswer.safeParse(undefined).success).toBe(true);
    expect(PushedAnswer.safeParse({ quarantine: { reason: "phishing" } }).success).toBe(true);
    expect(
      LinkPolicy.safeParse({ maxTtl: "7d", idleExpiry: "30d", madeWith: { show: false } }).success,
    ).toBe(true);
    expect(RoutingAnswer.safeParse(null).success).toBe(true);
    expect(RoutingAnswer.safeParse({ shell: { domain: "pages.acme.example" } }).success).toBe(true);
    expect(RoutingAnswer.safeParse({ route: { home: "hom_1", routeId: "rte_1" } }).success).toBe(
      true,
    );
    expect(LinkHost.safeParse("survey.usercontent.example").success).toBe(true);
    expect(SignInIdentity.safeParse({ provider: "github", subject: "583231" }).success).toBe(true);
  });

  it("refuses answers the server must not act on", () => {
    // A step anywhere but an https page, a sign-in step that's a script URL.
    expect(
      AccountResolution.safeParse({ step: { url: "http://operator.example/x" } }).success,
    ).toBe(false);
    expect(AccountResolution.safeParse({ step: { url: "javascript:alert(1)" } }).success).toBe(
      false,
    );
    expect(AccountResolution.safeParse({ account: "a", status: "gone" }).success).toBe(false);
    expect(LimitAnswer.safeParse({ allowed: false, message: "no code" }).success).toBe(false);
    expect(LimitAnswer.safeParse({ allowed: "yes" }).success).toBe(false);
    expect(LinkPolicy.safeParse({ maxTtl: "forever" }).success).toBe(false);
    expect(
      LinkPolicy.safeParse({ madeWith: { show: true, href: "http://x.example" } }).success,
    ).toBe(false);
    // A host with a path, a port, upper case or a single label is no host name.
    for (const domain of [
      "pages.acme.example/a",
      "pages.acme.example:443",
      "Pages.example",
      "localhost",
    ]) {
      expect(RoutingAnswer.safeParse({ shell: { domain } }).success).toBe(false);
    }
    expect(SignInIdentity.safeParse({ provider: "GitHub", subject: "1" }).success).toBe(false);
    expect(SignInIdentity.safeParse({ provider: "github", subject: "" }).success).toBe(false);
    expect(
      AuthenticatedCredential.safeParse({ account: "a", scope: [], subject: "a b" }).success,
    ).toBe(false);
  });

  it("types a module and names its revision", () => {
    const module = defineOperator(() => ({}));
    expect(typeof module).toBe("function");
    expect(OPERATOR_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
