import { afterEach, describe, expect, it, vi } from "vitest";
import { browserKey, exchange, frameTicket } from "../src/api.ts";

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

describe("the shell's requests (the second GPT review of MT-02b, finding 3)", () => {
  it("fail when an answer's body is cut off, never resolving as if nothing came", async () => {
    // Headers arrive and the body stalls; the request's deadline then aborts it.
    const controller = new AbortController();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"viewId":'));
          init.signal?.addEventListener("abort", () =>
            stream.error(new DOMException("The operation was aborted.", "AbortError")),
          );
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const asked = frameTicket("http://127.0.0.1:1/a/x", "csrf", 1, controller.signal);
    controller.abort();
    await expect(asked).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("read an empty answer as nothing, and refuse one that isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 200 }));
    expect(await frameTicket("http://127.0.0.1:1/a/x", "csrf")).toBeUndefined();
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    await expect(frameTicket("http://127.0.0.1:1/a/x", "csrf")).rejects.toMatchObject({
      code: "MOSTRA_HOST_INTERNAL_ERROR",
    });
  });
});
