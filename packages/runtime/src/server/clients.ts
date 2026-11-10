/**
 * Who a request comes from, and how often (D165 item 13, FAILURE_MODEL §11.3). The server sits
 * behind a TLS terminator, so the connection's peer is a proxy: `X-Forwarded-For` is believed only
 * when the peer is one of `trustedProxies`, and read from the right, taking the first address that
 * isn't a trusted proxy, so a forged leftmost entry is ignored. Rates key IPv6 addresses by their
 * /64 (`rateLimits.ipv6Prefix`), so rotating addresses inside one allocation doesn't escape them.
 *
 * The rate limiter is a token bucket per key, in memory: a server setting, never operator
 * policy, and with no setting there is no limit (D165 item 14).
 */
import type { IncomingMessage } from "node:http";
import { isIPv4, isIPv6 } from "node:net";

/** An address range: an exact address, or a CIDR block (`10.0.0.0/8`, `fd00::/8`). */
interface Range {
  readonly v6: boolean;
  readonly bits: bigint;
  readonly prefix: number;
}

/** An address as a number (IPv4 in 32 bits, IPv6 in 128), or `undefined` when it isn't one. */
function addressBits(address: string): { readonly v6: boolean; readonly bits: bigint } | undefined {
  let text = address.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // An IPv4 address mapped into IPv6, as Node reports a dual-stack peer.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
  if (mapped) text = mapped[1] as string;
  if (isIPv4(text)) {
    const parts = text.split(".").map(Number);
    return {
      v6: false,
      bits: parts.reduce((sum, part) => (sum << 8n) | BigInt(part), 0n),
    };
  }
  if (!isIPv6(text)) return undefined;
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // A trailing IPv4 part becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const parts = (v4[1] as string).split(".").map(Number);
    const high = (((parts[0] as number) << 8) | (parts[1] as number)).toString(16);
    const low = (((parts[2] as number) << 8) | (parts[3] as number)).toString(16);
    text = `${text.slice(0, -(v4[1] as string).length)}${high}:${low}`;
  }
  const [head, tail] = text.split("::") as [string, string | undefined];
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined ? [] : tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? left
      : [...left, ...new Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return undefined;
  return {
    v6: true,
    bits: groups.reduce((sum, group) => (sum << 16n) | BigInt(Number.parseInt(group, 16)), 0n),
  };
}

function parseRange(text: string): Range | undefined {
  const [address, prefixText] = text.split("/") as [string, string | undefined];
  const found = addressBits(address);
  if (!found) return undefined;
  const width = found.v6 ? 128 : 32;
  const prefix = prefixText === undefined ? width : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return undefined;
  return { v6: found.v6, bits: found.bits, prefix };
}

function inRange(range: Range, address: { readonly v6: boolean; readonly bits: bigint }): boolean {
  if (range.v6 !== address.v6) return false;
  const width = range.v6 ? 128n : 32n;
  const shift = width - BigInt(range.prefix);
  return range.bits >> shift === address.bits >> shift;
}

/** Whether every entry of `trustedProxies` is an address or a CIDR block. */
export function validProxies(entries: readonly string[]): string | undefined {
  return entries.find((entry) => parseRange(entry) === undefined);
}

/** Resolves a request's client address through the configured trusted proxies. */
export interface ClientAddresses {
  /** The client's address: the peer's, or the forwarded one when the peer is a trusted proxy. */
  of(incoming: IncomingMessage): string | undefined;
  /** The key a rate counts the address under: the address, or its IPv6 prefix. */
  keyOf(address: string | undefined): string;
}

/** Options for {@link clientAddresses}. */
export interface ClientAddressOptions {
  readonly trustedProxies?: readonly string[] | undefined;
  /** IPv6 addresses count per this prefix (default 64). */
  readonly ipv6Prefix?: number | undefined;
}

/** Builds the resolver; an entry that isn't an address or a block is ignored (checked at start). */
export function clientAddresses(options: ClientAddressOptions): ClientAddresses {
  const proxies = (options.trustedProxies ?? [])
    .map(parseRange)
    .filter((range): range is Range => range !== undefined);
  const trusted = (address: string): boolean => {
    const bits = addressBits(address);
    return bits !== undefined && proxies.some((range) => inRange(range, bits));
  };
  const ipv6Prefix = options.ipv6Prefix ?? 64;
  const seen = new WeakMap<IncomingMessage, string | undefined>();
  return {
    of(incoming) {
      if (seen.has(incoming)) return seen.get(incoming);
      const peer = incoming.socket.remoteAddress;
      let client = peer;
      if (peer !== undefined && trusted(peer)) {
        const header = incoming.headers["x-forwarded-for"];
        const entries = (Array.isArray(header) ? header.join(",") : (header ?? ""))
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "");
        // From the right: each hop appends the address it saw; the first one that isn't one of
        // ours is the client. Anything to its left was written by the client and is believed by
        // no one.
        for (let index = entries.length - 1; index >= 0; index--) {
          const entry = entries[index] as string;
          if (addressBits(entry) === undefined) break;
          client = entry;
          if (!trusted(entry)) break;
        }
      }
      seen.set(incoming, client);
      return client;
    },
    keyOf(address) {
      if (address === undefined) return "unknown";
      const bits = addressBits(address);
      if (!bits) return `other:${address}`;
      if (!bits.v6) return `v4:${bits.bits.toString(16)}`;
      const shift = 128n - BigInt(ipv6Prefix);
      return `v6:${(bits.bits >> shift).toString(16)}/${ipv6Prefix}`;
    },
  };
}

/** A rate: `count` per `perMs`. */
export interface RateLimit {
  readonly count: number;
  readonly perMs: number;
}

/**
 * A token-bucket rate limiter over keys, in memory, bounded in the keys it keeps: each key holds up
 * to `count` tokens and earns them back at `count` per `perMs`, so a burst of `count` passes and
 * the sustained rate is exactly the rate.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, { tokens: number; at: number }>();
  readonly #now: () => number;
  readonly #maxKeys: number;

  constructor(options: { readonly now?: () => number; readonly maxKeys?: number } = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#maxKeys = options.maxKeys ?? 100_000;
  }

  /**
   * Takes one token under `key` when there is one. Without one, nothing is taken and the answer
   * says when to try again, in whole seconds (`Retry-After`).
   */
  take(
    key: string,
    rate: RateLimit,
  ): { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number } {
    const now = this.#now();
    const perToken = rate.perMs / rate.count;
    let bucket = this.#buckets.get(key);
    if (bucket) {
      bucket.tokens = Math.min(rate.count, bucket.tokens + (now - bucket.at) / perToken);
      bucket.at = now;
      // Most recently used last, so the bound drops the least recently used key.
      this.#buckets.delete(key);
    } else {
      if (this.#buckets.size >= this.#maxKeys) {
        this.#buckets.delete(this.#buckets.keys().next().value as string);
      }
      bucket = { tokens: rate.count, at: now };
    }
    this.#buckets.set(key, bucket);
    if (bucket.tokens < 1) {
      const waitMs = (1 - bucket.tokens) * perToken;
      return { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    bucket.tokens -= 1;
    return { ok: true };
  }

  /**
   * Takes one token under every key, or none: when any bucket is empty, nothing is taken from the
   * others, and the answer says when the slowest one has a token again (Fable review, 8).
   */
  takeAll(
    wanted: readonly { readonly key: string; readonly rate: RateLimit }[],
  ): { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number } {
    const now = this.#now();
    let waitMs = 0;
    const buckets = wanted.map(({ key, rate }) => {
      const perToken = rate.perMs / rate.count;
      let bucket = this.#buckets.get(key);
      if (bucket) {
        bucket.tokens = Math.min(rate.count, bucket.tokens + (now - bucket.at) / perToken);
        bucket.at = now;
        this.#buckets.delete(key);
      } else {
        if (this.#buckets.size >= this.#maxKeys) {
          this.#buckets.delete(this.#buckets.keys().next().value as string);
        }
        bucket = { tokens: rate.count, at: now };
      }
      this.#buckets.set(key, bucket);
      if (bucket.tokens < 1) waitMs = Math.max(waitMs, (1 - bucket.tokens) * perToken);
      return bucket;
    });
    if (waitMs > 0) return { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) };
    for (const bucket of buckets) bucket.tokens -= 1;
    return { ok: true };
  }
}
