/**
 * Who a request comes from (D165 item 13, FAILURE_MODEL §11.3): `X-Forwarded-For` only from
 * trusted proxies, read from the right, so a forged leftmost entry is ignored; IPv6 counted per
 * /64; and the sliding-window rate limiter that answers when to try again.
 */
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientAddresses, RateLimiter, validProxies } from "../../src/server/clients.ts";

function request(peer: string, forwarded?: string): IncomingMessage {
  return {
    socket: { remoteAddress: peer },
    headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  } as unknown as IncomingMessage;
}

describe("client addresses (RM-08)", () => {
  const clients = clientAddresses({ trustedProxies: ["10.0.0.0/8", "fd00::/8", "127.0.0.1"] });

  it("believes X-Forwarded-For only from a trusted proxy", () => {
    expect(clients.of(request("203.0.113.9", "198.51.100.1"))).toBe("203.0.113.9");
    expect(clients.of(request("10.1.2.3", "198.51.100.1"))).toBe("198.51.100.1");
    expect(clients.of(request("::ffff:127.0.0.1", "198.51.100.1"))).toBe("198.51.100.1");
  });

  it("reads it from the right, so a forged leftmost entry is ignored", () => {
    // The client wrote "1.2.3.4" itself; the edge appended the address it really saw.
    expect(clients.of(request("10.0.0.1", "1.2.3.4, 198.51.100.7"))).toBe("198.51.100.7");
    // Two of our own hops in front: the first address that isn't ours is the client.
    expect(clients.of(request("10.0.0.1", "1.2.3.4, 198.51.100.7, 10.0.0.2"))).toBe("198.51.100.7");
    expect(clients.of(request("10.0.0.1", "garbage, 198.51.100.8"))).toBe("198.51.100.8");
  });

  it("counts IPv6 per /64 and IPv4 per address", () => {
    const one = clients.keyOf("2001:db8:1:2:aaaa::1");
    expect(clients.keyOf("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe(one);
    expect(clients.keyOf("2001:db8:1:3::1")).not.toBe(one);
    expect(clients.keyOf("198.51.100.1")).not.toBe(clients.keyOf("198.51.100.2"));
    expect(clientAddresses({ ipv6Prefix: 128 }).keyOf("2001:db8::1")).not.toBe(
      clientAddresses({ ipv6Prefix: 128 }).keyOf("2001:db8::2"),
    );
  });

  it("names a trusted proxy entry that is neither an address nor a block", () => {
    expect(validProxies(["10.0.0.0/8", "::1"])).toBeUndefined();
    expect(validProxies(["10.0.0.0/33"])).toBe("10.0.0.0/33");
    expect(validProxies(["proxy.example"])).toBe("proxy.example");
  });
});

describe("the rate limiter", () => {
  it("allows the rate, refuses past it with when to try again, and recovers", () => {
    let now = 0;
    const limiter = new RateLimiter({ now: () => now });
    const rate = { count: 3, perMs: 1_000 };
    for (let index = 0; index < 3; index++) expect(limiter.take("a", rate)).toEqual({ ok: true });
    const refused = limiter.take("a", rate);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.retryAfterS).toBeGreaterThanOrEqual(1);
    // Another key is counted apart.
    expect(limiter.take("b", rate)).toEqual({ ok: true });
    now = 2_500;
    expect(limiter.take("a", rate)).toEqual({ ok: true });
  });

  it("keeps a sustained rate at the limit, never more", () => {
    let now = 0;
    const limiter = new RateLimiter({ now: () => now });
    let allowed = 0;
    // Ten tries a second for ten seconds against five a second.
    for (let tick = 0; tick < 100; tick++) {
      now = tick * 100;
      if (limiter.take("k", { count: 5, perMs: 1_000 }).ok) allowed += 1;
    }
    expect(allowed).toBeGreaterThanOrEqual(45);
    expect(allowed).toBeLessThanOrEqual(55);
  });

  it("takes from several buckets together or from none (Fable review, 8)", () => {
    let now = 0;
    const limiter = new RateLimiter({ now: () => now });
    const ip = { key: "ip", rate: { count: 5, perMs: 60_000 } };
    const link = { key: "link", rate: { count: 1, perMs: 60_000 } };
    expect(limiter.takeAll([ip, link])).toEqual({ ok: true });
    // The link's bucket is empty: the refusal takes nothing from the address's.
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(limiter.takeAll([ip, link])).toMatchObject({ ok: false });
    }
    for (let left = 0; left < 4; left++) expect(limiter.takeAll([ip])).toEqual({ ok: true });
    expect(limiter.takeAll([ip])).toMatchObject({ ok: false });
    now += 60_000;
    expect(limiter.takeAll([ip, link])).toEqual({ ok: true });
  });

  it("gives back what an attempt took when someone refuses it after the rates (second Fable review, 2)", () => {
    const now = 0;
    const limiter = new RateLimiter({ now: () => now });
    const both = [
      { key: "ip", rate: { count: 2, perMs: 60_000 } },
      { key: "link", rate: { count: 2, perMs: 60_000 } },
    ];
    expect(limiter.takeAll(both)).toEqual({ ok: true });
    limiter.refundAll(both);
    expect(limiter.takeAll(both)).toEqual({ ok: true });
    expect(limiter.takeAll(both)).toEqual({ ok: true });
    expect(limiter.takeAll(both)).toMatchObject({ ok: false });
    // Never past the bucket's size.
    limiter.refundAll(both);
    limiter.refundAll(both);
    limiter.refundAll(both);
    expect(limiter.takeAll(both)).toEqual({ ok: true });
    expect(limiter.takeAll(both)).toEqual({ ok: true });
    expect(limiter.takeAll(both)).toMatchObject({ ok: false });
  });
});
