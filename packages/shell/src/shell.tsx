/**
 * The shell (ARCHITECTURE §5, SH-01): the trusted page on its own origin that hosts the artifact's
 * frame. It exchanges the link's token for its session, strips the token from the address bar,
 * gets a single-use ticket for the frame and talks to the frame only over the validated bridge.
 * Trusted controls, the version banner and the review overlay join it in WP-07 and WP-20; the
 * frame never renders any of them, and it can't replace this page with one of its own (D98 item 7).
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
  uiOpenLink,
} from "@mostra/protocol";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  type Access,
  type Conflict,
  exchange,
  type FrameTicket,
  frameTicket,
  readSession,
  ShellError,
  type ShellSession,
} from "./api.ts";
import { openLink } from "./links.ts";
import { parseTarget, type ShellTarget, tokenFrom } from "./location.ts";
import { describeAccess, explain } from "./messages.ts";

/**
 * What the shell exposes on `<html>` for people's tools and Mostra's tests: `data-shell` is
 * `loading`, `choosing` (two links met), `framed` (the frame is loading), `initialized` (the
 * bridge handshake finished), `ready` (the page rendered) or `error`; `data-shell-error` carries
 * the diagnostic code.
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

/**
 * The frame's sandbox (D98 item 7): everything a page can do, except navigating the viewer's tab,
 * which would let artifact code replace this trusted page with a look-alike. The frame keeps its
 * own origin, scripts, storage, forms, dialogs, downloads and popups, which open as ordinary
 * tabs. The shell page sends `Cross-Origin-Opener-Policy: same-origin`, so those popups have no
 * opener: Firefox would otherwise let one navigate `opener.top`, the shell (VERIFIED_FACTS,
 * WP-05). `ui/open-link` opens a tab through the shell.
 */
const FRAME_SANDBOX_TOKENS = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-downloads",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-orientation-lock",
  "allow-storage-access-by-user-activation",
  "allow-top-navigation-to-custom-protocols",
];

/**
 * The tokens this browser knows: an unknown one is ignored, but WebKit reports it as a console
 * error on every load, which `verify` and people would read as the artifact's.
 */
function frameSandbox(): string {
  const probe = document.createElement("iframe").sandbox;
  return FRAME_SANDBOX_TOKENS.filter((token) => probe.supports(token)).join(" ");
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly code: string }
  | {
      readonly kind: "choosing";
      readonly target: ShellTarget;
      readonly token: string;
      readonly conflict: Conflict;
    }
  | { readonly kind: "framed"; readonly session: ShellSession; readonly ticket: FrameTicket };

const errorState = (error: unknown): State => ({
  kind: "error",
  code: error instanceof ShellError ? error.code : "MOSTRA_HOST_INTERNAL_ERROR",
});

/** Gets the frame's ticket for a session. */
async function frame(target: ShellTarget, session: ShellSession): Promise<State> {
  try {
    if (session.artifact.title) document.title = session.artifact.title;
    const ticket = await frameTicket(target.apiBase, session.csrf, target.version);
    return { kind: "framed", session, ticket };
  } catch (error) {
    return errorState(error);
  }
}

/** Opens the page: exchanges the link's token, or reads the session the browser has. */
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
    return frame(target, session);
  } catch (error) {
    // Another link's session is live: the viewer chooses (D98 item 8).
    if (
      token !== undefined &&
      error instanceof ShellError &&
      error.code === "MOSTRA_HYGIENE_SESSION_CONFLICT"
    ) {
      return { kind: "choosing", target, token, conflict: error.body as Conflict };
    }
    return errorState(error);
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
  const frameElement = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let rejections = 0;
    let openedLinks = 0;
    mark("framed", { shellVersion: String(props.ticket.version.number) });
    const bridge: Bridge = connectBridge({
      side: "shell",
      receiver: window,
      peer: () => frameElement.current?.contentWindow,
      peerOrigin: props.ticket.artifactOrigin,
      onRequest: (message: AnyBridgeMessage, params) => {
        if (message === uiInitialize) {
          const result: UiInitializeResult = {
            protocolVersion: MCP_APPS_PROTOCOL_VERSION,
            hostInfo: { name: "mostra-shell", version: "0" },
            hostCapabilities: { openLinks: {} },
            hostContext: hostContext(),
          };
          return result;
        }
        if (message === uiOpenLink) {
          const result = openLink((params as { url: string }).url, (url, target, features) =>
            window.open(url, target, features),
          );
          if (!result.isError) {
            openedLinks += 1;
            mark(document.documentElement.dataset["shell"] ?? "framed", {
              openedLinks: String(openedLinks),
            });
          }
          return result;
        }
        return undefined;
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
      ref={frameElement}
      className="mostra-frame"
      src={props.ticket.src}
      title={props.session.artifact.title}
      allow={FRAME_ALLOW}
      sandbox={frameSandbox()}
    />
  );
}

/** The choice between the link the browser has and the link just opened (D98 item 8). */
function Choice(props: {
  readonly current: Access;
  readonly offered: Access;
  readonly onKeep: () => void;
  readonly onReplace: () => void;
}): ReactElement {
  return (
    <main className="mostra-shell mostra-notice">
      <h1>This artifact is already open here with another link</h1>
      <p>The link you have open: {describeAccess(props.current)}</p>
      <p>The link you just opened: {describeAccess(props.offered)}</p>
      <div className="mostra-actions">
        <button type="button" onClick={props.onKeep}>
          Keep the link I have
        </button>
        <button type="button" onClick={props.onReplace}>
          Use the new link
        </button>
      </div>
    </main>
  );
}

/** The shell page. */
export function Shell(): ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const show = (next: State): void => {
    if (next.kind === "error") mark("error", { shellError: next.code });
    if (next.kind === "choosing") mark("choosing");
    setState(next);
  };
  useEffect(() => {
    mark("loading");
    void open().then(show);
  }, []);
  if (state.kind === "loading") return <main className="mostra-shell" aria-busy="true" />;
  if (state.kind === "choosing") {
    const { target, token, conflict } = state;
    const choose = (session: Promise<ShellSession>): void => {
      setState({ kind: "loading" });
      mark("loading");
      void session.then(
        (next) => frame(target, next).then(show),
        (error: unknown) => show(errorState(error)),
      );
    };
    return (
      <Choice
        current={conflict.current}
        offered={conflict.offered}
        onKeep={() => choose(readSession(target.apiBase))}
        onReplace={() => choose(exchange(target.apiBase, token, true))}
      />
    );
  }
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
