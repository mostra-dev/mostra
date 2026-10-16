import type { ViewContext } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { MostraError } from "../src/runtime/errors.ts";
import { MemoryJournal } from "../src/runtime/journal.ts";
import { fieldKey, Store } from "../src/runtime/store.ts";
import { FakeGateway } from "./fake-gateway.ts";

const VIEW: ViewContext = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  version: { id: "ver_00000000000000000000000000", number: 1 },
  latest: { id: "ver_00000000000000000000000000", number: 1 },
  policy: { policy: "once", scope: "per-artifact" },
  submitChannels: ["shell", "artifact"],
  controls: ["submit", "choose", "approve"],
  target: "live",
};

const stores: Store[] = [];

function open(
  gateway: FakeGateway,
  options: {
    journal?: MemoryJournal;
    tab?: string;
    view?: ViewContext;
    scopes?: string[];
    gone?: string[];
  } = {},
): Store {
  const store = new Store({
    mode: "live",
    transport: gateway.transport(),
    journal: options.journal ?? new MemoryJournal(),
    view: options.view ?? VIEW,
    ...(options.scopes ? { scopes: options.scopes } : {}),
    tab: options.tab ?? `tab-${stores.length}`,
    goneTabs: async (tabs) => new Set(tabs.filter((tab) => options.gone?.includes(tab) ?? true)),
  });
  stores.push(store);
  store.start();
  return store;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  for (const store of stores.splice(0)) store.stop();
});

const v = (id: string) => fieldKey("viewer", id);

describe("saving (IN-01, IN-02)", () => {
  it("shows an edit at once, sends it after the debounce in one mutation, and calls it saved", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.set("viewer", "name", "Ana", { label: "Name" });
    store.set("viewer", "name", "Ana B");
    expect(store.value(v("name"), "")).toBe("Ana B");
    expect(store.save(v("name"))).toBe("saving");
    expect(gateway.received).toHaveLength(0);
    await store.flush();
    expect(gateway.received).toHaveLength(1);
    expect(gateway.received[0]?.ops).toEqual([{ id: "name", value: "Ana B", label: "Name" }]);
    expect(gateway.docs.viewer.fields.get("name")?.value).toBe("Ana B");
    expect(store.save(v("name"))).toBe("saved");
    expect(store.pageSave()).toBe("saved");
  });

  it("tells its subscribers when the last save landed, so the page and the shell say saved", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.pageSave()));
    store.set("viewer", "name", "Ana");
    await store.flush();
    expect(seen.at(-1)).toBe("saved");
  });

  it("bases an edit made while the previous one is in flight on that one's answer, never on itself", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.set("viewer", "notes", "a");
    const first = store.flush();
    store.set("viewer", "notes", "ab"); // While the first save is in flight.
    await first;
    await store.flush();
    await settle();
    expect(gateway.received.map((request) => request.ops[0]?.value)).toEqual(["a", "ab"]);
    expect(gateway.received[1]?.baseRevision).toBe("1");
    expect(store.conflict(v("notes"))).toBeUndefined();
    expect(gateway.docs.viewer.fields.get("notes")?.value).toBe("ab");
  });

  it("keeps a refused value on the page, not truncated, with the reason, and doesn't resend it", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    gateway.refuseWith = "MOSTRA_FIELD_TOO_LARGE";
    store.set("viewer", "essay", "x".repeat(50));
    await store.flush();
    gateway.refuseWith = undefined;
    expect(store.value(v("essay"), "")).toBe("x".repeat(50));
    expect(store.refusal(v("essay"))?.code).toBe("MOSTRA_FIELD_TOO_LARGE");
    expect(store.save(v("essay"))).toBe("offline");
    await store.flush();
    expect(gateway.received).toHaveLength(1);
    store.set("viewer", "essay", "short");
    await store.flush();
    expect(gateway.docs.viewer.fields.get("essay")?.value).toBe("short");
  });
});

describe("tabs and other writers (IN-03)", () => {
  it("converges two tabs editing different fields through the event stream", async () => {
    const gateway = new FakeGateway();
    const one = open(gateway);
    const two = open(gateway);
    await Promise.all([one.whenReady(), two.whenReady()]);
    one.set("viewer", "a", 1);
    two.set("viewer", "b", 2);
    await Promise.all([one.flush(), two.flush()]);
    await settle();
    for (const store of [one, two]) {
      expect(store.value(v("a"), undefined)).toBe(1);
      expect(store.value(v("b"), undefined)).toBe(2);
      expect(store.conflict(v("a"))).toBeUndefined();
      expect(store.conflict(v("b"))).toBeUndefined();
    }
  });

  it("surfaces the same field edited in two tabs as a conflict with both values, never an overwrite", async () => {
    const gateway = new FakeGateway();
    const one = open(gateway);
    const two = open(gateway);
    await Promise.all([one.whenReady(), two.whenReady()]);
    one.set("viewer", "title", "mine");
    two.set("viewer", "title", "theirs");
    await two.flush();
    await one.flush();
    expect(gateway.docs.viewer.fields.get("title")?.value).toBe("theirs");
    const conflict = one.conflict(v("title"));
    expect(conflict?.theirs).toBe("theirs");
    expect(one.value(v("title"), "")).toBe("mine");
    expect(one.save(v("title"))).toBe("conflict");
    one.keepMine(v("title"));
    await one.flush();
    await settle();
    expect(gateway.docs.viewer.fields.get("title")?.value).toBe("mine");
    expect(one.conflict(v("title"))).toBeUndefined();
    expect(two.value(v("title"), "")).toBe("mine");
  });

  it("takes theirs when the viewer chooses it, and drops the viewer's value", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.set("artifact", "status", "draft");
    gateway.write("artifact", { status: "approved" }); // An agent, before the viewer's save.
    await store.flush();
    const key = fieldKey("artifact", "status");
    expect(store.conflict(key)?.theirs).toBe("approved");
    store.takeTheirs(key);
    expect(store.value(key, undefined)).toBe("approved");
    expect(store.unsaved()).toBe(false);
  });

  it("conflicts when another writer changed the field after the viewer's edit, even before the event arrives", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.set("viewer", "x", "page");
    // The agent writes after the edit was made; the page's event stream sees it next.
    gateway.write("viewer", { x: "agent" });
    await settle();
    await store.flush();
    expect(gateway.docs.viewer.fields.get("x")?.value).toBe("agent");
    expect(store.conflict(v("x"))?.theirs).toBe("agent");
  });
});

describe("offline and the journal (IN-02, IN-04)", () => {
  it("queues edits while offline and replays them in order when the network returns", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    gateway.offline = true;
    store.set("viewer", "a", 1);
    await store.flush();
    store.set("viewer", "a", 2);
    store.set("viewer", "b", 3);
    await store.flush();
    expect(store.save(v("a"))).toBe("offline");
    expect(gateway.docs.viewer.fields.size).toBe(0);
    gateway.offline = false;
    await store.flush();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await store.flush();
    await settle();
    expect(gateway.docs.viewer.fields.get("a")?.value).toBe(2);
    expect(gateway.docs.viewer.fields.get("b")?.value).toBe(3);
    expect(store.save(v("a"))).toBe("saved");
  });

  it("sends waiting saves soon after the event stream shows the gateway is back, not after the whole backoff", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    gateway.offline = true;
    // Several failures: the backoff grows to seconds.
    for (const value of [1, 2, 3, 4]) {
      store.set("viewer", "a", value);
      await store.flush();
    }
    expect(store.save(v("a"))).toBe("offline");
    gateway.offline = false;
    // Another writer's change reaches the page on its stream: the gateway answers again.
    gateway.write("artifact", { team: "x" });
    // Well inside the 2 s the backoff had grown to: the queued save, then the edit made after it
    // (sent once that one's answer gave it its base, after the usual debounce).
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await settle();
    expect(gateway.docs.viewer.fields.get("a")?.value).toBe(4);
    expect(store.save(v("a"))).toBe("saved");
  });

  it("lets the next page adopt a closed tab's unsent edits and in-flight mutations, replaying each once", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const closed = open(gateway, { journal, tab: "closed" });
    await closed.whenReady();
    gateway.offline = true;
    closed.set("viewer", "sent", "kept");
    await closed.flush(); // A mutation, never answered.
    closed.set("viewer", "typed", "not sent"); // A pending edit, never sent.
    await settle();
    closed.stop();
    gateway.offline = false;
    const next = open(gateway, { journal, tab: "next", gone: ["closed"] });
    await next.whenReady();
    await next.flush();
    await settle();
    expect(gateway.docs.viewer.fields.get("sent")?.value).toBe("kept");
    expect(gateway.docs.viewer.fields.get("typed")?.value).toBe("not sent");
    const contents = await journal.load("vwr_01J00000000000000000000000");
    expect(contents.pending).toHaveLength(0);
    expect(contents.mutations).toHaveLength(0);
  });

  it("leaves an open tab's journal entries alone", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const live = open(gateway, { journal, tab: "live" });
    await live.whenReady();
    live.set("viewer", "mine", "unsent");
    await settle();
    const other = open(gateway, { journal, tab: "other", gone: [] });
    await other.whenReady();
    await other.flush();
    expect(gateway.received).toHaveLength(0);
    expect(other.value(v("mine"), undefined)).toBeUndefined();
  });

  it("replays an adopted mutation from another link's view as this page's view", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const elsewhere = open(gateway, {
      journal,
      tab: "elsewhere",
      view: { ...VIEW, viewId: "vw_01J11111111111111111111111" },
    });
    await elsewhere.whenReady();
    gateway.offline = true;
    elsewhere.set("viewer", "q", "a");
    await elsewhere.flush();
    elsewhere.stop();
    gateway.offline = false;
    const here = open(gateway, { journal, tab: "here", gone: ["elsewhere"] });
    await here.whenReady();
    await here.flush();
    await settle();
    expect(gateway.docs.viewer.fields.get("q")?.value).toBe("a");
    expect(gateway.received.at(-1)?.viewId).toBe(VIEW.viewId);
  });
});

describe("submitting (IN-02, D110, D40)", () => {
  it("writes the defaults the viewer saw, flushes, and reports required blockers before a submit", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.register({ id: "layout", scope: "viewer", initial: "left", label: "Layout" });
    store.register({ id: "why", scope: "viewer", initial: "", label: "Why", required: true });
    store.register({ id: "unmounted-default", scope: "viewer", initial: undefined });
    const prepared = await store.prepareSubmit();
    expect(gateway.docs.viewer.fields.get("layout")?.value).toBe("left");
    expect(prepared.blockers).toEqual([{ fieldId: "why", label: "Why", reason: "required" }]);
    await expect(store.submit()).rejects.toMatchObject({ code: "MOSTRA_SUBMIT_BLOCKED" });
    store.set("viewer", "why", "Because");
    const submission = await store.submit();
    expect(gateway.submits.at(-1)?.expectedRevision).toBe(String(gateway.docs.viewer.revision));
    expect(submission.channel).toBe("artifact");
    expect(store.submitState()).toBe("submitted");
  });

  it("refuses the artifact channel where the host takes the shell's Submit only", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway, { view: { ...VIEW, submitChannels: ["shell"] } });
    await store.whenReady();
    await expect(store.submit()).rejects.toMatchObject({ code: "MOSTRA_SUBMIT_CHANNEL_DENIED" });
    expect(gateway.submits).toHaveLength(0);
  });

  it("saves nothing for a view-only link", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway, { scopes: ["view"] });
    await store.whenReady();
    expect(store.save(v("x"))).toBe("readonly");
    expect(() => store.set("viewer", "x", 1)).toThrow(MostraError);
  });

  it("doesn't submit for a link without the submit scope", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway, { scopes: ["view", "draft"] });
    await store.whenReady();
    expect(store.canSubmit()).toBe(false);
    await expect(store.submit()).rejects.toMatchObject({ code: "MOSTRA_HYGIENE_SCOPE_DENIED" });
    expect(gateway.submits).toHaveLength(0);
  });
});

describe("local mode (D111)", () => {
  it("keeps values in this browser and refuses to submit", async () => {
    const values = new Map<string, string>();
    const store = new Store({
      mode: "local",
      journal: new MemoryJournal(),
      tab: "t",
      local: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
      },
    });
    store.start();
    store.set("viewer", "name", "Ana");
    expect(store.value(v("name"), "")).toBe("Ana");
    expect(values.get("mostra.field.viewer:name")).toBe('"Ana"');
    await expect(store.submit()).rejects.toMatchObject({ code: "MOSTRA_TARGET_UNAVAILABLE" });
    await expect(store.signal("ping")).rejects.toMatchObject({ code: "MOSTRA_TARGET_UNAVAILABLE" });
  });
});

describe("GPT review findings (WP-07)", () => {
  const VIEWER = "vwr_01J00000000000000000000000";

  it("finding 1: a conflict left unresolved comes back as a conflict on the next page, never an overwrite", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const closed = open(gateway, { journal, tab: "closed" });
    await closed.whenReady();
    closed.set("viewer", "x", "mine");
    gateway.write("viewer", { x: "theirs" }, { quiet: true });
    await closed.flush();
    expect(closed.conflict(v("x"))?.theirs).toBe("theirs");
    closed.stop();
    await settle();
    const next = open(gateway, { journal, tab: "next", gone: ["closed"] });
    await next.whenReady();
    await next.flush();
    await settle();
    expect(gateway.docs.viewer.fields.get("x")?.value).toBe("theirs");
    expect(next.conflict(v("x"))?.theirs).toBe("theirs");
    expect(next.value(v("x"), "")).toBe("mine");
    next.keepMine(v("x"));
    await next.flush();
    expect(gateway.docs.viewer.fields.get("x")?.value).toBe("mine");
  });

  it("finding 4: a sensitive change the page hasn't got holds the submit until a snapshot brings it, and an edit of it conflicts", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    let release = (): void => undefined;
    gateway.holdSnapshots = new Promise<void>((resolve) => {
      release = resolve;
    });
    gateway.writeSensitive("viewer", { pin: "9999", code: "4242" });
    await settle();
    let prepared: { unsaved: boolean } | undefined;
    const preparing = store.prepareSubmit().then((value) => {
      prepared = value;
    });
    await settle();
    expect(prepared).toBeUndefined();
    // An edit of a value the page hasn't got is based on what it had: a conflict with theirs.
    store.set("viewer", "pin", "1111");
    await store.flush();
    expect(store.conflict(v("pin"))?.theirs).toBe("9999");
    expect(gateway.docs.viewer.fields.get("pin")?.value).toBe("9999");
    store.takeTheirs(v("pin"));
    await settle();
    expect(prepared).toBeUndefined();
    gateway.holdSnapshots = undefined;
    release();
    await preparing;
    expect(prepared?.unsaved).toBe(false);
    expect(store.value(v("code"), "")).toBe("4242");
  });

  it("finding 6: edits of one field left by two closed tabs are both sent; the second meets the first as a conflict", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const a = open(gateway, { journal, tab: "a" });
    const b = open(gateway, { journal, tab: "b" });
    await a.whenReady();
    await b.whenReady();
    a.set("viewer", "x", "from a");
    await new Promise((resolve) => setTimeout(resolve, 5));
    b.set("viewer", "x", "from b");
    a.stop();
    b.stop();
    await settle();
    const next = open(gateway, { journal, tab: "next", gone: ["a", "b"] });
    await next.whenReady();
    await next.flush();
    await settle();
    expect(gateway.received.map((request) => request.ops[0]?.value)).toEqual(["from a", "from b"]);
    expect(gateway.docs.viewer.fields.get("x")?.value).toBe("from a");
    expect(next.conflict(v("x"))?.theirs).toBe("from a");
    expect(next.value(v("x"), "")).toBe("from b");
  });

  it("finding 7: a refused value is still in the journal for the next page", async () => {
    const gateway = new FakeGateway();
    const journal = new MemoryJournal();
    const store = open(gateway, { journal });
    await store.whenReady();
    gateway.refuseWith = "MOSTRA_FIELD_TOO_LARGE";
    store.set("viewer", "essay", "x".repeat(50));
    await store.flush();
    await settle();
    const contents = await journal.load(VIEWER);
    expect(contents.mutations).toEqual([]);
    expect(contents.pending.map((entry) => entry.op.value)).toEqual(["x".repeat(50)]);
  });

  it("finding 8: a snapshot older than events already applied doesn't roll fields back", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    let release = (): void => undefined;
    gateway.holdSnapshots = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The sensitive write asks for a snapshot, read now and answered after a newer event.
    gateway.writeSensitive("viewer", { pin: "9999" });
    await settle();
    gateway.write("viewer", { name: "new" });
    await settle();
    expect(store.value(v("name"), "")).toBe("new");
    gateway.holdSnapshots = undefined;
    release();
    await settle();
    expect(store.value(v("name"), "")).toBe("new");
    expect(store.value(v("pin"), "")).toBe("9999");
  });

  it("finding 9: saves sent as a hidden page's keepalive leave the queue when answered", async () => {
    const gateway = new FakeGateway();
    const store = open(gateway);
    await store.whenReady();
    store.set("viewer", "x", 1);
    await store.flush({ keepalive: true });
    await settle();
    expect(gateway.docs.viewer.fields.get("x")?.value).toBe(1);
    expect(store.unsaved()).toBe(false);
    expect(store.pageSave()).toBe("saved");
  });
});
