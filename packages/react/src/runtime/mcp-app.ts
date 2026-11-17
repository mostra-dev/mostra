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
import { connectMcpHost } from "./mcp-host.ts";
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

/** Starts the page inline. */
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
    readonly exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<InlineRuntime> {
  const target: DeliveryTarget = "mcp-app";
  const host = await connectMcpHost();
  const local = (): Store => {
    const store = new Store({ mode: "local", journal: new MemoryJournal(), tab });
    store.start();
    return store;
  };
  if (host === undefined) return { store: local(), target, mode: target };
  applyHostContext(host.context());
  host.onContext(applyHostContext);
  watchHeight((height) => host.reportHeight(height));
  const handles = host.handles;
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
    const store = local();
    startInline({ store, host, handles });
    noteUnavailable("tools");
    return { store, target, mode: target };
  }
  const view = readViewContext(opened);
  const journal: Journal = (await IndexedDbJournal.open()) ?? new MemoryJournal();
  const store = new Store({
    mode: "live",
    transport: new McpAppTransport(host, {
      artifactId: handles.artifactId,
      session: opened.session,
      viewId: view.viewId,
      onBatched: () => noteUnavailable("streaming"),
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
    exclusive: page.exclusive,
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
