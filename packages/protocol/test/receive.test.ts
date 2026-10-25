/**
 * Receivers read what a newer peer adds within a revision (HO-07, D32, #45): enum values and
 * union members they don't know arrive as sent, and everything else is still checked.
 */
import {
  encodeLine,
  hostMethods,
  hostNotifications,
  instanceCheckMethod,
  RpcError,
  RpcPeer,
  receivable,
  uiInitialize,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import * as z from "zod";

const State = z.enum(["queued", "running"]);
const Event = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), at: z.string() }),
  z.object({ kind: z.literal("ended"), code: z.number() }),
]);
const Message = z.strictObject({
  state: State,
  mode: z.union([z.literal("host"), z.literal("daemon")]),
  events: z.array(Event).max(3).readonly(),
  byState: z.record(z.string(), State).optional(),
  pair: z.tuple([State, z.number()]),
});

const sample = {
  state: "running",
  mode: "host",
  events: [{ kind: "started", at: "now" }],
  pair: ["queued", 1],
};

describe("receivable (#45)", () => {
  it("accepts enum values, literal unions and union members a newer peer adds", () => {
    const newer = {
      state: "waiting",
      mode: "remote",
      events: [
        { kind: "started", at: "now" },
        { kind: "parked", cause: "it keeps crashing" },
      ],
      byState: { a: "paused" },
      pair: ["suspended", 2],
      addedField: true,
    };
    expect(Message.safeParse(newer).success).toBe(false);
    const parsed = receivable(Message).safeParse(newer);
    expect(parsed.success).toBe(true);
    // The newer member arrives whole; the field a newer peer added is dropped, as for any object.
    expect(parsed.data).toEqual({
      state: "waiting",
      mode: "remote",
      events: [
        { kind: "started", at: "now" },
        { kind: "parked", cause: "it keeps crashing" },
      ],
      byState: { a: "paused" },
      pair: ["suspended", 2],
    });
  });

  it("keeps what a loose object passes through, and a catchall's checks (GPT review finding 1)", () => {
    // `ui/initialize`'s host context passes extra fields through (MCP Apps' safe-area insets);
    // a receiving copy that dropped them would hide what the page could read before.
    const result = {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "shell", version: "1" },
      hostCapabilities: {},
      hostContext: { theme: "dark", safeAreaInsets: { top: 1, right: 0, bottom: 2, left: 0 } },
    };
    const read = receivable(uiInitialize.result).parse(result) as typeof result;
    expect(read.hostContext.safeAreaInsets).toEqual({ top: 1, right: 0, bottom: 2, left: 0 });
    // A catchall with a type keeps checking the fields it admits, opened like any other value.
    const counted = z.object({ name: z.string() }).catchall(z.number());
    expect(receivable(counted).parse({ name: "a", extra: 2 })).toEqual({ name: "a", extra: 2 });
    expect(receivable(counted).safeParse({ name: "a", extra: "two" }).success).toBe(false);
    // A strict object's refusal of unknown fields is what goes: they are dropped, not refused.
    expect(receivable(z.strictObject({ name: z.string() })).parse({ name: "a", more: 1 })).toEqual({
      name: "a",
    });
  });

  it("still refuses what no peer of this revision could send", () => {
    const open = receivable(Message);
    expect(open.safeParse(sample).success).toBe(true);
    for (const broken of [
      { ...sample, state: 3 },
      { ...sample, mode: undefined },
      { ...sample, events: [{ kind: "ended", code: "not a number" }] },
      { ...sample, events: [{ kind: 7 }] },
      { ...sample, events: [{ at: "no kind" }] },
      { ...sample, events: [1, 2, 3, 4].map(() => ({ kind: "started", at: "now" })) },
      { ...sample, pair: ["queued"] },
      null,
    ]) {
      expect(open.safeParse(broken).success, JSON.stringify(broken)).toBe(false);
    }
  });

  it("opens every host method's result and every notification, and is the same copy each time", () => {
    for (const definition of hostMethods) {
      expect(receivable(definition.result), definition.method).toBe(receivable(definition.result));
      // What the method's own schema refuses outright, its receiving copy refuses too.
      for (const wrong of [Symbol("nothing"), "text", 7, [], null]) {
        if (definition.result.safeParse(wrong).success) continue;
        expect(receivable(definition.result).safeParse(wrong).success, definition.method).toBe(
          false,
        );
      }
    }
    for (const notification of hostNotifications) {
      expect(
        () => receivable(notification.params).safeParse({}),
        notification.method,
      ).not.toThrow();
    }
  });

  it("lets RpcPeer.call read a result with a value this client doesn't know", async () => {
    let peer!: RpcPeer;
    const instance = new RpcPeer({
      onRequest: () => ({ checks: [{ name: "ledger", status: "skipped" }] }),
      send: (message) => queueMicrotask(() => peer.receiveLine(encodeLine(message).trimEnd())),
    });
    peer = new RpcPeer({
      send: (message) => queueMicrotask(() => instance.receiveLine(encodeLine(message).trimEnd())),
    });
    await expect(peer.call(instanceCheckMethod, {})).resolves.toEqual({
      checks: [{ name: "ledger", status: "skipped" }],
    });
    // A result of the wrong shape still fails.
    const broken = new RpcPeer({
      onRequest: () => ({ checks: [{ status: "ok" }] }),
      send: (message) => queueMicrotask(() => peer.receiveLine(encodeLine(message).trimEnd())),
    });
    peer = new RpcPeer({
      send: (message) => queueMicrotask(() => broken.receiveLine(encodeLine(message).trimEnd())),
    });
    const error = await peer.call(instanceCheckMethod, {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).diagnostic.code).toBe("MOSTRA_HOST_MALFORMED");
  });
});
