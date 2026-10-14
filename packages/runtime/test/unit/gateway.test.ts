/**
 * Capability tokens, sessions and tickets (HY-03, D97, D98) and port leases (D99) against a real
 * ledger, in-process. The gateway's integration and browser suites exercise them over HTTP.
 */
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAddressing,
  LEASE_FIRST_PORT,
  LEASE_LAST_PORT,
  resolveBind,
} from "../../src/addressing/index.ts";
import {
  Capabilities,
  capabilityKey,
  csrfOf,
  FAILURE_LIMIT,
  hashSecret,
  randomSecret,
  SECRET_LENGTH,
  TICKET_TTL_MS,
} from "../../src/gateway/capabilities.ts";
import { type Ledger, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { tempDir } from "../support.ts";

const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const OTHER = "art_01JB8Z3QF6S7W3N8D5K2C4V9XH";

function ledger(): Ledger {
  const opening = openLedger({
    storeDir: join(tempDir("mostra-cap"), "store"),
    runtimeVersion: "1.0.0",
    owner: { pid: process.pid, startTime: "boot/1" },
    log: silentLog,
  });
  if (!opening.ok) throw new Error("locked");
  opening.ledger.write((db) => {
    for (const id of [ARTIFACT, OTHER]) {
      db.run(
        "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, 'A', NULL, '[]', NULL, ?, NULL)",
        id,
        new Date().toISOString(),
      );
    }
  });
  return opening.ledger;
}

function authority(clock = { now: Date.parse("2026-10-14T00:00:00Z") }) {
  const db = ledger();
  const key = capabilityKey(tempDir("mostra-key"), silentLog);
  const capabilities = new Capabilities({ ledger: db, log: silentLog, key, now: () => clock.now });
  return { db, capabilities, clock, key };
}

const isRefusal = (value: unknown): value is { status: number; diagnostic: { code: string } } =>
  typeof value === "object" && value !== null && "diagnostic" in value;
const code = (value: unknown): string | undefined =>
  isRefusal(value) ? value.diagnostic.code : undefined;

describe("capability tokens (HY-03, D97)", () => {
  it("are 130-bit secrets stored only as hashes", () => {
    const { db, capabilities } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    expect(token.secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(SECRET_LENGTH * 5).toBeGreaterThanOrEqual(128);
    const rows = db.read((tx) => tx.all<Record<string, unknown>>("SELECT * FROM token"));
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(token.secret);
    expect(stored).toContain(hashSecret(token.secret));
  });

  it("derive the same secret from the home's key, and a fresh one per token", () => {
    const { capabilities } = authority();
    const a = capabilities.mint({ artifactId: ARTIFACT });
    const b = capabilities.mint({ artifactId: ARTIFACT });
    expect(a.secret).not.toBe(b.secret);
    expect(capabilities.reveal(a.tokenId)?.secret).toBe(a.secret);
    expect(new Set(Array.from({ length: 200 }, randomSecret)).size).toBe(200);
  });

  it("grant only their artifact and default to every scope", () => {
    const { capabilities } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    expect(token.scopes).toEqual(["action:*", "draft", "review", "submit", "view"]);
    expect(code(capabilities.presentToken(token.secret, OTHER))).toBe(
      "MOSTRA_HYGIENE_TOKEN_INVALID",
    );
    expect(code(capabilities.presentToken(token.secret, ARTIFACT))).toBeUndefined();
    const narrow = capabilities.mint({ artifactId: ARTIFACT, scopes: ["review"] });
    expect(narrow.scopes).toEqual(["review", "view"]);
  });

  it("refuse malformed and unknown secrets", () => {
    const { capabilities } = authority();
    for (const secret of [
      undefined,
      42,
      "",
      "short",
      "0".repeat(25),
      "U".repeat(26),
      randomSecret(),
    ]) {
      expect(code(capabilities.presentToken(secret, ARTIFACT))).toBe(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
      );
    }
  });

  it("expire after their ttl, and never without one (D63, LL-05)", () => {
    const { capabilities, clock } = authority();
    const forever = capabilities.mint({ artifactId: ARTIFACT });
    const hour = capabilities.mint({ artifactId: ARTIFACT, ttlMs: 3_600_000 });
    clock.now += 3_599_000;
    expect(code(capabilities.presentToken(hour.secret, ARTIFACT))).toBeUndefined();
    clock.now += 2_000;
    expect(code(capabilities.presentToken(hour.secret, ARTIFACT))).toBe(
      "MOSTRA_HYGIENE_TOKEN_REVOKED",
    );
    clock.now += 365 * 86_400_000;
    expect(code(capabilities.presentToken(forever.secret, ARTIFACT))).toBeUndefined();
  });

  it("revoke for good, with their sessions answering 410 (FAILURE_MODEL §8)", () => {
    const { db, capabilities } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    const session = capabilities.createSession({
      tokenId: token.tokenId,
      origin: "http://127.0.0.1:20001",
    });
    expect(capabilities.revoke(token.tokenId)).toBe("revoked");
    expect(capabilities.revoke(token.tokenId)).toBe("already");
    expect(capabilities.revoke("tok_01JB8Z3QF6S7W3N8D5K2C4V9XG")).toBe("unknown");
    expect(code(capabilities.presentToken(token.secret, ARTIFACT))).toBe(
      "MOSTRA_HYGIENE_TOKEN_REVOKED",
    );
    expect(code(capabilities.session([session.cookie], "http://127.0.0.1:20001", ARTIFACT))).toBe(
      "MOSTRA_HYGIENE_TOKEN_REVOKED",
    );
    // The ledger refuses to bring a revoked token back, or to change any token's grant.
    expect(() =>
      db.write((tx) => tx.run("UPDATE token SET revoked_at = NULL WHERE id = ?", token.tokenId)),
    ).toThrow();
    const live = capabilities.mint({ artifactId: ARTIFACT, scopes: ["review"] });
    expect(() =>
      db.write((tx) =>
        tx.run("UPDATE token SET scopes_json = '[\"submit\"]' WHERE id = ?", live.tokenId),
      ),
    ).toThrow();
    const events = db.read((tx) =>
      tx.all<{ type: string; payload_json: string }>("SELECT type, payload_json FROM event"),
    );
    expect(events).toEqual([
      {
        type: "token.revoked",
        payload_json: JSON.stringify({ tokenId: token.tokenId, reason: "revoked" }),
      },
    ]);
  });

  it("rotate in one step: same grant, new secret, old one gone (D97 item 6)", () => {
    const { capabilities } = authority();
    const old = capabilities.mint({
      artifactId: ARTIFACT,
      scopes: ["review"],
      ttlMs: 86_400_000,
      pinnedVersion: 2,
    });
    const rotated = capabilities.rotate(old.tokenId);
    if (rotated === undefined || rotated === "dead") throw new Error("not rotated");
    expect(rotated.tokenId).not.toBe(old.tokenId);
    expect(rotated.secret).not.toBe(old.secret);
    expect(rotated.scopes).toEqual(old.scopes);
    expect(rotated.expiresAt).toBe(old.expiresAt);
    expect(rotated.pinnedVersion).toBe(2);
    expect(code(capabilities.presentToken(old.secret, ARTIFACT))).toBe(
      "MOSTRA_HYGIENE_TOKEN_REVOKED",
    );
    expect(code(capabilities.presentToken(rotated.secret, ARTIFACT))).toBeUndefined();
    expect(capabilities.rotate(old.tokenId)).toBe("dead");
    expect(capabilities.rotate("tok_01JB8Z3QF6S7W3N8D5K2C4V9XG")).toBeUndefined();
  });

  it("keep one stable default link per artifact, and rotation moves it (D97 item 3)", () => {
    const { capabilities } = authority();
    const first = capabilities.defaultLink(ARTIFACT);
    expect(capabilities.defaultLink(ARTIFACT)).toEqual(first);
    expect(first.expiresAt).toBeUndefined();
    const rotated = capabilities.rotate(first.tokenId);
    if (rotated === undefined || rotated === "dead") throw new Error("not rotated");
    expect(rotated.isDefault).toBe(true);
    expect(capabilities.defaultLink(ARTIFACT).tokenId).toBe(rotated.tokenId);
    capabilities.revoke(rotated.tokenId);
    const next = capabilities.defaultLink(ARTIFACT);
    expect(next.tokenId).not.toBe(rotated.tokenId);
  });

  it("keep links working when the home's key is replaced, and mint a new default", () => {
    const clock = { now: Date.now() };
    const db = ledger();
    const first = new Capabilities({
      ledger: db,
      log: silentLog,
      key: Buffer.alloc(32, 1),
      now: () => clock.now,
    });
    const old = first.defaultLink(ARTIFACT);
    const second = new Capabilities({
      ledger: db,
      log: silentLog,
      key: Buffer.alloc(32, 2),
      now: () => clock.now,
    });
    expect(code(second.presentToken(old.secret, ARTIFACT))).toBeUndefined();
    const fresh = second.defaultLink(ARTIFACT);
    expect(fresh.tokenId).not.toBe(old.tokenId);
    expect(second.reveal(old.tokenId)).toBeUndefined();
  });
});

describe("guessing is rate-limited (D97 item 8)", () => {
  it("refuses every attempt, valid ones too, while the limit holds, and recovers after a minute", () => {
    const { capabilities, clock } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    for (let index = 0; index < FAILURE_LIMIT; index++) {
      expect(capabilities.limited()).toBeUndefined();
      capabilities.presentToken(randomSecret(), ARTIFACT);
    }
    const limited = capabilities.limited();
    expect(limited?.status).toBe(429);
    expect(limited?.retryAfter).toBeGreaterThan(0);
    clock.now += 60_001;
    expect(capabilities.limited()).toBeUndefined();
    expect(code(capabilities.presentToken(token.secret, ARTIFACT))).toBeUndefined();
  });
});

describe("sessions and tickets (D98)", () => {
  const SHELL = "http://127.0.0.1:20000";
  const FRAME = "http://127.0.0.1:20001";
  const ELSEWHERE = "http://127.0.0.1:20002";

  it("bind a session to the one origin it was issued for", () => {
    const { capabilities } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    const session = capabilities.createSession({ tokenId: token.tokenId, origin: FRAME });
    expect(code(capabilities.session([session.cookie], FRAME, ARTIFACT))).toBeUndefined();
    expect(code(capabilities.session([session.cookie], ELSEWHERE, ARTIFACT))).toBe(
      "MOSTRA_HYGIENE_SESSION_MISSING",
    );
    expect(code(capabilities.session([session.cookie], FRAME, OTHER))).toBe(
      "MOSTRA_HYGIENE_SESSION_MISSING",
    );
    // Another page of the host may set a cookie of the same name; the real one is still found.
    expect(
      code(capabilities.session([randomSecret(), "junk", session.cookie], FRAME, ARTIFACT)),
    ).toBeUndefined();
  });

  it("store sessions as hashes", () => {
    const { db, capabilities } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    const session = capabilities.createSession({ tokenId: token.tokenId, origin: FRAME });
    const rows = JSON.stringify(db.read((tx) => tx.all("SELECT * FROM session")));
    expect(rows).not.toContain(session.cookie);
    // The CSRF token is derived from the cookie and stored only as a hash (review of item 12).
    expect(session.csrf).toBe(csrfOf(session.cookie));
    expect(rows).not.toContain(session.csrf);
    expect(rows).toContain(hashSecret(session.csrf));
    const resolved = capabilities.session([session.cookie], FRAME, ARTIFACT);
    expect("csrf" in resolved && resolved.csrf).toBe(session.csrf);
  });

  it("redeem a ticket once, on its origin, within 60 seconds", () => {
    const { capabilities, clock } = authority();
    const token = capabilities.mint({ artifactId: ARTIFACT });
    const grant = {
      tokenId: token.tokenId,
      artifactId: ARTIFACT,
      versionId: "ver_X",
      origin: FRAME,
      shellOrigin: SHELL,
    };
    const once = capabilities.mintTicket(grant);
    expect(capabilities.redeemTicket(once, FRAME)).toEqual(grant);
    expect(code(capabilities.redeemTicket(once, FRAME))).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    const wrongOrigin = capabilities.mintTicket(grant);
    expect(code(capabilities.redeemTicket(wrongOrigin, ELSEWHERE))).toBe(
      "MOSTRA_HYGIENE_TOKEN_INVALID",
    );
    expect(code(capabilities.redeemTicket(wrongOrigin, FRAME))).toBe(
      "MOSTRA_HYGIENE_TOKEN_INVALID",
    );
    const late = capabilities.mintTicket(grant);
    clock.now += TICKET_TTL_MS + 1;
    expect(code(capabilities.redeemTicket(late, FRAME))).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    const revoked = capabilities.mintTicket(grant);
    capabilities.revoke(token.tokenId);
    expect(code(capabilities.redeemTicket(revoked, FRAME))).toBe("MOSTRA_HYGIENE_TOKEN_REVOKED");
  });
});

describe("addressing (D99)", () => {
  it("binds loopback unless --bind says otherwise, and a wildcard needs --url-host", () => {
    expect(resolveBind({})).toEqual({ address: "127.0.0.1" });
    expect(resolveBind({ bind: "0.0.0.0", urlHost: "box.tail1234.ts.net" })).toEqual({
      address: "0.0.0.0",
      urlHost: "box.tail1234.ts.net",
    });
    const failure = (options: Parameters<typeof resolveBind>[0]): string => {
      try {
        resolveBind(options);
      } catch (error) {
        return (error as { diagnostic: { code: string } }).diagnostic.code;
      }
      return "none";
    };
    expect(failure({ bind: "0.0.0.0" })).toBe("MOSTRA_ENV_BIND_FAILED");
    expect(failure({ bind: "::" })).toBe("MOSTRA_ENV_BIND_FAILED");
    expect(failure({ bind: "localhost" })).toBe("MOSTRA_ENV_BIND_FAILED");
    expect(failure({ urlHost: "example.test" })).toBe("MOSTRA_ENV_BIND_FAILED");
    expect(failure({ bind: "0.0.0.0", urlHost: "bad host/" })).toBe("MOSTRA_ENV_BIND_FAILED");
  });

  it("forms exact origins and Host allowlists, bracketing IPv6", () => {
    const db = ledger();
    const v4 = createAddressing({ ledger: db, log: silentLog, bind: { address: "127.0.0.1" } });
    expect(v4.origin(20000)).toBe("http://127.0.0.1:20000");
    expect(v4.hosts(20000)).toEqual(["127.0.0.1:20000"]);
    const v6 = createAddressing({ ledger: db, log: silentLog, bind: { address: "::1" } });
    expect(v6.origin(20000)).toBe("http://[::1]:20000");
    // GPT review finding 1: hosts take the form a browser writes, whatever spelling the flag used.
    for (const spelling of ["0:0:0:0:0:0:0:1", "[0:0:0:0:0:0:0:1]", "::0001"]) {
      const bound = createAddressing({
        ledger: db,
        log: silentLog,
        bind: resolveBind({ bind: spelling }),
      });
      expect(bound.origin(20000), spelling).toBe("http://[::1]:20000");
      expect(bound.hosts(20000), spelling).toEqual(["[::1]:20000"]);
      expect(bound.origin(20000)).toBe(new URL("http://[0:0:0:0:0:0:0:1]:20000").origin);
    }
    const named = createAddressing({
      ledger: db,
      log: silentLog,
      bind: resolveBind({ bind: "0.0.0.0", urlHost: "Studio.Local" }),
    });
    expect(named.origin(20000)).toBe("http://studio.local:20000");
    expect(named.hosts(20000)).toEqual(["studio.local:20000"]);
    expect(v6.frameMode("http://127.0.0.1:20000", "http://127.0.0.1:20001")).toBe("cookie");
    expect(v6.frameMode("https://a.trycloudflare.com", "https://b.trycloudflare.com")).toBe(
      "worker",
    );
  });

  it("leases below the ephemeral ranges, reuses a lease, and re-leases a taken port", async () => {
    const db = ledger();
    const addressing = createAddressing({
      ledger: db,
      log: silentLog,
      bind: { address: "127.0.0.1" },
    });
    const owner = { purpose: "artifact" as const, owner: ARTIFACT };
    const close = (server: Server): Promise<void> =>
      new Promise((resolve) => server.close(() => resolve()));
    const first = createServer();
    const port = await addressing.listen(first, owner);
    expect(port).toBeGreaterThanOrEqual(LEASE_FIRST_PORT);
    expect(port).toBeLessThanOrEqual(LEASE_LAST_PORT);
    await close(first);
    const again = createServer();
    expect(await addressing.listen(again, owner)).toBe(port);
    // Another program holds the port now: the next start leases a new one and records it.
    const squatter = again;
    const next = createServer();
    const moved = await addressing.listen(next, owner);
    expect(moved).not.toBe(port);
    expect(addressing.leased(owner)).toBe(moved);
    await Promise.all([close(squatter), close(next)]);
    const shell = createServer();
    const shellPort = await addressing.listen(shell, { purpose: "shell", owner: "shell" });
    expect(shellPort).not.toBe(moved);
    await close(shell);
  });
});
