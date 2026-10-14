/**
 * Request hygiene (HY-01) and capability scopes (HY-03, D97) as pure functions: the checks the
 * gateway and `mostra mcp --http` share (D96).
 */
import {
  ALL_SCOPES,
  CapabilityScope,
  CSRF_HEADER,
  checkRequest,
  Duration,
  durationMs,
  hostMethods,
  normalizeScopes,
  PublishReceipt,
  type RequestFacts,
  safePath,
  scopeAllows,
  viewRevokeMethod,
  viewRotateMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const policy = { origin: "http://127.0.0.1:23456", hosts: ["127.0.0.1:23456"] };
const base: RequestFacts = {
  method: "POST",
  target: "/a/art_01JB8Z3QF6S7W3N8D5K2C4V9XG/_mostra/ticket",
  headers: [
    ["Host", "127.0.0.1:23456"],
    ["Origin", "http://127.0.0.1:23456"],
    ["Content-Type", "application/json; charset=utf-8"],
    ["X-Mostra-CSRF", "csrf-token-of-the-session"],
  ],
  intent: "mutation",
  csrf: "csrf-token-of-the-session",
};
const without = (name: string): RequestFacts => ({
  ...base,
  headers: base.headers.filter(([key]) => key.toLowerCase() !== name.toLowerCase()),
});
const replacing = (name: string, value: string): RequestFacts => ({
  ...base,
  headers: base.headers.map(([key, old]) => [key, key.toLowerCase() === name ? value : old]),
});
const code = (facts: RequestFacts) => {
  const refused = checkRequest(policy, facts);
  return refused && `${refused.status} ${refused.diagnostic.code}`;
};

describe("request hygiene (HY-01)", () => {
  it("lets a well-formed same-origin mutation through", () => {
    expect(checkRequest(policy, base)).toBeUndefined();
  });

  it("refuses a Host the listener doesn't serve, exactly", () => {
    for (const host of [
      "localhost:23456",
      "127.0.0.1:23457",
      "127.0.0.1",
      "evil.example:23456",
      "127.0.0.1:23456.",
    ]) {
      expect(code(replacing("host", host)), host).toBe("421 MOSTRA_HYGIENE_HOST_REFUSED");
    }
    expect(code(without("host"))).toBe("421 MOSTRA_HYGIENE_HOST_REFUSED");
    expect(code(replacing("host", "127.0.0.1:23456".toUpperCase()))).toBeUndefined();
  });

  it("refuses a foreign or missing Origin on mutations and upgrades, exactly", () => {
    for (const origin of [
      "http://127.0.0.1:23457",
      "http://localhost:23456",
      "https://127.0.0.1:23456",
      "http://127.0.0.1:23456/",
      "http://127.0.0.1:23456.evil.example",
      "null",
    ]) {
      expect(code(replacing("origin", origin)), origin).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    }
    expect(code(without("origin"))).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    expect(code({ ...without("origin"), intent: "upgrade" })).toBe(
      "403 MOSTRA_HYGIENE_ORIGIN_REFUSED",
    );
    expect(code({ ...without("origin"), intent: "exchange" })).toBe(
      "403 MOSTRA_HYGIENE_ORIGIN_REFUSED",
    );
  });

  it("lets reads through without Origin, and refuses them with a foreign one", () => {
    const read: RequestFacts = {
      method: "GET",
      target: "/",
      headers: [["host", "127.0.0.1:23456"]],
      intent: "read",
    };
    expect(code(read)).toBeUndefined();
    expect(code({ ...read, headers: [...read.headers, ["origin", "http://127.0.0.1:1"]] })).toBe(
      "403 MOSTRA_HYGIENE_ORIGIN_REFUSED",
    );
  });

  it("lets streams through only from their own origin", () => {
    const stream: RequestFacts = {
      method: "GET",
      target: "/_mostra/v/1/events",
      headers: [["host", "127.0.0.1:23456"]],
      intent: "stream",
    };
    expect(code(stream)).toBe("403 MOSTRA_HYGIENE_ORIGIN_REFUSED");
    expect(code({ ...stream, headers: [...stream.headers, ["sec-fetch-site", "same-site"]] })).toBe(
      "403 MOSTRA_HYGIENE_ORIGIN_REFUSED",
    );
    expect(
      code({ ...stream, headers: [...stream.headers, ["sec-fetch-site", "same-origin"]] }),
    ).toBeUndefined();
    expect(
      code({ ...stream, headers: [...stream.headers, ["origin", policy.origin]] }),
    ).toBeUndefined();
  });

  it("requires a JSON content type on mutations and exchanges", () => {
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonp",
      "",
    ]) {
      expect(code(replacing("content-type", type)), type).toBe("415 MOSTRA_HYGIENE_CONTENT_TYPE");
    }
    expect(code(without("content-type"))).toBe("415 MOSTRA_HYGIENE_CONTENT_TYPE");
    expect(code({ ...replacing("content-type", "text/plain"), intent: "exchange" })).toBe(
      "415 MOSTRA_HYGIENE_CONTENT_TYPE",
    );
    expect(code(replacing("content-type", "Application/JSON"))).toBeUndefined();
  });

  it("requires the session's CSRF token on mutations, but not on exchanges", () => {
    expect(code(without(CSRF_HEADER))).toBe("403 MOSTRA_HYGIENE_CSRF_MISSING");
    expect(code(replacing(CSRF_HEADER, "csrf-token-of-the-sessioN"))).toBe(
      "403 MOSTRA_HYGIENE_CSRF_MISSING",
    );
    expect(code(replacing(CSRF_HEADER, ""))).toBe("403 MOSTRA_HYGIENE_CSRF_MISSING");
    const { csrf: _csrf, ...noSession } = base;
    expect(code(noSession)).toBe("403 MOSTRA_HYGIENE_CSRF_MISSING");
    expect(code({ ...without(CSRF_HEADER), intent: "exchange" })).toBeUndefined();
  });

  it("refuses repeated and malformed headers", () => {
    for (const name of [
      "Host",
      "Origin",
      "Content-Type",
      CSRF_HEADER,
      "Cookie",
      "Content-Length",
    ]) {
      const value =
        base.headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? "1";
      const twice = {
        ...base,
        headers: [...base.headers, [name, value] as const, [name, value] as const],
      };
      expect(code(twice), name).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    }
    expect(code(replacing("origin", "http://127.0.0.1:23456\r\nX: y"))).toBe(
      "400 MOSTRA_HYGIENE_REQUEST_MALFORMED",
    );
    expect(code(replacing("origin", "http://127.0.0.1:23456\u0000"))).toBe(
      "400 MOSTRA_HYGIENE_REQUEST_MALFORMED",
    );
  });

  it("refuses request targets outside a plain path", () => {
    for (const target of [
      "http://127.0.0.1:23456/",
      "//evil.example/x",
      "*",
      "127.0.0.1:23456",
      "/../store/ledger.sqlite",
      "/assets/../../store",
      "/%2e%2e/store",
      "/assets/%2E%2E/%2e%2e/x",
      "/a%2fb",
      "/a%5Cb",
      "/a\\b",
      "/%00",
      "/%zz",
      "/./x",
    ]) {
      expect(safePath(target), target).toBeUndefined();
      expect(code({ ...base, target }), target).toBe("400 MOSTRA_HYGIENE_REQUEST_MALFORMED");
    }
    expect(safePath("/assets/index-Ab12.js?x=1")).toBe("/assets/index-Ab12.js");
    expect(safePath("/caf%C3%A9/")).toBe("/café/");
  });
});

describe("capability scopes (HY-03, D97)", () => {
  it("accepts the scope grammar and nothing else", () => {
    for (const scope of [
      "view",
      "draft",
      "submit",
      "review",
      "action:*",
      "action:sendReply",
      "action:actions.ts#sendReply",
      "action:lib/mail.server.ts#send",
    ]) {
      expect(CapabilityScope.safeParse(scope).success, scope).toBe(true);
    }
    for (const scope of [
      "admin",
      "action:",
      "action:a b",
      "action:a#b#c",
      "action:**",
      "View",
      "action:#x",
      "",
    ]) {
      expect(CapabilityScope.safeParse(scope).success, scope).toBe(false);
    }
  });

  it("grants action functions by wildcard, export name or exact ID", () => {
    const fn = "action:actions.ts#sendReply" as const;
    expect(scopeAllows(["view", "action:*"], fn)).toBe(true);
    expect(scopeAllows(["view", "action:sendReply"], fn)).toBe(true);
    expect(scopeAllows(["view", "action:actions.ts#sendReply"], fn)).toBe(true);
    expect(scopeAllows(["view", "action:archive"], fn)).toBe(false);
    expect(scopeAllows(["view", "action:other.ts#sendReply"], fn)).toBe(false);
    expect(scopeAllows(["view", "review"], fn)).toBe(false);
    expect(scopeAllows(["view", "review"], "submit")).toBe(false);
    expect(scopeAllows(["view", "action:*"], "submit")).toBe(false);
    expect(scopeAllows(ALL_SCOPES, "submit")).toBe(true);
  });

  it("always includes view and compares equal grants equally", () => {
    expect(normalizeScopes(["review"])).toEqual(["review", "view"]);
    expect(normalizeScopes(["view", "review", "review"])).toEqual(["review", "view"]);
  });

  it("parses durations", () => {
    expect(durationMs("30m")).toBe(1_800_000);
    expect(durationMs("7d")).toBe(604_800_000);
    for (const bad of ["0s", "1w", "1.5h", "-1h", "h", "1000000000d"]) {
      expect(Duration.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("view methods (D97)", () => {
  it("are mutating host methods", () => {
    const names = hostMethods.map((method) => method.method);
    for (const method of [viewUrlMethod, viewRevokeMethod, viewRotateMethod]) {
      expect(names).toContain(method.method);
      expect(method.mutating).toBe(true);
    }
  });

  it("take an artifact, an optional version by number or ID, scopes and a ttl", () => {
    const artifact = { artifactId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" };
    expect(viewUrlMethod.params.safeParse({ artifact }).success).toBe(true);
    expect(
      viewUrlMethod.params.safeParse({
        artifact,
        version: 3,
        scopes: ["view", "review"],
        ttl: "24h",
      }).success,
    ).toBe(true);
    expect(
      viewUrlMethod.params.safeParse({ artifact, version: "ver_0123456789ABCDEFGHJKMNPQRS" })
        .success,
    ).toBe(true);
    expect(viewUrlMethod.params.safeParse({ artifact, version: 0 }).success).toBe(false);
    expect(viewUrlMethod.params.safeParse({ artifact, scopes: [] }).success).toBe(false);
    expect(viewUrlMethod.params.safeParse({ artifact, scopes: ["root"] }).success).toBe(false);
    expect(viewUrlMethod.params.safeParse({ artifact, ttl: "forever" }).success).toBe(false);
    expect(
      viewRevokeMethod.params.safeParse({ tokenId: "tok_01JB8Z3QF6S7W3N8D5K2C4V9XG" }).success,
    ).toBe(true);
    expect(
      viewRotateMethod.params.safeParse({ tokenId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" }).success,
    ).toBe(false);
  });

  it("returns links with their token ID, scopes and optional expiry", () => {
    const link = {
      url: "http://127.0.0.1:23456/a/art_x#t=s",
      tokenId: "tok_01JB8Z3QF6S7W3N8D5K2C4V9XG",
      scopes: ["view"],
    };
    expect(viewUrlMethod.result.safeParse(link).success).toBe(true);
    expect(
      viewUrlMethod.result.safeParse({ ...link, expiresAt: "2026-10-15T09:00:00.000Z" }).success,
    ).toBe(true);
    expect(viewRotateMethod.result.safeParse({ ...link, tokenId: "x" }).success).toBe(false);
  });

  it("lets a publish receipt carry its default link's token ID (D97)", () => {
    const receipt = {
      artifactId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG",
      versionId: "ver_0123456789ABCDEFGHJKMNPQRS",
      version: 1,
      url: "http://127.0.0.1:23456/a/art_01JB8Z3QF6S7W3N8D5K2C4V9XG#t=x",
      tokenId: "tok_01JB8Z3QF6S7W3N8D5K2C4V9XG",
      cursor: "4",
      reused: false,
    };
    expect(PublishReceipt.safeParse(receipt).success).toBe(true);
    expect(PublishReceipt.safeParse({ ...receipt, tokenId: "nope" }).success).toBe(false);
  });
});
