import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHttpEndpoint,
  createMcpServerFactory,
  GUESS_LIMIT,
  localWorkspace,
} from "@mostra/mcp";
import { describe, expect, it } from "vitest";
import { fakeDocs, fakeInstance } from "./support.ts";

const ORIGIN = "http://127.0.0.1:23456";
const TOKEN = "T".repeat(26);

function endpoint(now?: () => number) {
  const factory = createMcpServerFactory({
    instance: fakeInstance({}),
    workspace: localWorkspace(mkdtempSync(join(tmpdir(), "mostra-http-"))),
    docs: fakeDocs,
    version: "0.0.0-test",
  });
  return createHttpEndpoint(factory, {
    origin: ORIGIN,
    hosts: ["127.0.0.1:23456"],
    token: TOKEN,
    ...(now ? { now } : {}),
  });
}

const LIST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});

/** A request with exactly these headers (pairs, so repeats stay visible), as a transport gives it. */
function send(
  target: string,
  pairs: [string, string][],
  options: { method?: string; body?: string; at?: ReturnType<typeof endpoint> } = {},
) {
  const method = options.method ?? "POST";
  const headers = new Headers();
  for (const [name, value] of pairs) {
    try {
      headers.append(name, value);
    } catch {
      // A value the Fetch API refuses still reaches the endpoint as the transport received it.
    }
  }
  const request = new Request(`${ORIGIN}${target.startsWith("/") ? "" : "/"}${target}`, {
    method,
    headers,
    ...(method === "POST" ? { body: options.body ?? LIST } : {}),
  });
  return (options.at ?? endpoint()).fetch(request, { target, headers: pairs });
}

const good = (): [string, string][] => [
  ["Host", "127.0.0.1:23456"],
  ["Content-Type", "application/json"],
  ["Accept", "application/json, text/event-stream"],
  ["Authorization", `Bearer ${TOKEN}`],
];

async function code(response: Response): Promise<string> {
  return ((await response.json()) as { error: { data: { code: string } } }).error.data.code;
}

describe("the MCP endpoint's request checks (HY-01 item 13)", () => {
  it("serves a well-formed request from a program, with no Origin, and hardens every answer", async () => {
    const response = await send("/mcp", good());
    expect(response.status).toBe(200);
    for (const response2 of [response, await send("/mcp", good().slice(1))]) {
      expect(response2.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(response2.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response2.headers.get("referrer-policy")).toBe("no-referrer");
      expect([...response2.headers.keys()].some((name) => name.startsWith("access-control-"))).toBe(
        false,
      );
    }
  });

  it("refuses another Host, a repeated Host and no Host (DNS rebinding)", async () => {
    const refused = await send("/mcp", [["Host", "evil.example:23456"], ...good().slice(1)]);
    expect(refused.status).toBe(421);
    expect(await code(refused)).toBe("MOSTRA_HYGIENE_HOST_REFUSED");
    expect((await send("/mcp", [["Host", "localhost:23456"], ...good().slice(1)])).status).toBe(
      421,
    );
    expect((await send("/mcp", [...good(), ["Host", "127.0.0.1:23456"]])).status).toBe(400);
    expect((await send("/mcp", good().slice(1))).status).toBe(421);
  });

  it("refuses a page of another origin, and accepts its own origin", async () => {
    const refused = await send("/mcp", [...good(), ["Origin", "http://evil.example"]]);
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe("MOSTRA_HYGIENE_ORIGIN_REFUSED");
    expect((await send("/mcp", [...good(), ["Origin", "null"]])).status).toBe(403);
    expect((await send("/mcp", [...good(), ["Origin", ORIGIN]])).status).toBe(200);
  });

  it("refuses a body not declared as JSON (a form a page could post)", async () => {
    const pairs = good().map(([name, value]): [string, string] =>
      name === "Content-Type" ? [name, "text/plain"] : [name, value],
    );
    const refused = await send("/mcp", pairs);
    expect(refused.status).toBe(415);
    expect(await code(refused)).toBe("MOSTRA_HYGIENE_CONTENT_TYPE");
  });

  it("refuses a missing, wrong or repeated token", async () => {
    const missing = await send(
      "/mcp",
      good().filter(([name]) => name !== "Authorization"),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="mostra"');
    expect(await code(missing)).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    const wrong = good().map(([name, value]): [string, string] =>
      name === "Authorization" ? [name, `Bearer ${"X".repeat(26)}`] : [name, value],
    );
    expect((await send("/mcp", wrong)).status).toBe(401);
    expect((await send("/mcp", [...good(), ["Authorization", `Bearer ${TOKEN}`]])).status).toBe(
      400,
    );
  });

  it("reads the scheme without regard to case, and counts only wrong bearer tokens as guesses (Opus review of WP-15, finding 10)", async () => {
    const at = endpoint();
    const as = (value: string) =>
      good().map(([name, header]): [string, string] =>
        name === "Authorization" ? [name, value] : [name, header],
      );
    expect((await send("/mcp", as(`bearer ${TOKEN}`), { at })).status).toBe(200);
    expect((await send("/mcp", as(`BEARER  ${TOKEN}`), { at })).status).toBe(200);
    // Another scheme can never succeed, so it isn't a guess: past the limit's count, the right
    // token still works.
    const basic = await Promise.all(
      Array.from({ length: GUESS_LIMIT + 5 }, () => send("/mcp", as(`Basic ${TOKEN}`), { at })),
    );
    expect(basic.every((response) => response.status === 401)).toBe(true);
    expect(await code(basic[0] as Response)).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    expect((await send("/mcp", good(), { at })).status).toBe(200);
  });

  it("limits guessing: past the limit every token is refused, the right one too, until the window clears", async () => {
    let now = 1_000_000;
    const at = endpoint(() => now);
    const wrong = good().map(([name, value]): [string, string] =>
      name === "Authorization" ? [name, "Bearer guess"] : [name, value],
    );
    const guesses = await Promise.all(
      Array.from({ length: GUESS_LIMIT }, () => send("/mcp", wrong, { at })),
    );
    expect(guesses.every((response) => response.status === 401)).toBe(true);
    const limited = await send("/mcp", good(), { at });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    now += 60_001;
    expect((await send("/mcp", good(), { at })).status).toBe(200);
  });

  it("serves only POST /mcp, and refuses targets that aren't plain paths", async () => {
    const get = await send("/mcp", good(), { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await send("/other", good())).status).toBe(404);
    expect((await send("/mcp/../mcp", good())).status).toBe(400);
    expect((await send("/%2e%2e/mcp", good())).status).toBe(400);
    expect((await send("/mcp", [...good(), ["X-Bad", "a\u0001b"]])).status).toBe(400);
  });
});
