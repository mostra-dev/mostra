/**
 * The page around one view (WP-07): the rail with the artifact's label, save state and the trusted
 * zone (Submit, Choose), the version banner with "Always follow", the frame, the submission
 * receipt and the "Not carried over" panel. Everything here is shell DOM on the shell's origin:
 * the frame can ask for a label or a Choose over the bridge, never render, reach or click one
 * (D06, SH-01, SH-02).
 */
import {
  type AnyBridgeMessage,
  type Bridge,
  type ControlRequest,
  connectBridge,
  type FieldsParams,
  type FlushResult,
  type FrameTicket,
  MCP_APPS_PROTOCOL_VERSION,
  mostraControlsRequest,
  mostraFieldFocus,
  mostraFields,
  mostraFlush,
  mostraPage,
  mostraReady,
  mostraVersionAvailable,
  type OrphanedField,
  type SubmitBlocker,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
  uiOpenLink,
  type ViewContext,
} from "@mostra/protocol";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import {
  carryOver,
  choose,
  frameTicket,
  ShellError,
  type ShellSession,
  setFollow,
  submit,
} from "./api.ts";
import { openLink } from "./links.ts";
import type { ShellTarget } from "./location.ts";
import {
  blockers as blockersOf,
  choiceOf,
  deliveryView,
  initialState,
  showsChoose,
  showsSubmit,
  type ViewState,
  withControlRequest,
  withEvents,
  withSnapshot,
  withSubmission,
} from "./model.ts";
import { openStream, readSnapshot } from "./stream.ts";
import {
  BANNER_WORDS,
  BLOCKER_WORDS,
  CONTROL_WORDS,
  ORPHAN_WORDS,
  RECEIPT_WORDS,
  SAVE_WORDS,
  submitProblem,
} from "./words.ts";

/** Marks `<html>` for people's tools and Mostra's tests (see `shell.tsx`). */
export function mark(state: string, attributes: Record<string, string> = {}): void {
  const root = document.documentElement;
  if (state !== "") root.dataset["shell"] = state;
  for (const [key, value] of Object.entries(attributes)) root.dataset[key] = value;
}

/** How long the shell waits for the frame to save before a submit or a switch. */
const FLUSH_TIMEOUT_MS = 10_000;

/** How long the shell waits for its own stream to see the frame's last save. */
const CATCH_UP_MS = 5_000;

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
 * The frame's sandbox (D98 item 7): everything a page can do except navigating the viewer's tab,
 * which would let artifact code replace this trusted page with a look-alike. The shell sends
 * `Cross-Origin-Opener-Policy: same-origin`, so the frame's popups have no opener (VERIFIED_FACTS,
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

/** The tokens this browser knows (WebKit logs every unknown one as an error). */
function frameSandbox(): string {
  const probe = document.createElement("iframe").sandbox;
  return FRAME_SANDBOX_TOKENS.filter((token) => probe.supports(token)).join(" ");
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

/** The view context the frame gets in `ui/initialize`'s result (D104, D108). */
function viewContext(ticket: FrameTicket): ViewContext {
  return {
    artifactId: ticket.artifactId,
    viewId: ticket.viewId,
    version: ticket.version,
    latest: ticket.latest,
    policy: ticket.policy,
    submitChannels: ticket.submitChannels,
    controls: ticket.controls,
    target: ticket.target,
  };
}

/** What the frame tells the shell. */
interface FrameHandlers {
  onFields(params: FieldsParams): void;
  onControl(request: ControlRequest): boolean;
  onPage(path: string): void;
}

/** The frame and its bridge. */
function Frame(props: {
  readonly title: string;
  readonly ticket: FrameTicket;
  readonly handlers: FrameHandlers;
  readonly onBridge: (bridge: Bridge | undefined) => void;
}): ReactElement {
  const frameElement = useRef<HTMLIFrameElement>(null);
  const handlers = useRef(props.handlers);
  handlers.current = props.handlers;
  const { ticket, onBridge } = props;
  useEffect(() => {
    let rejections = 0;
    let openedLinks = 0;
    mark("framed", { shellVersion: String(ticket.version.number) });
    const bridge: Bridge = connectBridge({
      side: "shell",
      receiver: window,
      peer: () => frameElement.current?.contentWindow,
      peerOrigin: ticket.artifactOrigin,
      onRequest: (message: AnyBridgeMessage, params) => {
        if (message === uiInitialize) {
          const result: UiInitializeResult = {
            protocolVersion: MCP_APPS_PROTOCOL_VERSION,
            hostInfo: { name: "mostra-shell", version: "0" },
            hostCapabilities: { openLinks: {} },
            hostContext: hostContext(),
            mostra: viewContext(ticket),
          };
          return result;
        }
        if (message === uiOpenLink) {
          const result = openLink((params as { url: string }).url, (url, target, features) =>
            window.open(url, target, features),
          );
          if (!result.isError) {
            openedLinks += 1;
            mark("", { openedLinks: String(openedLinks) });
          }
          return result;
        }
        if (message === mostraControlsRequest) {
          return { shown: handlers.current.onControl(params as ControlRequest) };
        }
        return undefined;
      },
      onNotification: (message, params) => {
        if (message === uiInitialized) mark("initialized");
        if (message === mostraReady) mark("ready");
        if (message === mostraFields) handlers.current.onFields(params as FieldsParams);
        if (message === mostraPage) handlers.current.onPage((params as { path: string }).path);
      },
      onRejected: () => {
        rejections += 1;
        mark("", { bridgeRejections: String(rejections) });
      },
    });
    onBridge(bridge);
    return () => {
      onBridge(undefined);
      bridge.close();
    };
  }, [ticket, onBridge]);
  return (
    <iframe
      ref={frameElement}
      className="mostra-frame"
      src={ticket.src}
      title={props.title}
      allow={FRAME_ALLOW}
      sandbox={frameSandbox()}
    />
  );
}

/** Copies a value as text. */
function copyText(value: unknown): Promise<void> {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return navigator.clipboard.writeText(text);
}

/** The "Not carried over" panel (D42): read-only, copyable, never dropped. */
function Orphans(props: { readonly orphans: readonly OrphanedField[] }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | undefined>();
  if (props.orphans.length === 0) return null;
  return (
    <aside className="mostra-orphans" data-mostra-orphans={String(props.orphans.length)}>
      <button type="button" className="mostra-link" onClick={() => setOpen(!open)}>
        {open ? ORPHAN_WORDS.hide : ORPHAN_WORDS.show(props.orphans.length)}
      </button>
      {open && (
        <section aria-label={ORPHAN_WORDS.title}>
          <h2>{ORPHAN_WORDS.title}</h2>
          <p>{ORPHAN_WORDS.intro}</p>
          <ul>
            {props.orphans.map((orphan) => (
              <li key={orphan.id} data-mostra-orphan={orphan.id}>
                <div className="mostra-orphan-label">{orphan.label ?? orphan.id}</div>
                <pre className="mostra-orphan-value">
                  {typeof orphan.value === "string"
                    ? orphan.value
                    : JSON.stringify(orphan.value, null, 2)}
                </pre>
                <div className="mostra-orphan-meta">
                  <span>{ORPHAN_WORDS.from(orphan.fromVersion)}</span>
                  <button
                    type="button"
                    className="mostra-link"
                    onClick={() => void copyText(orphan.value).then(() => setCopied(orphan.id))}
                  >
                    {copied === orphan.id ? ORPHAN_WORDS.copied : ORPHAN_WORDS.copy}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** The submission receipt (IN-13, D47): Mostra's record and each host's delivery, kept apart. */
function Receipt(props: { readonly state: ViewState }): ReactElement | null {
  const submission = props.state.submission;
  if (!submission) return null;
  const view = deliveryView(submission);
  const title =
    view.kind === "delivered"
      ? RECEIPT_WORDS.delivered
      : view.kind === "pending"
        ? RECEIPT_WORDS.pending
        : view.kind === "undeliverable"
          ? RECEIPT_WORDS.undeliverable
          : RECEIPT_WORDS.submitted;
  const time = new Date(submission.at).toLocaleTimeString(undefined, { timeStyle: "medium" });
  return (
    <aside className="mostra-receipt" data-mostra-receipt={view.kind} aria-live="polite">
      <h2>{title}</h2>
      <ul>
        <li className="mostra-ok">
          <span>{RECEIPT_WORDS.saved}</span>
          <time dateTime={submission.at}>{time}</time>
        </li>
        {(submission.deliveries ?? [])
          .filter((delivery) => delivery.owner !== "")
          .map((delivery) => (
            <li
              key={delivery.deliveryId}
              className={
                delivery.state === "delivered"
                  ? "mostra-ok"
                  : delivery.state === "pending"
                    ? "mostra-wait"
                    : "mostra-bad"
              }
              data-mostra-delivery={delivery.state}
            >
              {delivery.state === "delivered"
                ? RECEIPT_WORDS.deliveredTo(delivery.owner)
                : delivery.state === "pending"
                  ? RECEIPT_WORDS.pendingTo(delivery.owner)
                  : RECEIPT_WORDS.undeliverableTo(delivery.owner, delivery.reason)}
            </li>
          ))}
      </ul>
      <p className="mostra-footnote">
        {RECEIPT_WORDS.footnote(submission.version)}
        {submission.staleView ? ` ${RECEIPT_WORDS.stale(props.state.latest.number)}` : ""}
      </p>
    </aside>
  );
}

/** The page around one view. */
export function ViewerPage(props: {
  readonly target: ShellTarget;
  readonly session: ShellSession;
  readonly ticket: FrameTicket;
}): ReactElement {
  const { target, session } = props;
  const [ticket, setTicket] = useState(props.ticket);
  const [state, setState] = useState<ViewState>(() => initialState(props.ticket));
  const [follow, setFollowing] = useState(props.ticket.follow);
  const [later, setLater] = useState<number | undefined>();
  const [newOrphans, setNewOrphans] = useState<number | undefined>();
  const [orphans, setOrphans] = useState<readonly OrphanedField[]>([]);
  const [busy, setBusy] = useState<"submit" | "choose" | "switch" | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<readonly SubmitBlocker[]>([]);
  const [confirming, setConfirming] = useState(false);
  const bridge = useRef<Bridge | undefined>(undefined);
  const latestState = useRef(state);
  latestState.current = state;

  const onBridge = useCallback((next: Bridge | undefined) => {
    bridge.current = next;
  }, []);

  // A new view (the first, or after a switch): its own state, stream and orphans.
  useEffect(() => {
    setState(initialState(ticket));
    setBlocked([]);
    setProblem(undefined);
    mark("", { shellVersion: String(ticket.version.number), shellView: ticket.viewId });
    const close = openStream(target.apiBase, ticket.viewId, {
      onSnapshot: (snapshot) => setState((current) => withSnapshot(current, snapshot)),
      onEvents: (events) => {
        setState((current) => withEvents(current, events));
        // Another tab's submission: the receipt reads it whole.
        if (events.some((event) => event.type === "submission.created")) {
          void readSnapshot(target.apiBase, ticket.viewId).then((snapshot) => {
            if (snapshot) setState((current) => withSnapshot(current, snapshot));
          });
        }
      },
      onStatus: (status) => {
        setState((current) => ({ ...current, online: status === "live" }));
        if (status === "revoked") setProblem(submitProblem("MOSTRA_HYGIENE_TOKEN_REVOKED"));
      },
    });
    void carryOver(target.apiBase, ticket.version.number)
      .then((carry) => setOrphans(carry.orphans))
      .catch(() => setOrphans([]));
    return close;
  }, [ticket, target.apiBase]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["shellLatest"] = String(state.latest.number);
    root.dataset["shellSave"] = state.save;
  }, [state.latest.number, state.save]);

  /** Asks the frame to save everything; `undefined` when it doesn't answer. */
  const flushFrame = async (reason: "submit" | "switch"): Promise<FlushResult | undefined> => {
    const current = bridge.current;
    if (!current) return undefined;
    try {
      return await current.call(mostraFlush, { reason }, { timeoutMs: FLUSH_TIMEOUT_MS });
    } catch {
      return undefined;
    }
  };

  /** Waits until the shell's own stream reached `revision` of the draft. */
  const caughtUp = async (revision: number): Promise<void> => {
    const until = Date.now() + CATCH_UP_MS;
    while (latestState.current.revision < revision && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const switchVersion = useCallback(async (): Promise<void> => {
    setBusy("switch");
    try {
      await flushFrame("switch");
      const next = await frameTicket(target.apiBase, session.csrf);
      setTicket(next);
      setLater(undefined);
      setNewOrphans(undefined);
    } catch (error) {
      setProblem(submitProblem(error instanceof ShellError ? error.code : "NETWORK"));
    } finally {
      setBusy(undefined);
    }
  }, [target.apiBase, session.csrf]);

  // A newer version: its orphan count for the banner, the frame's notice, and following (D63).
  const newer = !ticket.pinned && state.latest.number > ticket.version.number;
  useEffect(() => {
    if (!newer) return;
    let active = true;
    void carryOver(target.apiBase, state.latest.number)
      .then((carry) => {
        if (!active) return;
        setNewOrphans(carry.orphans.length);
        bridge.current?.notify(mostraVersionAvailable, {
          versionId: state.latest.id,
          version: state.latest.number,
          orphans: carry.orphans.length,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [newer, state.latest.id, state.latest.number, target.apiBase]);

  const heldBy: "unsaved" | "orphans" | undefined =
    !newer || !follow || newOrphans === undefined
      ? undefined
      : state.unsaved
        ? "unsaved"
        : newOrphans > 0
          ? "orphans"
          : undefined;
  useEffect(() => {
    if (newer && follow && newOrphans === 0 && !state.unsaved && busy === undefined) {
      void switchVersion();
    }
  }, [newer, follow, newOrphans, state.unsaved, busy, switchVersion]);

  const toggleFollow = (): void => {
    const next = !follow;
    setFollowing(next);
    void setFollow(target.apiBase, session.csrf, next).catch(() => setFollowing(!next));
  };

  const handlers: FrameHandlers = {
    onFields: (params) =>
      setState((current) => ({
        ...current,
        fields: params.fields,
        save: params.save,
        unsaved: params.unsaved,
      })),
    onControl: (request) => {
      const outcome = withControlRequest(latestState.current, request);
      latestState.current = outcome.state;
      setState(outcome.state);
      return outcome.shown;
    },
    onPage: (path) => {
      setState((current) => ({ ...current, page: path }));
      mark("", { shellPage: path });
    },
  };

  const doSubmit = async (): Promise<void> => {
    setConfirming(false);
    setBusy("submit");
    setProblem(undefined);
    try {
      const flushed = await flushFrame("submit");
      if (flushed) await caughtUp(Number(flushed.revision));
      const current = latestState.current;
      const found = blockersOf(current, flushed?.blockers ?? []);
      if (found.length > 0) {
        setBlocked(found);
        return;
      }
      setBlocked([]);
      if (flushed?.unsaved) {
        setProblem(submitProblem("UNSAVED"));
        return;
      }
      const revision = Math.max(current.revision, Number(flushed?.revision ?? 0));
      const submission = await submit(
        target.apiBase,
        session.csrf,
        ticket.viewId,
        String(revision),
      );
      setState((latest) => withSubmission(latest, submission));
    } catch (error) {
      if (error instanceof ShellError && error.code === "MOSTRA_SUBMIT_ALREADY") {
        const existing = (error.body as { submission?: ViewState["submission"] } | undefined)
          ?.submission;
        if (existing) setState((latest) => withSubmission(latest, existing));
      }
      setProblem(submitProblem(error instanceof ShellError ? error.code : "NETWORK"));
    } finally {
      setBusy(undefined);
    }
  };

  const onSubmit = (): void => {
    if (state.submitConfirm !== undefined) setConfirming(true);
    else void doSubmit();
  };

  const doChoose = async (reviewSetId: string, candidateId: string, label?: string) => {
    setBusy("choose");
    setProblem(undefined);
    try {
      let base = String(latestState.current.revision);
      // The viewer's explicit choice wins over a change they hadn't seen: retried on its revision.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await choose(target.apiBase, session.csrf, {
          viewId: ticket.viewId,
          baseRevision: base,
          reviewSetId,
          candidateId,
          ...(label !== undefined ? { label } : {}),
        });
        const conflict = result.conflicts[0];
        if (!conflict) break;
        base = conflict.revision;
      }
    } catch (error) {
      setProblem(submitProblem(error instanceof ShellError ? error.code : "NETWORK"));
    } finally {
      setBusy(undefined);
    }
  };

  const submitShown = showsSubmit(state);
  const submitted =
    state.closed || (state.submission !== undefined && state.ticket.policy.policy === "once");
  const chooses = showsChoose(state) ? [...state.chooses.values()] : [];
  const versionLabel = `Version ${ticket.version.number}`;

  return (
    <div className="mostra-page">
      <header className="mostra-rail">
        <div className="mostra-label">
          <span className="mostra-mark" aria-hidden="true">
            Mostra
          </span>
          <div>
            <div className="mostra-title">{session.artifact.title}</div>
            <div className="mostra-subtitle">
              {versionLabel}
              {state.viewer?.name ? ` · ${state.viewer.name}` : ""}
            </div>
          </div>
        </div>
        <div className="mostra-status" data-mostra-save={state.save} aria-live="polite">
          <span className={`mostra-dot mostra-dot-${state.save}`} aria-hidden="true" />
          {SAVE_WORDS[state.save]}
        </div>
        {(submitShown || chooses.length > 0) && (
          <div className="mostra-trusted" data-mostra-trusted="">
            <span className="mostra-seal">{CONTROL_WORDS.seal}</span>
            {chooses.map((request) => {
              const current = request.candidates.find((c) => c.id === request.current);
              if (!current) return null;
              const label = current.label ?? current.id;
              const chosen = choiceOf(state, request.reviewSetId) === current.id;
              return (
                <button
                  key={request.reviewSetId}
                  type="button"
                  className="mostra-button"
                  data-mostra-choose={request.reviewSetId}
                  disabled={chosen || busy !== undefined || state.closed}
                  onClick={() => void doChoose(request.reviewSetId, current.id, current.label)}
                >
                  {chosen ? CONTROL_WORDS.chosen(label) : CONTROL_WORDS.choose(label)}
                </button>
              );
            })}
            {submitShown && (
              <button
                type="button"
                id="mostra-submit"
                className="mostra-button mostra-primary"
                disabled={submitted || busy !== undefined}
                onClick={onSubmit}
              >
                {submitted
                  ? CONTROL_WORDS.submitted
                  : busy === "submit"
                    ? CONTROL_WORDS.submitting
                    : (state.submitLabel ?? CONTROL_WORDS.submit)}
              </button>
            )}
          </div>
        )}
      </header>
      {newer && later !== state.latest.number && (
        <div
          className="mostra-banner"
          data-mostra-banner={String(state.latest.number)}
          role="status"
        >
          <div>
            <strong>{BANNER_WORDS.available(state.latest.number)}</strong>
            {newOrphans !== undefined && newOrphans > 0 && (
              <span className="mostra-warn" data-mostra-banner-orphans={String(newOrphans)}>
                {" "}
                {BANNER_WORDS.orphans(newOrphans)}
              </span>
            )}
            {heldBy === "unsaved" && <span> {BANNER_WORDS.heldUnsaved}</span>}
            {heldBy === "orphans" && <span> {BANNER_WORDS.heldOrphans}</span>}
          </div>
          <div className="mostra-actions">
            <button
              type="button"
              className="mostra-link"
              data-mostra-switch=""
              disabled={busy !== undefined}
              onClick={() => void switchVersion()}
            >
              {BANNER_WORDS.switch}
            </button>
            <button
              type="button"
              className="mostra-link"
              data-mostra-follow={follow ? "on" : "off"}
              onClick={toggleFollow}
            >
              {follow ? BANNER_WORDS.unfollow : BANNER_WORDS.follow}
            </button>
            <button
              type="button"
              className="mostra-link"
              onClick={() => setLater(state.latest.number)}
            >
              {BANNER_WORDS.later}
            </button>
          </div>
        </div>
      )}
      {!newer && follow && !ticket.pinned && (
        <div className="mostra-following" data-mostra-follow="on">
          {BANNER_WORDS.following}{" "}
          <button type="button" className="mostra-link" onClick={toggleFollow}>
            {BANNER_WORDS.unfollow}
          </button>
        </div>
      )}
      <main className="mostra-stage">
        <Frame
          title={session.artifact.title}
          ticket={ticket}
          handlers={handlers}
          onBridge={onBridge}
        />
        {(problem !== undefined || blocked.length > 0) && (
          <aside
            className="mostra-problem"
            role="alert"
            data-mostra-blockers={String(blocked.length)}
          >
            {problem !== undefined && <p>{problem}</p>}
            {blocked.length > 0 && (
              <>
                <h2>{BLOCKER_WORDS.heading(blocked.length)}</h2>
                <ul>
                  {blocked.map((blocker) => (
                    <li key={blocker.fieldId}>
                      <button
                        type="button"
                        className="mostra-link"
                        data-mostra-blocker={blocker.fieldId}
                        onClick={() => {
                          // The frame gets the focus first: a page can't take it from its
                          // parent by itself (Firefox).
                          document.querySelector<HTMLIFrameElement>("iframe.mostra-frame")?.focus();
                          bridge.current?.notify(mostraFieldFocus, { id: blocker.fieldId });
                        }}
                      >
                        {blocker.label ?? blocker.fieldId}
                      </button>{" "}
                      {BLOCKER_WORDS.reason(blocker.reason)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
        <Receipt state={state} />
        <Orphans orphans={orphans} />
      </main>
      {confirming && (
        <div className="mostra-dialog-backdrop">
          <div
            className="mostra-dialog"
            role="alertdialog"
            aria-modal="true"
            data-mostra-confirm=""
          >
            <p>{state.submitConfirm}</p>
            <div className="mostra-actions">
              <button type="button" className="mostra-button" onClick={() => setConfirming(false)}>
                {CONTROL_WORDS.cancel}
              </button>
              <button
                type="button"
                className="mostra-button mostra-primary"
                data-mostra-confirm-submit=""
                onClick={() => void doSubmit()}
              >
                {state.submitLabel ?? CONTROL_WORDS.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
