/**
 * `useAction` and `useLive` in a real React DOM (AU-08, AC-02, AC-03, D54, D56): a double click
 * without a key joins the hook's run, and a click after it ends starts another; a keyed hook finds
 * its run again when the page loads; progress, log, partial results and the result render as the
 * stream brings them; live sources render their value, shared by every component showing them.
 */
import {
  type Frame,
  type RunState,
  serializeAll,
  ValueWriter,
  type ViewContext,
} from "@mostra/protocol";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeProvider } from "../../src/hooks.ts";
import { MemoryJournal } from "../../src/runtime/journal.ts";
import { Store } from "../../src/runtime/store.ts";
import type { Transport } from "../../src/runtime/transport.ts";
import { useAction, useLive } from "../../src/server-hooks.ts";
import { createServerReference } from "../../src/server-reference.ts";
import { FakeGateway } from "../fake-gateway.ts";

const VIEW: ViewContext = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  version: { id: "ver_00000000000000000000000000", number: 1 },
  latest: { id: "ver_00000000000000000000000000", number: 1 },
  policy: { policy: "none" },
  submitChannels: ["shell", "artifact"],
  controls: [],
  target: "live",
};

const send = createServerReference("actions.ts#send") as unknown as (id: string) => Promise<{
  sent: boolean;
}>;

const result = async (value: unknown): Promise<Frame[][]> => {
  const batches: Frame[][] = [];
  const writer = new ValueWriter({ mode: "result", onBatch: (batch) => batches.push(batch) });
  await writer.write(value);
  await writer.done;
  return batches;
};

/** The fake gateway's transport, with runs and live sources kept as Mostra keeps them. */
function serverTransport(gateway: FakeGateway) {
  const runs = new Map<string, RunState>();
  const starts: unknown[] = [];
  const liveReads: unknown[] = [];
  let next = 1;
  const transport: Transport = {
    ...gateway.transport(),
    call: async function* () {
      yield { end: { status: "succeeded" as const } };
    },
    startRun: async (request) => {
      starts.push(request);
      const keyed = [...runs.values()].find(
        (run) => request.key !== undefined && run.key === request.key,
      );
      if (keyed) return keyed;
      const runId = `run_${String(next++).padStart(26, "0")}`;
      const state: RunState = {
        runId,
        fnId: request.fnId,
        ...(request.key !== undefined ? { key: request.key } : {}),
        status: "running",
        log: [],
        batches: [],
        startedAt: new Date().toISOString(),
      };
      runs.set(runId, state);
      return state;
    },
    attachRuns: async (request) => ({
      runs: [
        ...(request.runIds ?? []).flatMap((id) => {
          const run = runs.get(id);
          return run ? [run] : [];
        }),
        ...(request.keyed ?? []).flatMap((entry) =>
          [...runs.values()].filter((run) => run.fnId === entry.fnId && run.key === entry.key),
        ),
      ],
    }),
    cancelRun: async (runId) => {
      const run = { ...(runs.get(runId) as RunState), status: "cancelled" as const };
      runs.set(runId, run);
      return run;
    },
    live: async (request) => {
      liveReads.push(request.keys);
      return {
        sources: await Promise.all(
          request.keys.map(async (entry) => ({
            key: entry.key,
            revision: "1",
            at: "2026-10-16T00:00:00.000Z",
            value: await serializeAll({ unread: 3 }, { mode: "argument" }),
          })),
        ),
      };
    },
  };
  return { transport, runs, starts, liveReads };
}

const mounted: { root: Root; store: Store; element: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, store, element } of mounted.splice(0)) {
    root.unmount();
    store.stop();
    element.remove();
  }
});

async function render(transport: Transport, node: React.ReactNode) {
  const store = new Store({
    mode: "live",
    transport,
    journal: new MemoryJournal(),
    view: VIEW,
    tab: `tab-${Math.random()}`,
    goneTabs: async () => new Set(),
  });
  store.start();
  await store.whenReady();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  root.render(
    <RuntimeProvider store={store} mode="live">
      {node}
    </RuntimeProvider>,
  );
  mounted.push({ root, store, element });
  await vi.waitFor(() => expect(element.querySelector("[data-testid]")).not.toBeNull());
  const text = (id: string): string =>
    element.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
  const click = (id: string): void =>
    element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
  return { store, text, click };
}

function Send(props: { readonly keyed?: boolean }) {
  const action = useAction(send, props.keyed ? { key: "send.m1" } : undefined);
  return (
    <div>
      <button
        type="button"
        data-testid="send"
        onClick={() => void action.run("m1").catch(() => {})}
      >
        Send
      </button>
      <output data-testid="status">{action.status}</output>
      <output data-testid="pending">{String(action.isPending)}</output>
      <output data-testid="progress">{action.progress?.message ?? ""}</output>
      <output data-testid="log">{action.log.join("|")}</output>
      <output data-testid="sent">{action.data ? String(action.data.sent) : ""}</output>
      <output data-testid="run">{action.runId ?? ""}</output>
    </div>
  );
}

/** A component whose action key changes while it stays mounted. */
function Switching() {
  const [key, setKey] = useState("send.a");
  const action = useAction(send, { key });
  return (
    <div>
      <button
        type="button"
        data-testid="send"
        onClick={() => void action.run("m1").catch(() => {})}
      >
        Send
      </button>
      <button type="button" data-testid="switch" onClick={() => setKey("send.b")}>
        Switch
      </button>
      <output data-testid="status">{action.status}</output>
      <output data-testid="run">{action.runId ?? ""}</output>
    </div>
  );
}

describe("useAction (AC-02, AC-03, D54)", () => {
  it("joins the hook's run on a double click, renders its stream, and starts anew after it ends", async () => {
    const server = serverTransport(new FakeGateway());
    const page = await render(server.transport, <Send />);
    page.click("send");
    page.click("send");
    await vi.waitFor(() => expect(page.text("status")).toBe("running"));
    expect(server.starts).toHaveLength(1);
    expect(page.text("pending")).toBe("true");
    const runId = page.text("run");
    page.store.server.receive({
      kind: "run",
      run: {
        runId,
        status: "running",
        progress: { message: "Sending…" },
        logFrom: 0,
        log: ["connecting"],
        batchFrom: 0,
        batches: [],
      },
    });
    await vi.waitFor(() => expect(page.text("progress")).toBe("Sending…"));
    expect(page.text("log")).toBe("connecting");
    page.store.server.receive({
      kind: "run",
      run: {
        runId,
        status: "succeeded",
        logFrom: 1,
        log: ["sent"],
        batchFrom: 0,
        batches: await result({ sent: true }),
      },
    });
    await vi.waitFor(() => expect(page.text("sent")).toBe("true"));
    expect(page.text("status")).toBe("succeeded");
    expect(page.text("log")).toBe("connecting|sent");
    // The run ended: the next click is a new invocation, as the author intends.
    page.click("send");
    await vi.waitFor(() => expect(server.starts).toHaveLength(2));
  });

  it("finds its keyed run again when the page loads (a reload, another tab)", async () => {
    const server = serverTransport(new FakeGateway());
    const first = await render(server.transport, <Send keyed />);
    first.click("send");
    await vi.waitFor(() => expect(first.text("status")).toBe("running"));
    const runId = first.text("run");
    // Another page of the same artifact shows the run without starting one.
    const second = await render(server.transport, <Send keyed />);
    await vi.waitFor(() => expect(second.text("run")).toBe(runId));
    expect(second.text("status")).toBe("running");
    second.click("send");
    await vi.waitFor(() => expect(server.starts).toHaveLength(2));
    // The second click joined the keyed run: no other run exists.
    expect(server.runs.size).toBe(1);
  });

  it("forgets the old key's run when the key changes, and starts the new key's own (GPT review finding 8)", async () => {
    const server = serverTransport(new FakeGateway());
    const page = await render(server.transport, <Switching />);
    page.click("send");
    await vi.waitFor(() => expect(page.text("status")).toBe("running"));
    const first = page.text("run");
    page.click("switch");
    await vi.waitFor(() => expect(page.text("status")).toBe("idle"));
    expect(page.text("run")).toBe("");
    page.click("send");
    await vi.waitFor(() => expect(page.text("status")).toBe("running"));
    expect(server.starts).toHaveLength(2);
    expect(page.text("run")).not.toBe(first);
    expect(server.starts.at(-1)).toMatchObject({ key: "send.b" });
  });
});

function Inbox(props: { readonly testId: string }) {
  const live = useLive("inbox");
  return (
    <output data-testid={props.testId}>
      {live.isLoading ? "loading" : String((live.data as { unread: number }).unread)}
    </output>
  );
}

describe("useLive (AC-07, D56)", () => {
  it("renders a source's value, read once for every component showing it", async () => {
    const server = serverTransport(new FakeGateway());
    const page = await render(
      server.transport,
      <>
        <Inbox testId="a" />
        <Inbox testId="b" />
      </>,
    );
    await vi.waitFor(() => expect(page.text("a")).toBe("3"));
    expect(page.text("b")).toBe("3");
    expect(server.liveReads).toHaveLength(1);
    page.store.server.receive({
      kind: "live",
      live: {
        key: "inbox",
        revision: "2",
        value: await serializeAll({ unread: 4 }, { mode: "argument" }),
      },
    });
    await vi.waitFor(() => expect(page.text("a")).toBe("4"));
    expect(page.text("b")).toBe("4");
  });
});
