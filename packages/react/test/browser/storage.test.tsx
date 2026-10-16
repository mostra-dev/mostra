/**
 * `window.storage` against a compatibility suite modeled on Claude artifacts' persistent storage
 * (AU-08, D53, D112), in a real Chromium: the calls agents learned (`get`, `set`, `delete`,
 * `list`, each with `shared`) and the shapes they resolve with, personal and shared keys kept
 * apart, values that are any JSON, and Mostra's documented differences: a missing key is `null`,
 * a value is at most 1 MiB, and two writers of one key end with the last write.
 *
 * Claude's own reference (support.claude.com, "What are artifacts", checked 2026-10-15) documents
 * personal and shared storage without the API's signatures; the shapes below are the ones
 * Claude-written artifacts use (VERIFIED_FACTS, WP-07).
 */
import type { ViewContext } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryJournal } from "../../src/runtime/journal.ts";
import { fieldKey, Store } from "../../src/runtime/store.ts";
import { type ClaudeCompatibleStorage, createStorage, installStorage } from "../../src/storage.ts";
import { FakeGateway } from "../fake-gateway.ts";

const VIEW: ViewContext = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  version: { id: "ver_00000000000000000000000000", number: 1 },
  latest: { id: "ver_00000000000000000000000000", number: 1 },
  policy: { policy: "once", scope: "per-artifact" },
  submitChannels: ["shell", "artifact"],
  controls: ["submit"],
  target: "live",
};

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.stop();
});

async function storage(
  gateway = new FakeGateway(),
): Promise<{ storage: ClaudeCompatibleStorage; store: Store; gateway: FakeGateway }> {
  const store = new Store({
    mode: "live",
    transport: gateway.transport(),
    journal: new MemoryJournal(),
    view: VIEW,
    tab: `tab-${stores.length}-${Math.random()}`,
    goneTabs: async () => new Set(),
  });
  stores.push(store);
  store.start();
  await store.whenReady();
  return { storage: createStorage(store), store, gateway };
}

describe("the calls and shapes Claude artifacts use", () => {
  it("installs window.storage with get, set, delete and list", async () => {
    const { store } = await storage();
    installStorage(store);
    expect(typeof window.storage.get).toBe("function");
    expect(typeof window.storage.set).toBe("function");
    expect(typeof window.storage.delete).toBe("function");
    expect(typeof window.storage.list).toBe("function");
  });

  it("set resolves with { key, value, shared } once saved, and get returns the same", async () => {
    const { storage: s, gateway } = await storage();
    // Claude artifacts store JSON text; any JSON value works here too.
    const text = JSON.stringify({ score: 12, name: "Ana" });
    expect(await s.set("game-state", text)).toEqual({
      key: "game-state",
      value: text,
      shared: false,
    });
    expect(gateway.docs.viewer.fields.get("storage.game-state")?.value).toBe(text);
    expect(await s.get("game-state")).toEqual({ key: "game-state", value: text, shared: false });
    expect(JSON.parse((await s.get("game-state"))?.value as string)).toEqual({
      score: 12,
      name: "Ana",
    });
    await s.set("prefs", { theme: "dark", sizes: [1, 2] });
    expect((await s.get("prefs"))?.value).toEqual({ theme: "dark", sizes: [1, 2] });
  });

  it("a missing key resolves null (D112)", async () => {
    const { storage: s } = await storage();
    expect(await s.get("never-set")).toBeNull();
    expect(await s.get("never-set", true)).toBeNull();
  });

  it("delete resolves with { key, deleted: true, shared } and the key is gone", async () => {
    const { storage: s, gateway } = await storage();
    await s.set("draft", "hello");
    expect(await s.delete("draft")).toEqual({ key: "draft", deleted: true, shared: false });
    expect(await s.get("draft")).toBeNull();
    expect(gateway.docs.viewer.fields.get("storage.draft")?.value).toBeUndefined();
  });

  it("list resolves with { keys, prefix?, shared }, filtered by prefix", async () => {
    const { storage: s } = await storage();
    await s.set("todo:1", "a");
    await s.set("todo:2", "b");
    await s.set("note", "c");
    expect((await s.list()).keys.sort()).toEqual(["note", "todo:1", "todo:2"]);
    expect(await s.list("todo:")).toEqual({
      keys: ["todo:1", "todo:2"],
      prefix: "todo:",
      shared: false,
    });
    expect(await s.list("nothing")).toEqual({ keys: [], prefix: "nothing", shared: false });
  });

  it("keeps personal and shared keys apart: personal is the viewer's draft, shared is artifact state", async () => {
    const { storage: s, gateway } = await storage();
    await s.set("count", 1);
    await s.set("count", 100, true);
    expect((await s.get("count"))?.value).toBe(1);
    expect(await s.get("count", true)).toEqual({ key: "count", value: 100, shared: true });
    expect(gateway.docs.viewer.fields.get("storage.count")?.value).toBe(1);
    expect(gateway.docs.artifact.fields.get("storage.count")?.value).toBe(100);
    expect((await s.list(undefined, true)).keys).toEqual(["count"]);
  });

  it("sees what other viewers and agents write to shared keys", async () => {
    const { storage: s, gateway } = await storage();
    gateway.write("artifact", { "storage.leaderboard": ["Ana", "Ben"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await s.get("leaderboard", true)).toEqual({
      key: "leaderboard",
      value: ["Ana", "Ben"],
      shared: true,
    });
  });
});

describe("Mostra's differences, by design (D112)", () => {
  it("refuses a value over 1 MiB with MOSTRA_FIELD_TOO_LARGE, keeping nothing truncated", async () => {
    const { storage: s, gateway } = await storage();
    gateway.maxValueBytes = 1024 * 1024;
    const big = "x".repeat(1024 * 1024 + 1);
    await expect(s.set("big", big)).rejects.toMatchObject({ code: "MOSTRA_FIELD_TOO_LARGE" });
    expect(gateway.docs.viewer.fields.get("storage.big")).toBeUndefined();
    expect(await s.get("big")).toBeNull();
  });

  it("refuses a key that can't be a field ID with MOSTRA_FIELD_ID_INVALID", async () => {
    const { storage: s } = await storage();
    for (const key of ["", "a..b", "trailing.", "tab\there"]) {
      await expect(s.set(key, 1)).rejects.toMatchObject({ code: "MOSTRA_FIELD_ID_INVALID" });
    }
  });

  it("ends with the last write when two writers change one key", async () => {
    const { storage: s, gateway, store } = await storage();
    await s.set("status", "first");
    // Another writer changes it between this page's last read and its write.
    gateway.write("viewer", { "storage.status": "theirs" }, { quiet: true });
    const before = gateway.received.length;
    await s.set("status", "mine");
    // The first write met the other writer's change, and was sent again over it.
    expect(gateway.received.length - before).toBe(2);
    expect(gateway.docs.viewer.fields.get("storage.status")?.value).toBe("mine");
    expect(store.conflict(fieldKey("viewer", "storage.status"))).toBeFalsy();
  });

  it("resolves a write only once Mostra has it: offline, set waits (GPT review finding 10)", async () => {
    const { storage: s, gateway } = await storage();
    gateway.offline = true;
    let done = false;
    const writing = s.set("note", "kept").then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(done).toBe(false);
    gateway.offline = false;
    window.dispatchEvent(new Event("online"));
    await writing;
    expect(gateway.docs.viewer.fields.get("storage.note")?.value).toBe("kept");
  });
});
