"use client";

/**
 * The artifact's end of the shell bridge (INTERFACES §5, SH-04). The client runtime starts it:
 * when the page runs inside Mostra's shell, it learns the shell's exact origin and its link's
 * scopes from its own session (`GET /_mostra/session`, readable only by this origin), introduces
 * itself with MCP Apps' `ui/initialize`, whose answer names the view this frame load is (D104),
 * and reports `mostra/ready` once the page has rendered. Messages from any other window or origin
 * are dropped. Outside a shell (a static export, the page opened on its own) it does nothing.
 */
import {
  type AnyBridgeMessage,
  type Bridge,
  connectBridge,
  MCP_APPS_PROTOCOL_VERSION,
  mostraReady,
  OPEN_LINK_SCHEMES,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
  uiOpenLink,
  type Viewer,
} from "@mostra/protocol";

/**
 * The version this page's build belongs to: its `<meta name="mostra-version">`, which Mostra's
 * builder writes (WP-07). `undefined` for a build that has none. @internal
 */
export function builtVersion(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const content = document.querySelector('meta[name="mostra-version"]')?.getAttribute("content");
  return content ? content : undefined;
}

/** `ui/initialize`'s `mostra` params: the page's version, when the build names it. */
function versionParams(): { mostra?: { versionId: string } } {
  const versionId = builtVersion();
  return versionId === undefined ? {} : { mostra: { versionId } };
}

/** The shell connection of this page, once it is established. */
export interface ShellConnection {
  /** The shell's origin. */
  readonly shellOrigin: string;
  /** What the shell said about where the page is shown, and the view (`host.mostra`). */
  readonly host: UiInitializeResult;
  /** The bridge, for the client runtime's messages. */
  readonly bridge: Bridge;
  /**
   * The frame session's facts: its CSRF token, the link's scopes (D97, D98) and, from gateways
   * since WP-07, the viewer it acts as.
   */
  readonly session: {
    readonly csrf: string;
    readonly scopes: readonly string[];
    readonly viewer?: Viewer;
  };
}

interface FrameSession {
  readonly shellOrigin?: unknown;
  readonly csrf?: unknown;
  readonly scopes?: unknown;
  readonly viewer?: unknown;
}

/** Hears what the shell sends: requests answered by the first handler that returns a value. */
export interface ShellListener {
  readonly request?: (message: AnyBridgeMessage, params: unknown) => unknown;
  readonly notification?: (message: AnyBridgeMessage, params: unknown) => void;
}

const listeners = new Set<ShellListener>();
let connecting: Promise<ShellConnection | undefined> | undefined;

/**
 * Listens to the shell's requests and notifications on this page's bridge; returns the function
 * that stops. The client runtime answers `mostra/flush` and hears `mostra/version.available`.
 */
export function listenShell(listener: ShellListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Connects this page to the shell that frames it, once; later calls return the same connection.
 * Resolves `undefined` when the page isn't framed by a Mostra shell. The client runtime calls it;
 * artifact code doesn't need to.
 */
export function connectShell(): Promise<ShellConnection | undefined> {
  connecting ??= (async () => {
    if (typeof window === "undefined" || window.parent === window) return undefined;
    let session: FrameSession;
    try {
      const response = await fetch("/_mostra/session", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      session = (await response.json()) as FrameSession;
    } catch {
      return undefined;
    }
    if (typeof session.shellOrigin !== "string") return undefined;
    const shellOrigin = session.shellOrigin;
    const bridge = connectBridge({
      side: "artifact",
      receiver: window,
      peer: () => window.parent,
      peerOrigin: shellOrigin,
      onRequest: async (message, params) => {
        for (const listener of listeners) {
          const answer = await listener.request?.(message, params);
          if (answer !== undefined) return answer;
        }
        throw new Error(`The page doesn't answer ${message.method}.`);
      },
      onNotification: (message, params) => {
        for (const listener of listeners) listener.notification?.(message, params);
      },
    });
    let host: UiInitializeResult;
    try {
      host = await bridge.call(
        uiInitialize,
        {
          appInfo: { name: "mostra-artifact", version: "0" },
          appCapabilities: {},
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
          ...versionParams(),
        },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
    } catch (error) {
      bridge.close();
      throw error;
    }
    bridge.notify(uiInitialized, {});
    return {
      shellOrigin,
      host,
      bridge,
      session: {
        csrf: typeof session.csrf === "string" ? session.csrf : "",
        scopes: Array.isArray(session.scopes)
          ? session.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
        ...(isViewer(session.viewer) ? { viewer: session.viewer } : {}),
      },
    };
  })().then(
    (connection) => {
      // A framed page that didn't connect may try again (the daemon restarting during the
      // frame's load, a slow handshake): only a connection is kept (Claude review finding 4).
      if (connection === undefined) connecting = undefined;
      return connection;
    },
    () => {
      connecting = undefined;
      return undefined;
    },
  );
  return connecting;
}

/** Whether the session's `viewer` looks like a viewer (a light check: the gateway sends it). */
function isViewer(value: unknown): value is Viewer {
  const viewer = value as { id?: unknown; kind?: unknown } | null | undefined;
  return typeof viewer?.id === "string" && typeof viewer.kind === "string";
}

/** How long one attempt at the shell's handshake may take. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Tells the shell the page has rendered (`mostra/ready`), after the next frame paints. The
 * client runtime calls it right after mounting the page.
 */
export function reportReady(): void {
  void connectShell().then((connection) => {
    if (!connection) return;
    requestAnimationFrame(() => connection.bridge.notify(mostraReady, {}));
  });
}

/**
 * Opens `url` for the viewer in a new tab. Inside Mostra's shell the frame can't navigate the
 * viewer's tab (D98 item 7), so the shell opens it (`ui/open-link`, MCP Apps); on a page of its
 * own, the browser does. Only `http:`, `https:`, `mailto:` and `tel:` URLs open. Resolves `true`
 * when the URL was handed to the browser.
 */
export async function openLink(url: string): Promise<boolean> {
  const connection = await connectShell();
  if (connection) {
    try {
      const result = await connection.bridge.call(uiOpenLink, { url });
      return result.isError !== true;
    } catch {
      return false;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return false;
  }
  if (!OPEN_LINK_SCHEMES.includes(parsed.protocol)) return false;
  window.open(parsed.href, "_blank", "noopener,noreferrer");
  return true;
}
