import { afterEach, describe, expect, it, vi } from "vitest";
import { browserKey, exchange } from "../src/api.ts";

/** A minimal Storage the shell's origin would have. */
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the browser's key (D98 item 8, Opus review of WP-12, finding 2)", () => {
  it("is one random key per origin's storage, the same for every tab", () => {
    vi.stubGlobal("localStorage", storage());
    const first = browserKey();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(browserKey()).toBe(first);
    vi.stubGlobal("localStorage", storage());
    expect(browserKey()).not.toBe(first);
  });

  it("is absent where storage is blocked, and the exchange still goes", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(browserKey()).toBeUndefined();
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ csrf: "c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await exchange("/a/x/_mostra", { token: "t" });
    expect(sent).toEqual([{ token: "t" }]);
  });

  it("goes with every exchange, beside the credential and replace", async () => {
    vi.stubGlobal("localStorage", storage());
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ csrf: "c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await exchange("/a/x/_mostra", { token: "t" }, true);
    expect(sent[0]).toEqual({ token: "t", browser: browserKey(), replace: true });
  });
});
