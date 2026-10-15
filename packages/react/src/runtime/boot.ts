/**
 * Starts the client runtime for the page (D111): reads the delivery target, connects to the shell
 * and the gateway in live mode, opens the journal, and wires the page's lifecycle (blur,
 * `visibilitychange`, `pagehide`) and the bridge (`mostra/fields`, `mostra/flush`,
 * `mostra/field.focus`, `mostra/version.available`) to the store.
 */
import {
  type DeliveryTarget,
  type FieldsParams,
  type FlushResult,
  mostraFieldFocus,
  mostraFields,
  mostraFlush,
  mostraVersionAvailable,
  type VersionAvailableParams,
  type ViewContext,
} from "@mostra/protocol";
import { builtVersion, connectShell, listenShell, type ShellConnection } from "../shell-bridge.ts";
import { IndexedDbJournal, type Journal, MemoryJournal } from "./journal.ts";
import { Store } from "./store.ts";
import { HttpTransport } from "./transport.ts";

/** The page's runtime: its store, where it runs, and its shell connection. */
export interface Runtime {
  readonly store: Store;
  /** The delivery target the page was built or exported for (D111): it chooses the history. */
  readonly target: DeliveryTarget;
  /**
   * Where the page runs, as `useArtifact` reports it: the target, except that a live page opened
   * outside Mostra's shell has no server features and reports `static`.
   */
  readonly mode: DeliveryTarget;
  /** The shell connection, inside Mostra's shell. */
  readonly shell: ShellConnection | undefined;
}

/** The delivery target the page was built or exported for: its `mostra-target` meta tag (D111). */
export function deliveryTarget(): DeliveryTarget {
  if (typeof document === "undefined") return "live";
  const content = document
    .querySelector('meta[name="mostra-target"]')
    ?.getAttribute("content")
    ?.trim();
  return content === "static" || content === "mcp-app" || content === "verify" ? content : "live";
}

/** A random ID for this tab. */
function tabId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface Locks {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
  request(
    name: string,
    options: { mode?: "exclusive" | "shared" },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

function locks(): Locks | undefined {
  const navigatorLocks = (globalThis.navigator as { locks?: Locks } | undefined)?.locks;
  return navigatorLocks;
}

const TAB_LOCK = "mostra-tab:";

/**
 * Holds this tab's lock for as long as the page lives, so other pages know its journal entries
 * belong to an open tab (Web Locks). Returns which of some tabs hold no lock: they are gone.
 */
function tabPresence(tab: string): (tabs: readonly string[]) => Promise<ReadonlySet<string>> {
  const api = locks();
  if (!api) return async (tabs) => new Set(tabs);
  void api.request(`${TAB_LOCK}${tab}`, () => new Promise<never>(() => undefined));
  return async (tabs) => {
    const held = new Set(
      ((await api.query()).held ?? [])
        .map((lock) => lock.name)
        .filter((name): name is string => name?.startsWith(TAB_LOCK) === true)
        .map((name) => name.slice(TAB_LOCK.length)),
    );
    return new Set(tabs.filter((other) => !held.has(other)));
  };
}

/** Runs `fn` while no other page of the artifact adopts journal entries. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const api = locks();
  if (!api) return fn();
  return api.request("mostra-journal", fn) as Promise<T>;
}

/** How long the page waits for the shell's handshake before it runs on its own. */
const SHELL_WAIT_MS = 10_000;

/**
 * Starts the runtime: live behind the gateway inside Mostra's shell, local otherwise (a static
 * export, an MCP App until its transport arrives, a page opened on its own).
 */
export async function startRuntime(): Promise<Runtime> {
  const target = deliveryTarget();
  const tab = tabId();
  const shell =
    target === "live" || target === "verify"
      ? await Promise.race([
          connectShell(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SHELL_WAIT_MS)),
        ])
      : undefined;
  const view: ViewContext | undefined = shell?.host.mostra;
  const built = builtVersion();
  if (shell && view && built !== undefined && built !== view.version.id) {
    // This page is another version than the view the shell opened: another tab moved the frame
    // session on (D98 item 5). Nothing it shows may be saved as this view, nor kept: the shell,
    // told the page's version in `ui/initialize`, loads the frame again at its own version.
    const scratch = new Map<string, string>();
    const store = new Store({
      mode: "local",
      journal: new MemoryJournal(),
      tab,
      local: {
        getItem: (key) => scratch.get(key) ?? null,
        setItem: (key, value) => void scratch.set(key, value),
        removeItem: (key) => void scratch.delete(key),
      },
    });
    store.start();
    return { store, target, mode: view.target, shell };
  }
  if (!shell || !view) {
    const store = new Store({ mode: "local", journal: new MemoryJournal(), tab });
    store.start();
    return { store, target, mode: target === "live" ? "static" : target, shell: undefined };
  }
  const journal: Journal = (await IndexedDbJournal.open()) ?? new MemoryJournal();
  const store = new Store({
    mode: "live",
    transport: new HttpTransport(view.viewId, {
      ...(shell.session.csrf !== "" ? { csrf: shell.session.csrf } : {}),
    }),
    journal,
    view,
    scopes: shell.session.scopes,
    tab,
    goneTabs: tabPresence(tab),
    exclusive,
    channel: (name) =>
      typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(name),
  });
  store.start();
  wireLifecycle(store);
  wireShell(store, shell);
  return { store, target, mode: view.target, shell };
}

/** Saves on blur, and when the page is hidden or closed (IN-02). */
function wireLifecycle(store: Store): void {
  if (typeof document === "undefined") return;
  document.addEventListener("focusout", () => void store.flush(), true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void store.flush({ keepalive: true });
  });
  window.addEventListener("pagehide", () => void store.flush({ keepalive: true }));
}

/** Focuses the element a field is bound to, when the viewer picks it in the shell. */
function focusField(id: string): void {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  const element = document.querySelector<HTMLElement>(
    `[data-mostra-field="${escaped}"], [name="${escaped}"], #${escaped}`,
  );
  element?.scrollIntoView({ block: "center" });
  element?.focus();
}

/** Reports fields and save state to the shell, and answers its requests. */
function wireShell(store: Store, shell: ShellConnection): void {
  let last = "";
  let scheduled = false;
  const report = (): void => {
    scheduled = false;
    const params: FieldsParams = {
      fields: store.registrations().map((registration) => ({
        id: registration.id,
        scope: registration.scope,
        ...(registration.label !== undefined ? { label: registration.label } : {}),
        ...(registration.required !== undefined ? { required: registration.required } : {}),
        ...(registration.sensitive !== undefined ? { sensitive: registration.sensitive } : {}),
        ...(registration.error !== undefined ? { error: registration.error } : {}),
        ...(store.conflict(`${registration.scope}:${registration.id}`) ? { conflict: true } : {}),
      })),
      save: store.pageSave(),
      unsaved: store.unsaved(),
    };
    const text = JSON.stringify(params);
    if (text === last) return;
    last = text;
    shell.bridge.notify(mostraFields, params);
  };
  store.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(report);
  });
  report();
  listenShell({
    request: async (message, params) => {
      if (message !== mostraFlush) return undefined;
      const reason = (params as { reason: "submit" | "switch" }).reason;
      if (reason === "submit") {
        const prepared = await store.prepareSubmit();
        const result: FlushResult = {
          revision: String(prepared.revision),
          unsaved: prepared.unsaved,
          blockers: prepared.blockers,
        };
        return result;
      }
      const flushed = await store.flush();
      const result: FlushResult = {
        revision: String(flushed.revision),
        unsaved: flushed.unsaved,
        blockers: store.blockers(),
      };
      return result;
    },
    notification: (message, params) => {
      if (message === mostraFieldFocus) focusField((params as { id: string }).id);
      if (message === mostraVersionAvailable) {
        // The page may show its own notice; the shell's trusted banner always appears (§5).
        window.dispatchEvent(
          new CustomEvent<VersionAvailableParams>("mostra:version-available", {
            detail: params as VersionAvailableParams,
          }),
        );
      }
    },
  });
}
