/**
 * How a page renders in each chat host (D160, `server/chat-hosts.ts`): the configuration is read
 * as openly as before (D32), each client's answer is kept for a minute, and a client that can't
 * be read now keeps its last answer (review findings Fable 10, Fable 11, Opus 13).
 */
import type { ChatHostPolicy } from "@mostra/protocol/operator";
import { describe, expect, it } from "vitest";
import type { Log } from "../../src/log.ts";
import { chatHostPolicies, createRender, RENDER_KEPT_MS } from "../../src/server/chat-hosts.ts";

/** A log that keeps what it was told. */
function recording(): { log: Log; warned: Record<string, unknown>[] } {
  const warned: Record<string, unknown>[] = [];
  const log = {
    info: () => undefined,
    warn: (event: string, fields: Record<string, unknown> = {}) =>
      warned.push({ event, ...fields }),
    error: () => undefined,
  } as unknown as Log;
  return { log, warned };
}

describe("chat host policies (D160)", () => {
  it("uses the entries it can, by host name in any case, and logs the rest without stopping", () => {
    const { log, warned } = recording();
    const policies = chatHostPolicies(
      {
        "Claude.AI": { render: "link" },
        "client.example": { render: "frame" },
        "not a host": { render: "app" },
      },
      log,
    );
    expect([...policies]).toEqual([["claude.ai", { render: "link" }]]);
    expect(warned).toEqual([
      { event: "server.chat_host_ignored", key: "client.example", why: "not a chat host policy" },
      { event: "server.chat_host_ignored", key: "not a host", why: "not a host name" },
    ]);
  });

  it("asks once a minute per client, matches any of its redirect hosts, and keeps its last answer while it can't be read", async () => {
    let clock = 0;
    let asked = 0;
    let readable = true;
    const render = createRender({
      client: async () =>
        readable
          ? {
              name: "Chat",
              redirectUris: ["not a url", "https://a.example/cb", "https://chat.example/cb"],
            }
          : undefined,
      ask: async () => {
        asked += 1;
        return null;
      },
      configured: new Map<string, ChatHostPolicy>([["chat.example", { render: "link" }]]),
      now: () => clock,
    });
    expect(await render("mcl_1")).toBe("link");
    expect(await render("mcl_1")).toBe("link");
    expect(asked).toBe(1);
    clock = RENDER_KEPT_MS + 1;
    readable = false;
    // Its metadata can't be read now: its last answer, never the default.
    expect(await render("mcl_1")).toBe("link");
    // A client never seen and unreadable: the default.
    expect(await render("mcl_2")).toBe("app");
  });

  it("takes the operator's answer over the configuration's", async () => {
    const render = createRender({
      client: async () => ({ name: "Chat", redirectUris: ["https://chat.example/cb"] }),
      ask: async () => ({ render: "app" }),
      configured: new Map<string, ChatHostPolicy>([["chat.example", { render: "link" }]]),
    });
    expect(await render("mcl_1")).toBe("app");
  });
});
