/**
 * The client runtime's hooks rendered with React in a real Chromium (AU-08, INTERFACES §2.3):
 * `useField`, `useSubmit`, `useSubmitControl`, `useSignal`, `useChoice`, `useViewer` and
 * `useArtifact`, each against a live store over a fake gateway that keeps per-field revisions
 * like the real one. The same hooks run through the real gateway and shell in tests/e2e.
 */
import type { ControlRequest, ViewContext } from "@mostra/protocol";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeProvider,
  type StandardSchema,
  useArtifact,
  useChoice,
  useField,
  useSignal,
  useSubmit,
  useSubmitControl,
  useViewer,
} from "../../src/hooks.ts";
import { MemoryJournal } from "../../src/runtime/journal.ts";
import { fieldKey, Store } from "../../src/runtime/store.ts";
import { FakeGateway } from "../fake-gateway.ts";

/** The trusted-control requests the page sent to its shell (a fake bridge). */
const controlRequests: ControlRequest[] = [];
vi.mock("../../src/shell-bridge.ts", async (original) => ({
  ...(await original<typeof import("../../src/shell-bridge.ts")>()),
  connectShell: async () => ({
    shellOrigin: "http://127.0.0.1:1",
    host: {},
    session: { csrf: "", scopes: [] },
    bridge: {
      call: async (_message: unknown, params: ControlRequest) => {
        controlRequests.push(params);
        return { shown: true };
      },
      notify: () => undefined,
      close: () => undefined,
    },
  }),
}));

const VIEW: ViewContext = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  version: { id: "ver_00000000000000000000000000", number: 3 },
  latest: { id: "ver_00000000000000000000000000", number: 3 },
  policy: { policy: "once", scope: "per-artifact" },
  submitChannels: ["shell", "artifact"],
  controls: ["submit", "choose", "approve"],
  target: "live",
};

const mounted: { root: Root; store: Store; element: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, store, element } of mounted.splice(0)) {
    root.unmount();
    store.stop();
    element.remove();
  }
  controlRequests.length = 0;
});

/** Renders `node` in a live runtime over `gateway`; returns the store and a query helper. */
async function render(
  node: ReactNode,
  options: { gateway?: FakeGateway; view?: ViewContext } = {},
): Promise<{
  store: Store;
  gateway: FakeGateway;
  text(id: string): string;
  click(id: string): void;
}> {
  const gateway = options.gateway ?? new FakeGateway();
  const store = new Store({
    mode: "live",
    transport: gateway.transport(),
    journal: new MemoryJournal(),
    view: options.view ?? VIEW,
    tab: `tab-${mounted.length}-${Math.random()}`,
    goneTabs: async () => new Set(),
  });
  store.start();
  await store.whenReady();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <RuntimeProvider store={store} mode="live">
        {node}
      </RuntimeProvider>
    </StrictMode>,
  );
  mounted.push({ root, store, element });
  const find = (id: string): HTMLElement => {
    const found = element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  await vi.waitFor(() => find("ready"));
  return {
    store,
    gateway,
    text: (id) => find(id).textContent ?? "",
    click: (id) => find(id).click(),
  };
}

describe("useField (D52)", () => {
  function Counter(props: { readonly scope?: "viewer" | "artifact" }) {
    const [count, setCount, meta] = useField("count", 0, {
      label: "Count",
      required: true,
      ...(props.scope ? { scope: props.scope } : {}),
    });
    return (
      <div>
        <span data-testid="ready" />
        <span data-testid="count">{count}</span>
        <span data-testid="save">{meta.save}</span>
        <span data-testid="by">{meta.updatedBy?.kind ?? ""}</span>
        <span data-testid="theirs">{meta.conflict ? String(meta.conflict.theirs) : ""}</span>
        <button type="button" data-testid="inc" onClick={() => setCount((value) => value + 1)} />
        <button type="button" data-testid="set" onClick={() => setCount(10)} />
        <button type="button" data-testid="keep" onClick={() => meta.conflict?.keepMine()} />
        <button type="button" data-testid="take" onClick={() => meta.conflict?.takeTheirs()} />
      </div>
    );
  }

  it("behaves like useState, saves under its ID with its label, and says saving then saved", async () => {
    const page = await render(<Counter />);
    expect(page.text("count")).toBe("0");
    page.click("inc");
    page.click("inc");
    await vi.waitFor(() => expect(page.text("count")).toBe("2"));
    await vi.waitFor(() => expect(page.text("save")).toBe("saved"));
    expect(page.gateway.docs.viewer.fields.get("count")?.value).toBe(2);
    const ops = page.gateway.received.flatMap((request) => request.ops);
    expect(ops.at(-1)).toMatchObject({ id: "count", value: 2, label: "Count", required: true });
  });

  it("starts from the value Mostra holds, not its initial value", async () => {
    const gateway = new FakeGateway();
    gateway.write("viewer", { count: 7 });
    const page = await render(<Counter />, { gateway });
    await vi.waitFor(() => expect(page.text("count")).toBe("7"));
  });

  it("shows another writer's change, and a conflict with both values that keep-mine resolves", async () => {
    const page = await render(<Counter />);
    page.gateway.write("viewer", { count: 5 });
    await vi.waitFor(() => expect(page.text("count")).toBe("5"));
    page.gateway.offline = true;
    page.click("set");
    await vi.waitFor(() => expect(page.text("save")).toBe("offline"));
    page.gateway.write("viewer", { count: 99 });
    page.gateway.offline = false;
    await page.store.flush();
    await vi.waitFor(() => expect(page.text("save")).toBe("conflict"));
    expect(page.text("count")).toBe("10");
    expect(page.text("theirs")).toBe("99");
    page.click("keep");
    await vi.waitFor(() => expect(page.text("save")).toBe("saved"));
    expect(page.gateway.docs.viewer.fields.get("count")?.value).toBe(10);
  });

  it("takes theirs when asked", async () => {
    const page = await render(<Counter />);
    page.gateway.offline = true;
    page.click("set");
    await vi.waitFor(() => expect(page.text("save")).toBe("offline"));
    page.gateway.write("viewer", { count: 3 });
    page.gateway.offline = false;
    await page.store.flush();
    await vi.waitFor(() => expect(page.text("theirs")).toBe("3"));
    page.click("take");
    await vi.waitFor(() => expect(page.text("count")).toBe("3"));
    expect(page.text("save")).toBe("saved");
  });

  it("writes artifact state with scope artifact, and says who changed it", async () => {
    const page = await render(<Counter scope="artifact" />);
    page.click("inc");
    await vi.waitFor(() => expect(page.gateway.docs.artifact.fields.get("count")?.value).toBe(1));
    await vi.waitFor(() => expect(page.text("save")).toBe("saved"));
    expect(page.gateway.docs.viewer.fields.has("count")).toBe(false);
    page.gateway.write("artifact", { count: 4 });
    await vi.waitFor(() => expect(page.text("count")).toBe("4"));
    expect(page.text("by")).toBe("agent");
  });

  it("validates with a function or a Standard Schema, and an invalid value blocks submit", async () => {
    const even: StandardSchema<number> = {
      "~standard": {
        validate: (value) =>
          typeof value === "number" && value % 2 === 0
            ? {}
            : { issues: [{ message: "Even only" }] },
      },
    };
    function Checked() {
      const [a, setA, metaA] = useField("a", 1, {
        validate: (value: number) => (value > 2 ? "At most 2" : undefined),
      });
      const [, setB, metaB] = useField("b", 2, { validate: even });
      const submit = useSubmit();
      return (
        <div>
          <span data-testid="ready" />
          <span data-testid="a">{a}</span>
          <span data-testid="errA">{metaA.error ?? ""}</span>
          <span data-testid="errB">{metaB.error ?? ""}</span>
          <span data-testid="blockers">
            {submit.blockers.map((b) => `${b.fieldId}:${b.reason}`).join(",")}
          </span>
          <button type="button" data-testid="badA" onClick={() => setA(3)} />
          <button type="button" data-testid="badB" onClick={() => setB(5)} />
        </div>
      );
    }
    const page = await render(<Checked />);
    expect(page.text("errA")).toBe("");
    page.click("badA");
    page.click("badB");
    await vi.waitFor(() => expect(page.text("errA")).toBe("At most 2"));
    await vi.waitFor(() => expect(page.text("errB")).toBe("Even only"));
    expect(page.text("blockers")).toBe("a:invalid,b:invalid");
  });
});

describe("useSubmit (D40, IN-13)", () => {
  function Form() {
    const [name, setName] = useField("name", "", { label: "Name", required: true });
    const submit = useSubmit();
    const [outcome, setOutcome] = useState("");
    return (
      <div>
        <span data-testid="ready" />
        <span data-testid="name">{name}</span>
        <span data-testid="state">{submit.state}</span>
        <span data-testid="allowed">{String(submit.allowed)}</span>
        <span data-testid="blockers">
          {submit.blockers.map((b) => `${b.fieldId}:${b.reason}:${b.label ?? ""}`).join(",")}
        </span>
        <span data-testid="outcome">{outcome}</span>
        <span data-testid="submission">{submit.submission?.id ?? ""}</span>
        <button type="button" data-testid="fill" onClick={() => setName("Ana")} />
        <button
          type="button"
          data-testid="submit"
          onClick={() =>
            void submit.submit().then(
              (done) => setOutcome(`ok:${done.channel}`),
              (error: { code?: string }) => setOutcome(`error:${error.code ?? ""}`),
            )
          }
        />
      </div>
    );
  }

  it("lists blockers by label, refuses while they stand, then submits on the artifact channel", async () => {
    const page = await render(<Form />);
    expect(page.text("allowed")).toBe("true");
    expect(page.text("blockers")).toBe("name:required:Name");
    page.click("submit");
    await vi.waitFor(() => expect(page.text("outcome")).toBe("error:MOSTRA_SUBMIT_BLOCKED"));
    expect(page.gateway.submits).toHaveLength(0);
    page.click("fill");
    await vi.waitFor(() => expect(page.text("blockers")).toBe(""));
    page.click("submit");
    await vi.waitFor(() => expect(page.text("outcome")).toBe("ok:artifact"));
    await vi.waitFor(() => expect(page.text("state")).toMatch(/submitted|delivered/));
    expect(page.text("submission")).toMatch(/^sub_/);
    // The save went first, and the submit named its revision (D110, IN-05).
    expect(page.gateway.docs.viewer.fields.get("name")?.value).toBe("Ana");
    expect(page.gateway.submits[0]?.expectedRevision).toBe(
      String(page.gateway.docs.viewer.revision),
    );
  });

  it("refuses the artifact channel where the host takes the shell's Submit only", async () => {
    const page = await render(<Form />, { view: { ...VIEW, submitChannels: ["shell"] } });
    expect(page.text("allowed")).toBe("false");
    page.click("fill");
    page.click("submit");
    await vi.waitFor(() => expect(page.text("outcome")).toBe("error:MOSTRA_SUBMIT_CHANNEL_DENIED"));
    expect(page.gateway.submits).toHaveLength(0);
  });

  it("is closed under policy none (D63)", async () => {
    const page = await render(<Form />, { view: { ...VIEW, policy: { policy: "none" } } });
    expect(page.text("allowed")).toBe("false");
    expect(page.text("state")).toBe("closed");
  });
});

describe("useSubmitControl and the trusted Choose (SH-02, D113)", () => {
  it("asks the shell to relabel its Submit, and releases it when unmounted", async () => {
    function Labelled() {
      useSubmitControl({ label: "Submit & Send", confirm: "Send these answers?" });
      return <span data-testid="ready" />;
    }
    await render(<Labelled />);
    await vi.waitFor(() =>
      expect(controlRequests).toContainEqual({
        control: "submit",
        label: "Submit & Send",
        confirm: "Send these answers?",
      }),
    );
    const { root } = mounted[0] ?? {};
    root?.render(<span />);
    await vi.waitFor(() =>
      expect(controlRequests).toContainEqual({ control: "release", submit: true }),
    );
  });

  it("asks for a trusted Choose of the candidate shown, and chooses from the page where allowed", async () => {
    function Choosing() {
      const choice = useChoice("layout", {
        candidates: [
          { id: "dense", label: "Dense" },
          { id: "airy", label: "Airy" },
        ],
        current: "airy",
      });
      return (
        <div>
          <span data-testid="ready" />
          <span data-testid="choice">{choice.choice ?? ""}</span>
          <button type="button" data-testid="choose" onClick={() => void choice.choose("dense")} />
        </div>
      );
    }
    const page = await render(<Choosing />);
    await vi.waitFor(() =>
      expect(controlRequests).toContainEqual({
        control: "choose",
        reviewSetId: "layout",
        candidates: [
          { id: "dense", label: "Dense" },
          { id: "airy", label: "Airy" },
        ],
        current: "airy",
      }),
    );
    page.click("choose");
    await vi.waitFor(() => expect(page.text("choice")).toBe("dense"));
    const op = page.gateway.received.flatMap((request) => request.ops).at(-1);
    expect(op).toMatchObject({ id: "review.layout.choice", value: "dense", label: "Dense" });
    // The shell's choice arrives like any other writer's.
    page.gateway.write("viewer", { "review.layout.choice": "airy" });
    await vi.waitFor(() => expect(page.text("choice")).toBe("airy"));
  });

  it("refuses a choice from the page where the host takes the shell's Choose only", async () => {
    let refusal = "";
    function Refused() {
      const choice = useChoice("layout");
      return (
        <div>
          <span data-testid="ready" />
          <button
            type="button"
            data-testid="choose"
            onClick={() =>
              void choice.choose("dense").catch((error: { code: string }) => {
                refusal = error.code;
              })
            }
          />
        </div>
      );
    }
    const page = await render(<Refused />, { view: { ...VIEW, submitChannels: ["shell"] } });
    page.click("choose");
    await vi.waitFor(() => expect(refusal).toBe("MOSTRA_SUBMIT_CHANNEL_DENIED"));
    expect(page.store.value(fieldKey("viewer", "review.layout.choice"), undefined)).toBeUndefined();
  });
});

describe("useSignal, useViewer and useArtifact", () => {
  it("sends a named signal with its payload", async () => {
    function Ping() {
      const ping = useSignal("ping-agent");
      return (
        <div>
          <span data-testid="ready" />
          <button type="button" data-testid="ping" onClick={() => void ping.send({ note: "hi" })} />
        </div>
      );
    }
    const page = await render(<Ping />);
    page.click("ping");
    await vi.waitFor(() =>
      expect(page.gateway.signals).toEqual([
        { viewId: VIEW.viewId, name: "ping-agent", payload: { note: "hi" } },
      ]),
    );
  });

  it("tells who the page acts as and what it shows", async () => {
    function Who() {
      const viewer = useViewer();
      const artifact = useArtifact();
      return (
        <div>
          <span data-testid="ready" />
          <span data-testid="who">{`${viewer.id}:${viewer.source}`}</span>
          <span data-testid="what">
            {`${artifact.id}:${artifact.versionId}:${artifact.version}:${artifact.viewId}:${artifact.mode}`}
          </span>
        </div>
      );
    }
    const page = await render(<Who />);
    await vi.waitFor(() => expect(page.text("who")).toBe("vwr_01J00000000000000000000000:local"));
    expect(page.text("what")).toBe(`${VIEW.artifactId}:${VIEW.version.id}:3:${VIEW.viewId}:live`);
  });
});
