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
import { blockersForShell, clip, firstThatMatter } from "./bridge-limits.ts";
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

/** How long a tab waits for other tabs to say they are open, where Web Locks are missing. */
const PRESENCE_WAIT_MS = 300;

/**
 * Where Web Locks are missing (they need a secure context, and an artifact served over plain
 * HTTP on a LAN address isn't one), open tabs answer a roll call on a BroadcastChannel, which
 * works everywhere: a tab that doesn't answer within {@link PRESENCE_WAIT_MS} is gone.
 */
function rollCall(
  tab: string,
): ((tabs: readonly string[]) => Promise<ReadonlySet<string>>) | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  const channel = new BroadcastChannel("mostra-tabs");
  channel.onmessage = (event: MessageEvent<{ who?: true; here?: string }>) => {
    if (event.data?.who) channel.postMessage({ here: tab });
  };
  return (tabs) =>
    new Promise((resolve) => {
      const open = new Set<string>();
      const listen = new BroadcastChannel("mostra-tabs");
      listen.onmessage = (event: MessageEvent<{ here?: string }>) => {
        if (typeof event.data?.here === "string") open.add(event.data.here);
      };
      listen.postMessage({ who: true });
      setTimeout(() => {
        listen.close();
        resolve(new Set(tabs.filter((other) => !open.has(other))));
      }, PRESENCE_WAIT_MS);
    });
}

/**
 * Holds this tab's lock for as long as the page lives, so other pages know its journal entries
 * belong to an open tab (Web Locks). Returns which of some tabs hold no lock: they are gone.
 */
function tabPresence(tab: string): (tabs: readonly string[]) => Promise<ReadonlySet<string>> {
  const api = locks();
  if (!api) return rollCall(tab) ?? (async (tabs) => new Set(tabs));
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

/** The longest pause between two attempts at the shell's handshake. */
const SHELL_RETRY_MAX_MS = 8_000;

/**
 * The shell's connection for a framed page. A page inside a frame is inside Mostra's shell (its
 * origin is framed by the shell only): if the handshake fails (the daemon restarting during the
 * frame's load, a slow shell), it tries again rather than run on its own, where its answers
 * would stay in this browser while the shell said "Saved" (FAILURE_MODEL §1 rule 4; Claude review
 * finding 4). A page opened on its own has no shell and runs locally.
 */
async function framedShell(): Promise<ShellConnection | undefined> {
  if (typeof window === "undefined" || window.parent === window) return undefined;
  for (let attempt = 0; ; attempt += 1) {
    const shell = await connectShell();
    if (shell) return shell;
    if (attempt === 1)
      console.warn("Mostra: waiting for the shell; the page connects when it can.");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(500 * 2 ** attempt, SHELL_RETRY_MAX_MS)),
    );
  }
}

/**
 * Starts the runtime: live behind the gateway inside Mostra's shell, local otherwise (a static
 * export, an MCP App until its transport arrives, a page opened on its own).
 */
export async function startRuntime(): Promise<Runtime> {
  const target = deliveryTarget();
  const tab = tabId();
  const shell = target === "live" || target === "verify" ? await framedShell() : undefined;
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
    ...(shell.session.viewer ? { viewer: shell.session.viewer } : {}),
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
    const fields = store.registrations().map((registration) => ({
      id: registration.id,
      scope: registration.scope,
      ...(registration.label !== undefined ? { label: clip(registration.label) } : {}),
      ...(registration.required !== undefined ? { required: registration.required } : {}),
      ...(registration.sensitive !== undefined ? { sensitive: registration.sensitive } : {}),
      ...(registration.error !== undefined ? { error: clip(registration.error) } : {}),
      ...(store.conflict(`${registration.scope}:${registration.id}`) ? { conflict: true } : {}),
    }));
    const params: FieldsParams = {
      fields: firstThatMatter(fields, (field) =>
        Boolean(field.required || field.error !== undefined || field.conflict),
      ),
      save: store.pageSave(),
      unsaved: store.unsaved(),
    };
    const text = JSON.stringify(params);
    if (text === last) return;
    last = text;
    try {
      shell.bridge.notify(mostraFields, params);
    } catch (error) {
      // Never silently: the shell's rail would keep its last state (Claude review finding 11).
      console.error("Mostra: the page's fields couldn't be reported to the shell.", error);
    }
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
          blockers: blockersForShell(prepared.blockers),
        };
        return result;
      }
      const flushed = await store.flush();
      const result: FlushResult = {
        revision: String(flushed.revision),
        unsaved: flushed.unsaved,
        blockers: blockersForShell(store.blockers()),
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
