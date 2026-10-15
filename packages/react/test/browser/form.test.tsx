/**
 * `@mostra/react/form`: react-hook-form on Mostra fields (AU-08, D52), in a real Chromium with
 * real input events: every registered field saves as `<form id>.<name>` with its label, values
 * come back from Mostra over the form's defaults, another writer's change reaches the form, and
 * react-hook-form's `required` rule and validation errors block a submit like any field's.
 */
import type { ViewContext } from "@mostra/protocol";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useForm } from "../../src/form.ts";
import { RuntimeProvider, useSubmit } from "../../src/hooks.ts";
import { MemoryJournal } from "../../src/runtime/journal.ts";
import { Store } from "../../src/runtime/store.ts";
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

const mounted: { root: Root; store: Store; element: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, store, element } of mounted.splice(0)) {
    root.unmount();
    store.stop();
    element.remove();
  }
});

function Intake() {
  const form = useForm<{ name: string; team: string; age: string }>({
    id: "intake",
    defaultValues: { name: "", team: "core", age: "" },
    labels: { name: "Your name", team: "Team", age: "Age" },
  });
  const submit = useSubmit();
  return (
    <form>
      <input data-testid="name" {...form.register("name", { required: true })} />
      <input data-testid="team" {...form.register("team")} />
      <input
        data-testid="age"
        {...form.register("age", { pattern: { value: /^\d*$/, message: "Digits only" } })}
      />
      <span data-testid="blockers">
        {submit.blockers.map((b) => `${b.fieldId}:${b.reason}:${b.label ?? ""}`).join(",")}
      </span>
    </form>
  );
}

/** Types into an input the way a person does: React sees an `input` event. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render(gateway: FakeGateway) {
  const store = new Store({
    mode: "live",
    transport: gateway.transport(),
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
      <Intake />
    </RuntimeProvider>,
  );
  mounted.push({ root, store, element });
  const input = (id: string): HTMLInputElement => {
    const found = element.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  await vi.waitFor(() => input("name"));
  return {
    store,
    input,
    blockers: () => element.querySelector('[data-testid="blockers"]')?.textContent ?? "",
  };
}

describe("@mostra/react/form (D52)", () => {
  it("saves each field as <form id>.<name> with its label, as the viewer types", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway);
    type(page.input("name"), "Ana");
    await page.store.flush();
    await vi.waitFor(() =>
      expect(gateway.docs.viewer.fields.get("intake.name")?.value).toBe("Ana"),
    );
    const op = gateway.received
      .flatMap((request) => request.ops)
      .find((o) => o.id === "intake.name");
    expect(op).toMatchObject({ label: "Your name" });
  });

  it("fills the form from what Mostra holds, over its defaults, and follows other writers", async () => {
    const gateway = new FakeGateway();
    gateway.write("viewer", { "intake.name": "Ben" });
    const page = await render(gateway);
    await vi.waitFor(() => expect(page.input("name").value).toBe("Ben"));
    expect(page.input("team").value).toBe("core");
    gateway.write("viewer", { "intake.team": "design" });
    await vi.waitFor(() => expect(page.input("team").value).toBe("design"));
  });

  it("makes react-hook-form's required rule and validation errors the submit's blockers", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway);
    await vi.waitFor(() => expect(page.blockers()).toBe("intake.name:required:Your name"));
    type(page.input("name"), "Ana");
    type(page.input("age"), "forty");
    await vi.waitFor(() => expect(page.blockers()).toBe(""));
    // react-hook-form validates on submit: preparing either channel's submit runs it.
    const prepared = await page.store.prepareSubmit();
    expect(prepared.blockers).toEqual([{ fieldId: "intake.age", label: "Age", reason: "invalid" }]);
    await vi.waitFor(() => expect(page.blockers()).toBe("intake.age:invalid:Age"));
    type(page.input("age"), "40");
    expect((await page.store.prepareSubmit()).blockers).toEqual([]);
  });
});
