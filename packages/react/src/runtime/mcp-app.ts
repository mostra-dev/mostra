"use client";

/**
 * A page's start inline in an MCP Apps host (D175 items 6, 7), loaded by boot only on an
 * `mcp-app` page: the host's look, the view its link opens through the app-only tools
 * (`app_open`), the browser protocol over them, and the inline bar. Without its handles or the
 * host's tool calls, the page runs on its own, says so, and offers the full page.
 */
import {
  APP_TOOLS,
  type DeliveryTarget,
  readViewContext,
  type ViewContextWire,
  type Viewer,
} from "@mostra/protocol";
import { startInline } from "./inline.ts";
import { noteUnavailable } from "./inline-sink.ts";
import { IndexedDbJournal, type Journal, MemoryJournal } from "./journal.ts";
import { builtVersion, connectMcpHost } from "./mcp-host.ts";
import { applyHostContext } from "./mcp-theme.ts";
import { McpAppTransport } from "./mcp-transport.ts";
import { Store } from "./store.ts";

/** How often the page tells its host its height, at most (one frame). */
function watchHeight(report: (height: number) => void): void {
  if (typeof ResizeObserver === "undefined") return;
  let last = -1;
  let scheduled = false;
  const measure = (): void => {
    scheduled = false;
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    report(height);
  };
  new ResizeObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  }).observe(document.documentElement);
  measure();
}

/**
 * Where a page inline keeps what it holds in this browser. An MCP Apps host gives every page one
 * sandbox origin, where Mostra's gateway gives each artifact its own (D38), so each place is named
 * for the page's artifact (its version, when the host named none): its journal of unsent answers,
 * the lock the journal's adoption takes, and the keys answers kept only here are stored under. No
 * page ever adopts, sends or shows another artifact's answers (D175 item 6).
 */
export function inlinePlaces(owner: string): {
  readonly journal: string;
  readonly lock: string;
  readonly local: string;
} {
  return {
    journal: `mostra:${owner}`,
    lock: `mostra-journal:${owner}`,
    local: `mostra.app.${owner}.`,
  };
}

/** The browser's `localStorage` under one prefix, or none where it can't be used. */
function storageUnder(
  prefix: string,
): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  let storage: Storage | undefined;
  try {
    storage = typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    storage = undefined;
  }
  if (storage === undefined) return undefined;
  const kept = storage;
  return {
    getItem: (key) => kept.getItem(`${prefix}${key}`),
    setItem: (key, value) => kept.setItem(`${prefix}${key}`, value),
    removeItem: (key) => kept.removeItem(`${prefix}${key}`),
  };
}

/** The runtime of a page inline: its store and where it runs (boot adds that no shell frames it). */
export interface InlineRuntime {
  readonly store: Store;
  readonly target: DeliveryTarget;
  readonly mode: DeliveryTarget;
}

export async function startMcpApp(
  tab: string,
  page: {
    readonly wireLifecycle: (store: Store) => void;
    readonly tabPresence: (
      tab: string,
    ) => (tabs: readonly string[]) => Promise<ReadonlySet<string>>;
    readonly exclusive: <T>(fn: () => Promise<T>, name?: string) => Promise<T>;
  },
): Promise<InlineRuntime> {
  const target: DeliveryTarget = "mcp-app";
  const host = await connectMcpHost();
  const local = (owner: string | undefined): Store => {
    const storage = owner === undefined ? undefined : storageUnder(inlinePlaces(owner).local);
    const store = new Store({
      mode: "local",
      journal: new MemoryJournal(),
      tab,
      // Never the origin's own keys, which every page inline shares; with no name at all, this
      // page's memory only.
      local: storage ?? memoryStorage(),
    });
    store.start();
    return store;
  };
  if (host === undefined) return { store: local(builtVersion()), target, mode: target };
  applyHostContext(host.context());
  host.onContext(applyHostContext);
  watchHeight((height) => host.reportHeight(height));
  const handles = host.handles;
  if (handles?.personal === true) {
    // One person's own link: opened here it would act as them (R02 finding 2). The page shows,
    // keeps nothing anywhere but here, and offers no way into their view.
    const store = local(handles.artifactId);
    startInline({ store, host, handles: undefined });
    noteUnavailable("personal");
    return { store, target, mode: target };
  }
  let opened: (ViewContextWire & AppOpenResultFacts) | undefined;
  if (handles !== undefined && host.tools) {
    try {
      const result = await host.callTool(APP_TOOLS.open, {
        artifactId: handles.artifactId,
        url: handles.url,
        // The version this page is: a newer one published since has its own page (D115).
        version: handles.version,
      });
      const answer = result.structuredContent as (ViewContextWire & AppOpenResultFacts) | undefined;
      if (result.isError !== true && typeof answer?.session === "string") opened = answer;
    } catch {
      opened = undefined;
    }
  }
  if (opened === undefined || handles === undefined) {
    const store = local(handles?.artifactId ?? builtVersion());
    startInline({ store, host, handles });
    noteUnavailable("tools");
    return { store, target, mode: target };
  }
  const view = readViewContext(opened);
  const places = inlinePlaces(handles.artifactId);
  const journal: Journal = (await IndexedDbJournal.open(places.journal)) ?? new MemoryJournal();
  const store = new Store({
    mode: "live",
    transport: new McpAppTransport(host, {
      artifactId: handles.artifactId,
      session: opened.session,
      viewId: view.viewId,
      onBatched: () => noteUnavailable("streaming"),
      onTooLong: () => noteUnavailable("calls"),
      onNewer: (number) => {
        if (number > view.version.number) noteUnavailable("versions");
      },
    }),
    journal,
    view,
    scopes: opened.scopes,
    ...(opened.viewer ? { viewer: opened.viewer } : {}),
    tab,
    goneTabs: page.tabPresence(tab),
    exclusive: (fn) => page.exclusive(fn, places.lock),
    channel: (name) =>
      typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(name),
  });
  store.start();
  page.wireLifecycle(store);
  // The host waits for this before it removes the page: what the person typed is saved first.
  host.onTeardown(async () => {
    await store.flush();
  });
  startInline({ store, host, handles });
  return { store, target, mode: target };
}

/** What `app/open` answers beside the view's context: its session, scopes and viewer. */
interface AppOpenResultFacts {
  readonly session: string;
  readonly scopes: readonly string[];
  readonly viewer?: Viewer;
}

/** Storage that lasts as long as the page: for a page that knows neither its artifact nor version. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
}
