/// <reference lib="dom" />
/**
 * The smoke test (ROUND-3 §9, D55, D72, D137): uses every enabled control of the rendered page
 * once, within 200 interactions or 60 s, and reports what it observed.
 *
 * - Buttons, tabs, menus and other triggers are clicked; tooltip and hover-card triggers hovered;
 *   context-menu triggers right-clicked. Disabled controls and already-active ones (the selected
 *   tab, the current page) are left alone, as EVAL-01's calibration showed they rightly do nothing.
 * - Inputs, text areas, selects, checkboxes and radios are filled or toggled with values that fit
 *   their type, then blurred so the page saves; one whose value saves nothing is unbound (a hint).
 * - Links to other origins, `mailto:`, downloads and links that open a new tab aren't followed.
 * - A control with no observable effect (no change to the page, no request, no saved field, no
 *   navigation) is a warning that says what was observed, never an error (D72).
 * - Actions that didn't opt into `dryRun()` are refused by the sandbox; faults that follow from
 *   the refusal are attributed to it (see `judge`).
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import type { Frame, Locator, Page } from "playwright-core";
import type { NetworkWatch } from "./network.ts";
import { judge, recorded, settle } from "./observe.ts";

/** One control the smoke test found. */
interface Control {
  readonly index: number;
  readonly tag: string;
  readonly role: string;
  readonly type: string;
  readonly name: string;
  /** How it is used. */
  readonly use: "click" | "hover" | "context" | "fill" | "toggle" | "select" | "skip";
}

/** Options for {@link runSmoke}. */
export interface SmokeOptions {
  readonly page: Page;
  readonly frame: Frame;
  readonly network: NetworkWatch;
  readonly viewport: string;
  /** The recorder's entries already judged. */
  readonly from: number;
  readonly maxInteractions: number;
  readonly deadline: number;
}

/** What the smoke test found. */
export interface SmokeOutcome {
  readonly findings: Diagnostic[];
  readonly interactions: number;
  readonly stateChanges: number;
  readonly budget: boolean;
}

const MARK = "data-mostra-smoke";

/** Finds the page's controls and marks each with its index (runs in the frame). */
function findControls(mark: string): Control[] {
  const selector = [
    "button",
    "[role=button]",
    "a[href]",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "summary",
    "[role=tab]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=radio]",
    "[role=menuitem]",
    "[role=combobox]",
    "[role=option]",
    "[aria-haspopup]",
    '[data-slot$="-trigger"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(",");
  const controls: Control[] = [];
  const seen = new Set<Element>();
  for (const element of document.querySelectorAll(selector)) {
    if (seen.has(element) || controls.length >= 400) continue;
    seen.add(element);
    const html = element as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const role = element.getAttribute("role") ?? "";
    const slot = element.getAttribute("data-slot") ?? "";
    const name = (
      element.getAttribute("aria-label") ??
      ((html as HTMLInputElement).labels?.[0]?.textContent || undefined) ??
      element.getAttribute("placeholder") ??
      element.getAttribute("title") ??
      html.innerText ??
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    let use: Control["use"] = "click";
    if (tag === "a") {
      const anchor = element as HTMLAnchorElement;
      let url: URL | undefined;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        url = undefined;
      }
      const leaves =
        !url ||
        url.origin !== location.origin ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download");
      if (leaves) use = "skip";
    } else if (slot === "tooltip-trigger" || slot === "hover-card-trigger") use = "hover";
    else if (slot === "context-menu-trigger") use = "context";
    else if (tag === "select") use = "select";
    else if (tag === "textarea" || html.isContentEditable) use = "fill";
    else if (tag === "input") {
      if (type === "checkbox" || type === "radio") use = "toggle";
      else if (["submit", "button", "reset", "image"].includes(type)) use = "click";
      else if (type === "file") use = "skip";
      else use = "fill";
    }
    element.setAttribute(mark, String(controls.length));
    controls.push({ index: controls.length, tag, role, type, name, use });
  }
  return controls;
}

/** Whether a control is disabled or already active, read live (runs in the frame). */
function stateOf(element: Element): { readonly disabled: boolean; readonly active: boolean } {
  const html = element as HTMLButtonElement;
  const disabled =
    html.disabled === true ||
    element.getAttribute("aria-disabled") === "true" ||
    element.closest("fieldset[disabled]") !== null;
  const current = element.getAttribute("aria-current");
  const active =
    element.getAttribute("aria-selected") === "true" ||
    (current !== null && current !== "false") ||
    element.getAttribute("data-state") === "active" ||
    element.hasAttribute("data-active") ||
    element.hasAttribute("data-selected");
  return { disabled, active };
}

/** The attributes that show a control's state, as one string (runs in the frame). */
function attributesOf(element: Element): string {
  return [
    "aria-expanded",
    "aria-checked",
    "aria-selected",
    "aria-pressed",
    "data-state",
    "data-checked",
    "data-open",
    "data-popup-open",
    "data-pressed",
    "data-panel-open",
    "open",
  ]
    .map((name) => `${name}=${element.getAttribute(name)}`)
    .join("|");
}

/** A value that fits an input's type. */
function valueFor(type: string): string {
  const values: Record<string, string> = {
    email: "verify@example.com",
    number: "7",
    range: "7",
    date: "2026-01-15",
    time: "12:30",
    "datetime-local": "2026-01-15T12:30",
    month: "2026-01",
    week: "2026-W03",
    url: "https://example.com/",
    tel: "5550100",
    color: "#336699",
    password: "verify-pass",
  };
  return values[type] ?? "Verify";
}

const describe = (control: Control): string => {
  const kind =
    control.role || (control.tag === "input" ? `${control.type || "text"} input` : control.tag);
  return control.name ? `${kind} "${control.name}"` : kind;
};

/** Counts the frame document's mutations from now on (runs in the frame). */
function countMutations(): void {
  const scope = globalThis as unknown as { __mostraSmoke?: { count: number } };
  if (scope.__mostraSmoke) return;
  const state = { count: 0 };
  scope.__mostraSmoke = state;
  new MutationObserver((records) => {
    state.count += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

const mutations = (frame: Frame): Promise<number> =>
  frame
    .evaluate(
      () =>
        (globalThis as unknown as { __mostraSmoke?: { count: number } }).__mostraSmoke?.count ?? -1,
    )
    .catch(() => -1);

/** What one use of a control showed. */
interface Use {
  readonly used: boolean;
  readonly changed: boolean;
  readonly writes: number;
  readonly navigated: boolean;
  readonly newDocument: boolean;
  readonly mark: number;
}

/** Runs the smoke test on a rendered page. */
export async function runSmoke(options: SmokeOptions): Promise<SmokeOutcome> {
  const { page, frame, network, viewport } = options;
  const findings: Diagnostic[] = [];
  const startMark = network.mark();
  let seen = options.from;
  let interactions = 0;
  let budget = false;
  let stopped = false;
  await frame.evaluate(countMutations).catch(() => undefined);
  const controls = await frame.evaluate(findControls, MARK).catch(() => [] as Control[]);
  const usable = controls.filter((control) => control.use !== "skip");

  /** Uses a control once and judges what the page reported meanwhile. */
  const exercise = async (control: Control): Promise<Use> => {
    const none: Use = {
      used: false,
      changed: false,
      writes: 0,
      navigated: false,
      newDocument: false,
      mark: network.mark(),
    };
    if (frame.isDetached()) return none;
    const target: Locator = frame.locator(`[${MARK}="${control.index}"]`);
    if (!(await target.isVisible().catch(() => false))) return none;
    const state = await target.evaluate(stateOf).catch(() => ({ disabled: true, active: false }));
    if (state.disabled || state.active) return none;
    const mark = network.mark();
    const beforeMutations = await mutations(frame);
    const beforeAttributes = await target.evaluate(attributesOf).catch(() => "");
    const beforeUrl = frame.url();
    try {
      const timeout = Math.max(500, Math.min(2000, options.deadline - Date.now()));
      if (control.use === "hover") await target.hover({ timeout });
      else if (control.use === "context") await target.click({ button: "right", timeout });
      else if (control.use === "fill") {
        await target.fill(valueFor(control.type), { timeout });
        await target.press("Tab", { timeout });
      } else if (control.use === "toggle") {
        await target.click({ timeout });
        await target.press("Tab", { timeout }).catch(() => undefined);
      } else if (control.use === "select") {
        const option = await target.evaluate((element) => {
          const select = element as HTMLSelectElement;
          return [...select.options].find((entry) => !entry.selected && !entry.disabled)?.value;
        });
        if (option === undefined) return none;
        await target.selectOption(option, { timeout });
        await target.press("Tab", { timeout }).catch(() => undefined);
      } else await target.click({ timeout });
    } catch {
      return none; // Covered, moving or gone: not a control the smoke test could use.
    }
    interactions += 1;
    await settle(frame, network, options.deadline, 2000);
    const navigated = frame.url() !== beforeUrl;
    const afterMutations = await mutations(frame);
    const newDocument = afterMutations === -1;
    const afterAttributes = newDocument
      ? beforeAttributes
      : await target.evaluate(attributesOf).catch(() => beforeAttributes);
    const changed =
      navigated ||
      newDocument ||
      network.protocolSince(mark) > 0 ||
      afterAttributes !== beforeAttributes ||
      (afterMutations > beforeMutations && beforeMutations >= 0);
    const moment = { kind: "interaction" as const, control: describe(control) };
    if (newDocument) {
      // The frame loaded a new document: its recorder started again, and the controls found on
      // the old one are gone.
      findings.push(...judge(await recorded(frame), moment, network.skippedSince(mark), viewport));
      stopped = true;
    } else {
      const entries = await recorded(frame, seen);
      seen += entries.length;
      findings.push(...judge(entries, moment, network.skippedSince(mark), viewport));
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.move(0, 0).catch(() => undefined);
    }
    return { used: true, changed, writes: network.writesSince(mark), navigated, newDocument, mark };
  };

  const within = (): boolean =>
    !stopped && interactions < options.maxInteractions && Date.now() < options.deadline;
  /** Controls that changed nothing the first time: tried again once the others were used. */
  const again: Control[] = [];
  let used = 0;
  // Links go last: following one may load a new document, which ends the test.
  const links = usable.filter((control) => control.tag === "a");
  for (const control of usable.filter((entry) => entry.tag !== "a")) {
    if (!within()) break;
    used += 1;
    const outcome = await exercise(control);
    if (!outcome.used) continue;
    const location = { viewport, selector: `[${MARK}="${control.index}"]` };
    if (control.use === "fill" || control.use === "toggle" || control.use === "select") {
      if (outcome.writes === 0 && !outcome.navigated && !outcome.newDocument) {
        findings.push(
          createDiagnostic("MOSTRA_FIELD_UNBOUND", {
            message: `The smoke test changed ${describe(control)} and the page saved nothing: the input isn't bound to a field.`,
            location,
          }),
        );
      }
    } else if (!outcome.changed) again.push(control);
  }
  // A control can rightly do nothing the first time: the option already chosen, the filter
  // already applied. After the others changed the page, it gets a second try; only one that
  // changes nothing either time is reported (D72: observations, never errors).
  for (const control of again) {
    if (!within()) break;
    const outcome = await exercise(control);
    if (!outcome.used || outcome.changed) continue;
    findings.push(
      createDiagnostic("MOSTRA_SMOKE_NO_EFFECT", {
        message: `Observed: ${control.use === "hover" ? "hovering over" : "clicking"} ${describe(control)} twice changed nothing verify could see (no change to the page, no request, no saved field, no navigation).`,
        location: { viewport, selector: `[${MARK}="${control.index}"]` },
      }),
    );
  }
  // A link to the page already shown rightly changes nothing, so links aren't judged for it.
  for (const control of links) {
    if (!within()) break;
    used += 1;
    await exercise(control);
  }
  budget = !stopped && used < usable.length;
  if (budget) {
    findings.push(
      createDiagnostic("MOSTRA_SMOKE_BUDGET", {
        message: `The smoke test stopped after ${interactions} interactions, at its budget of ${options.maxInteractions} interactions or 60 s; ${usable.length - used} controls weren't used.`,
        location: { viewport },
      }),
    );
  }
  return { findings, interactions, stateChanges: network.writesSince(startMark), budget };
}
