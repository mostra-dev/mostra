/**
 * The shell (ARCHITECTURE §5, SH-01): the trusted page on its own origin that hosts the artifact's
 * frame. It exchanges the link's token for its session, strips the token from the address bar,
 * gets a single-use ticket for the frame and talks to the frame only over the validated bridge.
 * Trusted controls, the version banner and the review overlay join it in WP-07 and WP-20; the
 * frame never renders any of them, and it can't replace this page with one of its own (D98 item 7).
 */
import { type ReactElement, useEffect, useState } from "react";
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
import { type Credential, credentialFrom, parseTarget, type ShellTarget } from "./location.ts";
import { describeAccess, explain } from "./messages.ts";
import { mark, ViewerPage } from "./viewer.tsx";

/**
 * What the shell exposes on `<html>` for people's tools and Mostra's tests: `data-shell` is
 * `loading`, `choosing` (two links met), `framed` (the frame is loading), `initialized` (the
 * bridge handshake finished), `ready` (the page rendered) or `error`; `data-shell-error` carries
 * the diagnostic code. `data-shell-version`, `-latest`, `-view`, `-save` and `-page` follow the
 * view (WP-07).
 */
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly code: string }
  | {
      readonly kind: "choosing";
      readonly target: ShellTarget;
      readonly token: Credential;
      readonly conflict: Conflict;
    }
  | {
      readonly kind: "framed";
      readonly target: ShellTarget;
      readonly session: ShellSession;
      readonly ticket: FrameTicket;
    };

const errorState = (error: unknown): State => ({
  kind: "error",
  code: error instanceof ShellError ? error.code : "MOSTRA_HOST_INTERNAL_ERROR",
});

/** Gets the frame's ticket for a session. */
async function frame(target: ShellTarget, session: ShellSession): Promise<State> {
  try {
    if (session.artifact.title) document.title = session.artifact.title;
    const ticket = await frameTicket(target.apiBase, session.csrf, target.version);
    return { kind: "framed", target, session, ticket };
  } catch (error) {
    return errorState(error);
  }
}

/** Opens the page: exchanges the link's token, or reads the session the browser has. */
async function open(): Promise<State> {
  const target = parseTarget(location.pathname);
  if (!target) return { kind: "error", code: "NO_ARTIFACT" };
  const token = credentialFrom(location.hash);
  // The token (or launch ticket) leaves the address bar before anything else happens, so it isn't
  // kept in history, bookmarks or screenshots of this page (D97).
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
  return <ViewerPage target={state.target} session={state.session} ticket={state.ticket} />;
}
