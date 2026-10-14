/**
 * The shell (ARCHITECTURE §5, SH-01): the trusted page on its own origin that hosts the artifact's
 * frame. It exchanges the link's token for its session, strips the token from the address bar,
 * gets a single-use ticket for the frame and talks to the frame only over the validated bridge.
 * Trusted controls, the version banner and the review overlay join it in WP-07 and WP-20; the
 * frame never renders any of them.
 */
import {
  type AnyBridgeMessage,
  type Bridge,
  connectBridge,
  MCP_APPS_PROTOCOL_VERSION,
  mostraReady,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
} from "@mostra/protocol";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  exchange,
  type FrameTicket,
  frameTicket,
  readSession,
  ShellError,
  type ShellSession,
} from "./api.ts";
import { parseTarget, tokenFrom } from "./location.ts";
import { explain } from "./messages.ts";

/**
 * What the shell exposes on `<html>` for people's tools and Mostra's tests: `data-shell` is
 * `loading`, `framed` (the frame is loading), `initialized` (the bridge handshake finished),
 * `ready` (the page rendered) or `error`; `data-shell-error` carries the diagnostic code.
 */
function mark(state: string, attributes: Record<string, string> = {}): void {
  const root = document.documentElement;
  root.dataset["shell"] = state;
  for (const [key, value] of Object.entries(attributes)) root.dataset[key] = value;
}

/**
 * Features the frame may use, delegated from the shell (D05): Mostra limits no capability, and a
 * cross-origin frame gets none of these unless its parent allows them. The browser still asks the
 * person where a feature needs permission.
 */
const FRAME_ALLOW = [
  "accelerometer",
  "autoplay",
  "camera",
  "clipboard-read",
  "clipboard-write",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "screen-wake-lock",
  "xr-spatial-tracking",
].join("; ");

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "framed"; readonly session: ShellSession; readonly ticket: FrameTicket };

async function open(): Promise<State> {
  const target = parseTarget(location.pathname);
  if (!target) return { kind: "error", code: "NO_ARTIFACT" };
  const token = tokenFrom(location.hash);
  // The token leaves the address bar before anything else happens, so it isn't kept in history,
  // bookmarks or screenshots of this page (D97).
  if (token !== undefined) history.replaceState(null, "", location.pathname + location.search);
  try {
    const session =
      token !== undefined
        ? await exchange(target.apiBase, token)
        : await readSession(target.apiBase);
    if (session.artifact.title) document.title = session.artifact.title;
    const ticket = await frameTicket(target.apiBase, session.csrf, target.version);
    return { kind: "framed", session, ticket };
  } catch (error) {
    return {
      kind: "error",
      code: error instanceof ShellError ? error.code : "MOSTRA_HOST_INTERNAL_ERROR",
    };
  }
}

function hostContext(): UiInitializeResult["hostContext"] {
  return {
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    displayMode: "fullscreen",
    availableDisplayModes: ["fullscreen"],
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: "web",
  };
}

/** The frame and its bridge. */
function Frame(props: {
  readonly session: ShellSession;
  readonly ticket: FrameTicket;
}): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let rejections = 0;
    mark("framed", { shellVersion: String(props.ticket.version.number) });
    const bridge: Bridge = connectBridge({
      side: "shell",
      receiver: window,
      peer: () => frame.current?.contentWindow,
      peerOrigin: props.ticket.artifactOrigin,
      onRequest: (message: AnyBridgeMessage) => {
        if (message !== uiInitialize) return undefined;
        const result: UiInitializeResult = {
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
          hostInfo: { name: "mostra-shell", version: "0" },
          hostCapabilities: {},
          hostContext: hostContext(),
        };
        return result;
      },
      onNotification: (message) => {
        if (message === uiInitialized) mark("initialized");
        if (message === mostraReady) mark("ready");
      },
      onRejected: () => {
        rejections += 1;
        mark(document.documentElement.dataset["shell"] ?? "framed", {
          bridgeRejections: String(rejections),
        });
      },
    });
    return () => bridge.close();
  }, [props.ticket]);
  return (
    <iframe
      ref={frame}
      className="mostra-frame"
      src={props.ticket.src}
      title={props.session.artifact.title}
      allow={FRAME_ALLOW}
    />
  );
}

/** The shell page. */
export function Shell(): ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    mark("loading");
    void open().then((next) => {
      if (next.kind === "error") mark("error", { shellError: next.code });
      setState(next);
    });
  }, []);
  if (state.kind === "loading") return <main className="mostra-shell" aria-busy="true" />;
  if (state.kind === "error") {
    const { title, detail } = explain(state.code);
    return (
      <main className="mostra-shell mostra-notice">
        <h1>{title}</h1>
        <p>{detail}</p>
        <p className="mostra-code">{state.code}</p>
      </main>
    );
  }
  return (
    <main className="mostra-shell">
      <Frame session={state.session} ticket={state.ticket} />
    </main>
  );
}
