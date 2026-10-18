import {
  classifyMessage,
  createDiagnostic,
  encodeLine,
  JSON_RPC_ERROR_CODES,
  type JsonRpcMessage,
  LineSplitter,
  mostraInitializeMethod,
  RpcError,
  RpcPeer,
  type RpcPeerOptions,
} from "@mostra/protocol";
import { describe, expect, it, vi } from "vitest";

/** Two peers wired back to back through JSON text, as a stream transport would carry them. */
function pair(a: Partial<RpcPeerOptions> = {}, b: Partial<RpcPeerOptions> = {}) {
  const wire: { toA: string[]; toB: string[] } = { toA: [], toB: [] };
  let left!: RpcPeer;
  let right!: RpcPeer;
  left = new RpcPeer({
    ...a,
    send: (message) => {
      wire.toB.push(encodeLine(message));
      queueMicrotask(() => right.receiveLine(encodeLine(message).trimEnd()));
    },
  });
  right = new RpcPeer({
    ...b,
    send: (message) => {
      wire.toA.push(encodeLine(message));
      queueMicrotask(() => left.receiveLine(encodeLine(message).trimEnd()));
    },
  });
  return { left, right, wire };
}

/** A peer whose outgoing messages are collected for inspection. */
function probe(options: Partial<RpcPeerOptions> = {}) {
  const sent: JsonRpcMessage[] = [];
  const peer = new RpcPeer({ ...options, send: (message) => sent.push(message) });
  return { peer, sent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RpcPeer requests", () => {
  it("matches responses to requests", async () => {
    const { left } = pair({}, { onRequest: (method, params) => ({ method, params }) });
    await expect(left.request("echo/a", { x: 1 })).resolves.toEqual({
      method: "echo/a",
      params: { x: 1 },
    });
    const both = await Promise.all([left.request("one"), left.request("two")]);
    expect(both.map((r) => (r as { method: string }).method)).toEqual(["one", "two"]);
    expect(left.pendingRequests).toBe(0);
  });

  it("answers a thrown RpcError with its diagnostic and code -32000", async () => {
    const { left } = pair(
      {},
      {
        onRequest: () => {
          throw new RpcError(
            createDiagnostic("MOSTRA_HOME_MISMATCH", { message: "This instance serves /a." }),
          );
        },
      },
    );
    const error = await left.request("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe(JSON_RPC_ERROR_CODES.diagnostic);
    expect((error as RpcError).diagnostic).toMatchObject({
      code: "MOSTRA_HOME_MISMATCH",
      message: "This instance serves /a.",
      severity: "error",
    });
  });

  it("hides unexpected exceptions behind MOSTRA_HOST_INTERNAL_ERROR and reports them", async () => {
    const onInternalError = vi.fn();
    const { left, wire } = pair(
      {},
      {
        onInternalError,
        onRequest: async () => {
          throw new Error("secret detail /Users/someone/token=abc");
        },
      },
    );
    const error = (await left.request("boom").catch((e: unknown) => e)) as RpcError;
    expect(error.code).toBe(JSON_RPC_ERROR_CODES.internalError);
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_INTERNAL_ERROR");
    expect(wire.toA.join("")).not.toContain("secret detail");
    expect(onInternalError).toHaveBeenCalledOnce();
  });

  it("answers MOSTRA_HOST_METHOD_UNKNOWN (-32601) without a request handler", async () => {
    const { left } = pair();
    const error = (await left.request("nope").catch((e: unknown) => e)) as RpcError;
    expect(error.code).toBe(JSON_RPC_ERROR_CODES.methodNotFound);
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_METHOD_UNKNOWN");
  });

  it("times out with MOSTRA_HOST_TIMEOUT and ignores the late response", async () => {
    const { peer, sent } = probe();
    const pending = peer.request("slow", {}, { timeoutMs: 5 }).catch((e: unknown) => e);
    const error = (await pending) as RpcError;
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_TIMEOUT");
    const request = sent[0] as { id: number };
    peer.receive({ jsonrpc: "2.0", id: request.id, result: {} });
    expect(peer.pendingRequests).toBe(0);
  });

  it("rejects waiting requests with MOSTRA_HOST_CONNECTION_CLOSED on close, and later ones too", async () => {
    const { peer } = probe();
    const waiting = peer.request("a").catch((e: unknown) => e);
    peer.close();
    expect(((await waiting) as RpcError).diagnostic.code).toBe("MOSTRA_HOST_CONNECTION_CLOSED");
    const after = (await peer.request("b").catch((e: unknown) => e)) as RpcError;
    expect(after.diagnostic.code).toBe("MOSTRA_HOST_CONNECTION_CLOSED");
    expect(peer.closed).toBe(true);
  });

  it("closes when the transport throws on send", async () => {
    const peer = new RpcPeer({
      send: () => {
        throw new Error("EPIPE");
      },
    });
    const error = (await peer.request("a").catch((e: unknown) => e)) as RpcError;
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_CONNECTION_CLOSED");
  });

  it("reads an error without a diagnostic as MOSTRA_HOST_MALFORMED, keeping the code", async () => {
    const { peer, sent } = probe();
    const waiting = peer.request("a").catch((e: unknown) => e);
    peer.receive({
      jsonrpc: "2.0",
      id: (sent[0] as { id: number }).id,
      error: { code: -1, message: "nope" },
    });
    const error = (await waiting) as RpcError;
    expect(error.code).toBe(-1);
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_MALFORMED");
    expect(error.diagnostic.message).toContain("nope");
  });
});

describe("RpcPeer typed calls", () => {
  const params = {
    client: { name: "test", version: "0" },
    revisions: ["2026-10-10"],
    capabilities: {},
    ports: [],
  };

  it("rejects a result that doesn't match the method's schema", async () => {
    const { left } = pair({}, { onRequest: () => ({ revision: "not a date" }) });
    const error = (await left
      .call(mostraInitializeMethod, params)
      .catch((e: unknown) => e)) as RpcError;
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_MALFORMED");
    expect(error.diagnostic.message).toContain("mostra/initialize");
  });

  it("refuses invalid params before sending, naming the path and not the value", async () => {
    const { peer, sent } = probe();
    const bad = { ...params, client: { name: "", version: "token-value-123" } };
    const error = (await peer
      .call(mostraInitializeMethod, bad)
      .catch((e: unknown) => e)) as RpcError;
    expect(error.diagnostic.code).toBe("MOSTRA_HOST_INVALID_PARAMS");
    expect(error.diagnostic.message).toContain("client.name");
    expect(error.diagnostic.message).not.toContain("token-value-123");
    expect(sent).toHaveLength(0);
  });
});

describe("RpcPeer incoming messages", () => {
  it("answers unparseable JSON with -32700 and id null", () => {
    const { peer, sent } = probe();
    peer.receiveLine("{not json");
    expect(sent).toEqual([
      expect.objectContaining({
        id: null,
        error: expect.objectContaining({
          code: JSON_RPC_ERROR_CODES.parseError,
          data: expect.objectContaining({ code: "MOSTRA_HOST_MALFORMED" }),
        }),
      }),
    ]);
  });

  it("answers a batch with one Invalid Request error (D83)", () => {
    const onRequest = vi.fn();
    const { peer, sent } = probe({ onRequest });
    peer.receiveLine(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "a" }]));
    expect(onRequest).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: null,
      error: { code: JSON_RPC_ERROR_CODES.invalidRequest, data: { code: "MOSTRA_HOST_MALFORMED" } },
    });
    expect((sent[0] as { error: { message: string } }).error.message).toContain("Batches");
  });

  it("answers invalid requests with -32600, echoing a readable id", () => {
    const { peer, sent } = probe({ onRequest: () => ({}) });
    peer.receive({ jsonrpc: "1.0", id: 7, method: "a" });
    peer.receive({ jsonrpc: "2.0", id: 8, method: 3 });
    peer.receive({ jsonrpc: "2.0", id: { x: 1 }, method: "a" });
    peer.receive({ jsonrpc: "2.0", id: 9, method: "a", params: "str" });
    peer.receive("text");
    expect(sent.map((m) => (m as { id: unknown }).id)).toEqual([7, 8, null, 9, null]);
    for (const message of sent) {
      expect(message).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.invalidRequest } });
    }
  });

  it("delivers notifications and never answers them", async () => {
    const onNotification = vi.fn();
    const { peer, sent } = probe({ onNotification });
    peer.receive({ jsonrpc: "2.0", method: "events/notify", params: { a: 1 } });
    await settle();
    expect(onNotification).toHaveBeenCalledWith("events/notify", { a: 1 });
    expect(sent).toHaveLength(0);
  });

  it("ignores responses to unknown ids and skips blank lines", () => {
    const { peer, sent } = probe();
    peer.receive({ jsonrpc: "2.0", id: 99, result: {} });
    peer.receiveLine("   ");
    expect(sent).toHaveLength(0);
  });
});

describe("classifyMessage", () => {
  it("sorts the four message kinds", () => {
    expect(classifyMessage({ jsonrpc: "2.0", id: "a", method: "m" }).kind).toBe("request");
    expect(classifyMessage({ jsonrpc: "2.0", method: "m" }).kind).toBe("notification");
    expect(classifyMessage({ jsonrpc: "2.0", id: 1, result: null }).kind).toBe("success");
    expect(
      classifyMessage({ jsonrpc: "2.0", id: null, error: { code: 1, message: "x" } }).kind,
    ).toBe("failure");
    expect(classifyMessage({ jsonrpc: "2.0", id: 1 }).kind).toBe("invalid");
    expect(classifyMessage({ jsonrpc: "2.0", id: 1, result: 1, error: {} }).kind).toBe("invalid");
  });
});

describe("LineSplitter", () => {
  it("joins chunks into lines and keeps the rest", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":')).toEqual([]);
    expect(splitter.push('1}\n{"b":2}\r\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(splitter.rest).toBe('{"c"');
  });

  it("refuses a line longer than the limit, finished or not", () => {
    expect(() => new LineSplitter(4).push("12345\n")).toThrow(RangeError);
    expect(() => new LineSplitter(4).push("12345")).toThrow(RangeError);
    expect(new LineSplitter(4).push("1234\n")).toEqual(["1234"]);
  });

  it("round-trips any message through encodeLine", () => {
    const message = { jsonrpc: "2.0" as const, id: 1, method: "a", params: { text: "x\ny" } };
    const lines = new LineSplitter().push(encodeLine(message));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual(message);
  });
});

describe("LineSplitter on long lines (WP-08)", () => {
  it("splits a 32 MiB line sent in 64 KiB chunks in linear time, and keeps every character", () => {
    const chunk = "x".repeat(64 * 1024);
    // The same work done once, measured on the same machine at the same moment: building the
    // 32 MiB string and searching it for a newline a single time. A load that slows this run
    // slows the reference too.
    const referenceStarted = performance.now();
    let reference = "";
    for (let i = 0; i < 512; i++) reference += chunk;
    expect(reference.indexOf("\n")).toBe(-1);
    const referenceMs = performance.now() - referenceStarted;

    const splitter = new LineSplitter();
    const started = performance.now();
    const pushed: string[][] = [];
    for (let i = 0; i < 512; i++) pushed.push(splitter.push(chunk));
    const [line, ...others] = splitter.push("y\nnext");
    const elapsed = performance.now() - started;
    expect(pushed.every((lines) => lines.length === 0)).toBe(true);
    expect(splitter.rest).toBe("next");
    // Searching every buffered character again per chunk scans 256 times the reference's
    // characters (1.6 s here against 20 ms for one pass); a linear splitter stays within a few
    // times the reference, or 500 ms on a quiet machine.
    expect(elapsed).toBeLessThan(Math.max(500, referenceMs * 20));
    expect(line?.length).toBe(32 * 1024 * 1024 + 1);
    expect(others).toEqual([]);
  });
});
