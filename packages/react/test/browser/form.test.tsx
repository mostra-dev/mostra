/**
 * `@mostra/react/form`: react-hook-form on Mostra fields (AU-08, D52), in a real Chromium with
 * real input events: every registered field saves as `<form id>.<name>` with its label, values
 * come back from Mostra over the form's defaults, another writer's change reaches the form, and
 * react-hook-form's `required` rule and validation errors block a submit like any field's.
 */
import type { ViewContext } from "@mostra/protocol";
import { type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFieldArray } from "react-hook-form";
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

function Conditional() {
  const form = useForm<{ name: string; extra: string; other: string }>({
    id: "c",
    defaultValues: { name: "", extra: "", other: "" },
  });
  const [shown, setShown] = useState(true);
  const submit = useSubmit();
  return (
    <form>
      <input data-testid="name" {...form.register("name")} />
      {shown && <input data-testid="extra" {...form.register("extra", { required: true })} />}
      <input data-testid="other" {...form.register("other", { required: true })} />
      <button type="button" data-testid="hide" onClick={() => setShown(false)} />
      <span data-testid="blockers">
        {submit.blockers.map((b) => `${b.fieldId}:${b.reason}`).join(",")}
      </span>
    </form>
  );
}

function Order() {
  const form = useForm<{ name: string; items: { name: string }[] }>({
    id: "order",
    defaultValues: { name: "x", items: [{ name: "" }] },
    labels: { items: "Items" },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  return (
    <form>
      <input data-testid="name" {...form.register("name")} />
      {fields.map((field, index) => (
        <input
          key={field.id}
          data-testid={`item-${index}`}
          {...form.register(`items.${index}.name` as const, { required: true })}
        />
      ))}
      <button type="button" data-testid="add" onClick={() => append({ name: "" })} />
      <button type="button" data-testid="remove-1" onClick={() => remove(1)} />
      <span data-testid="count">{fields.length}</span>
    </form>
  );
}

let resetForm: (() => void) | undefined;
function Clearable() {
  const form = useForm<{ name: string; note: string }>({
    id: "clear",
    defaultValues: { name: "", note: "" },
  });
  resetForm = () => form.reset();
  return (
    <form>
      <input data-testid="name" {...form.register("name")} />
      <input data-testid="note" {...form.register("note")} />
    </form>
  );
}

/** Types into an input the way a person does: React sees an `input` event. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render(gateway: FakeGateway, Component: () => ReactElement = Intake) {
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
      <Component />
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
    click: (id: string) =>
      element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click(),
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

  it("takes another writer's change of a field the viewer edited and saved (GPT review finding 5)", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway);
    type(page.input("name"), "Ana");
    await page.store.flush();
    await vi.waitFor(() =>
      expect(gateway.docs.viewer.fields.get("intake.name")?.value).toBe("Ana"),
    );
    gateway.write("viewer", { "intake.name": "Remote" });
    await vi.waitFor(() => expect(page.input("name").value).toBe("Remote"));
    expect(gateway.received.filter((r) => r.ops.some((o) => o.value === "Remote"))).toEqual([]);
  });

  it("releases a field whose input left the page: no blocker, no default written (GPT review finding 11)", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway, Conditional);
    await vi.waitFor(() => expect(page.blockers()).toBe("c.extra:required,c.other:required"));
    page.click("hide");
    await vi.waitFor(() => expect(page.blockers()).toBe("c.other:required"));
    // The hidden field's default isn't written; mounted ones' are (D110).
    await page.store.prepareSubmit();
    expect(gateway.docs.viewer.fields.has("c.extra")).toBe(false);
    expect(gateway.docs.viewer.fields.get("c.other")?.value).toBe("");
    expect(gateway.docs.viewer.fields.get("c.name")?.value).toBe("");
  });

  it("keeps a field array as one answer: append and remove work, and nothing removed comes back (Claude review finding 1)", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway, Order);
    type(page.input("item-0"), "apple");
    page.click("add");
    await vi.waitFor(() => page.input("item-1"));
    type(page.input("item-1"), "banana");
    page.click("add");
    await vi.waitFor(() => page.input("item-2"));
    type(page.input("item-2"), "cherry");
    await page.store.flush();
    page.click("remove-1");
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="count"]')?.textContent).toBe("2"),
    );
    await page.store.flush();
    // The page is still there, and the draft holds the array once, without the removed row.
    expect(page.input("name")).toBeTruthy();
    const ids = [...gateway.docs.viewer.fields.keys()].filter((id) => id.startsWith("order."));
    expect(ids).toEqual(["order.items"]);
    expect(gateway.docs.viewer.fields.get("order.items")?.value).toEqual([
      { name: "apple" },
      { name: "cherry" },
    ]);
    // A row's own rule runs in react-hook-form, and an empty row blocks the submit.
    page.click("add");
    await vi.waitFor(() => page.input("item-2"));
    const prepared = await page.store.prepareSubmit();
    expect(prepared.blockers).toEqual([
      expect.objectContaining({ fieldId: "order.items", reason: "invalid", label: "Items" }),
    ]);
    type(page.input("item-2"), "date");
    expect((await page.store.prepareSubmit()).blockers).toEqual([]);
    // A reload shows the same rows.
    const again = await render(gateway, Order);
    await vi.waitFor(() => expect(again.input("item-2").value).toBe("date"));
    expect(again.input("item-0").value).toBe("apple");
    expect(again.input("item-1").value).toBe("cherry");
  });

  it("saves a reset, so a submit sends what the viewer sees (Claude review finding 2)", async () => {
    const gateway = new FakeGateway();
    const page = await render(gateway, Clearable);
    type(page.input("name"), "secret draft");
    await page.store.flush();
    expect(gateway.docs.viewer.fields.get("clear.name")?.value).toBe("secret draft");
    resetForm?.();
    await vi.waitFor(() => expect(page.input("name").value).toBe(""));
    const prepared = await page.store.prepareSubmit();
    expect(prepared.unsaved).toBe(false);
    expect(gateway.docs.viewer.fields.get("clear.name")?.value).toBe("");
  });
});
