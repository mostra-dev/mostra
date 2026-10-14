/**
 * The artifact's end of the shell bridge (INTERFACES §5, SH-04). Every version's generated entry
 * starts it: when the page runs inside Mostra's shell, it learns the shell's exact origin from its
 * own session (`GET /_mostra/session`, readable only by this origin), then introduces itself with
 * MCP Apps' `ui/initialize` and reports `mostra/ready` once the page has rendered. Messages from
 * any other window or origin are dropped. Outside a shell (a static export, the page opened on its
 * own) it does nothing.
 */
import {
  type Bridge,
  connectBridge,
  MCP_APPS_PROTOCOL_VERSION,
  mostraReady,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
} from "@mostra/protocol";

/** The shell connection of this page, once it is established. */
export interface ShellConnection {
  /** The shell's origin. */
  readonly shellOrigin: string;
  /** What the shell said about where the page is shown. */
  readonly host: UiInitializeResult;
  /** The bridge, for the client runtime's later messages. */
  readonly bridge: Bridge;
}

interface FrameSession {
  readonly shellOrigin?: unknown;
}

let connecting: Promise<ShellConnection | undefined> | undefined;

/**
 * Connects this page to the shell that frames it, once; later calls return the same connection.
 * Resolves `undefined` when the page isn't framed by a Mostra shell. The builder's generated entry
 * calls it; artifact code doesn't need to.
 */
export function connectShell(): Promise<ShellConnection | undefined> {
  connecting ??= (async () => {
    if (typeof window === "undefined" || window.parent === window) return undefined;
    let session: FrameSession;
    try {
      const response = await fetch("/_mostra/session", {
        credentials: "same-origin",
        cache: "no-store",
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
    });
    const host = await bridge.call(
      uiInitialize,
      {
        appInfo: { name: "mostra-artifact", version: "0" },
        appCapabilities: {},
        protocolVersion: MCP_APPS_PROTOCOL_VERSION,
      },
      { timeoutMs: 10_000 },
    );
    bridge.notify(uiInitialized, {});
    return { shellOrigin, host, bridge };
  })().catch(() => undefined);
  return connecting;
}

/**
 * Tells the shell the page has rendered (`mostra/ready`), after the next frame paints. The
 * generated entry calls it right after mounting the page.
 */
export function reportReady(): void {
  void connectShell().then((connection) => {
    if (!connection) return;
    requestAnimationFrame(() => connection.bridge.notify(mostraReady, {}));
  });
}
