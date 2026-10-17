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
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  ARM_MS,
  applyControlRequests,
  blockers as blockersOf,
  choiceOf,
  deliveryView,
  type FrameKind,
  initialState,
  showsChoose,
  showsSubmit,
  submitRevision,
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
  SERVER_WORDS,
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
/** How soon after a draft change the "Not carried over" list is read again. */
const ORPHANS_REFRESH_MS = 150;

/** How long the shell waits for its own stream to see the frame's last save. */
const CATCH_UP_MS = 5_000;

/** How many times within {@link REENTRY_WINDOW_MS} the frame is loaded again at its version. */
const REENTRY_LIMIT = 3;
const REENTRY_WINDOW_MS = 10_000;

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
  /** The frame loaded another version than its view's (D98 item 5). */
  onWrongVersion(): void;
  /**
   * The page introduced itself: `runtime` when its client runtime speaks WP-07's messages (it
   * names its version), `legacy` for a version built before them.
   */
  onInitialized(kind: "runtime" | "legacy"): void;
}

/**
 * A ref that always holds the latest `value`, for callbacks and effects that must read it without
 * re-subscribing. It is written after each render commits, never during render.
 */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** The frame and its bridge. */
function Frame(props: {
  readonly title: string;
  readonly ticket: FrameTicket;
  readonly handlers: FrameHandlers;
  readonly onBridge: (bridge: Bridge | undefined) => void;
  /** Whether the frame this one replaces had the focus: the viewer keeps working in it. */
  readonly focus: boolean;
}): ReactElement {
  const frameElement = useRef<HTMLIFrameElement>(null);
  const handlersRef = useLatest(props.handlers);
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
          // A frame that loaded another version than this view's (another tab moved the frame
          // session on) is answered as usual, and loaded again at this view's version.
          const loaded = (params as { mostra?: { versionId?: string } }).mostra?.versionId;
          if (loaded !== undefined && loaded !== ticket.version.id) {
            queueMicrotask(() => handlersRef.current.onWrongVersion());
          } else {
            queueMicrotask(() =>
              handlersRef.current.onInitialized(loaded !== undefined ? "runtime" : "legacy"),
            );
          }
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
          return { shown: handlersRef.current.onControl(params as ControlRequest) };
        }
        return undefined;
      },
      onNotification: (message, params) => {
        if (message === uiInitialized) mark("initialized");
        if (message === mostraReady) mark("ready");
        if (message === mostraFields) handlersRef.current.onFields(params as FieldsParams);
        if (message === mostraPage) handlersRef.current.onPage((params as { path: string }).path);
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
  }, [ticket, onBridge, handlersRef]);
  return (
    <iframe
      ref={frameElement}
      className="mostra-frame"
      data-mostra-view={ticket.viewId}
      src={ticket.src}
      title={props.title}
      onLoad={props.focus ? (event) => event.currentTarget.focus() : undefined}
      allow={FRAME_ALLOW}
      sandbox={frameSandbox()}
    />
  );
}

/**
 * Whether the artifact's frame has the focus. A frame replaced while it had it gives the focus to
 * its successor once that loads; otherwise the focus would fall to the shell's page, where Firefox
 * keeps sending keys until the viewer clicks twice.
 */
function frameHasFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && active.classList.contains("mostra-frame");
}

/** Copies a value as text. */
function copyText(value: unknown): Promise<void> {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return navigator.clipboard.writeText(text);
}

/** The "Not carried over" panel (D42): read-only, copyable, never dropped. */
function Orphans(props: { readonly orphans: readonly OrphanedField[] }): ReactElement | null {
  // Open when it appears, so the viewer sees what didn't carry over; they may fold it away.
  const [open, setOpen] = useState(true);
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
  const [focusFrame, setFocusFrame] = useState(false);
  const [state, setState] = useState<ViewState>(() => initialState(props.ticket));
  const [follow, setFollowing] = useState(props.ticket.follow);
  const [later, setLater] = useState<number | undefined>();
  const [newOrphans, setNewOrphans] = useState<number | undefined>();
  const [orphans, setOrphans] = useState<readonly OrphanedField[]>([]);
  const [busy, setBusy] = useState<"submit" | "choose" | "switch" | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<readonly SubmitBlocker[]>([]);
  const [confirming, setConfirming] = useState(false);
  // What the frame's page is: still loading, a client runtime that saves and answers `mostra/flush`,
  // or a version built before WP-07, which saves on its own and answers nothing.
  const [frameKind, setFrameKind] = useState<FrameKind>("loading");
  const frameKindRef = useLatest(frameKind);
  const bridge = useRef<Bridge | undefined>(undefined);
  const reentries = useRef<number[]>([]);
  // The trusted controls take clicks only once armed (Claude review finding 6): ARM_MS after
  // they appear or change, and after this page is shown (a popup of the shell opened under a
  // second click, a tab brought forward).
  const pointerInZone = useRef(false);
  const heldRequests = useRef<ControlRequest[]>([]);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [armedFor, setArmedFor] = useState<number | undefined>();
  const latestStateRef = useLatest(state);

  const onBridge = useCallback((next: Bridge | undefined) => {
    bridge.current = next;
  }, []);

  // A new view (the first, or after a switch) starts from its own state: reset while rendering,
  // as React advises for state that follows a prop, so no render shows the old view's state.
  const [stateView, setStateView] = useState(ticket.viewId);
  if (stateView !== ticket.viewId) {
    setStateView(ticket.viewId);
    setState(initialState(ticket));
    setBlocked([]);
    setProblem(undefined);
    setFrameKind("loading");
  }

  // Its stream and orphans.
  useEffect(() => {
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
    return close;
  }, [ticket, target.apiBase]);

  // The answers this view's version doesn't carry, read again whenever the draft changes: another
  // tab of an older version may write one, and the panel shows what a submission would deliver
  // (D109, GPT review finding 15).
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void carryOver(target.apiBase, ticket.version.number)
        .then((carry) => {
          if (current) setOrphans(carry.orphans);
        })
        .catch(() => undefined);
    }, ORPHANS_REFRESH_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ticket, target.apiBase, state.revision]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["shellLatest"] = String(state.latest.number);
    root.dataset["shellSave"] = state.save;
  }, [state.latest.number, state.save]);

  useEffect(() => {
    const shown = (): void => {
      if (document.visibilityState === "visible") setShownAt(Date.now());
    };
    // Shown, not focused: the click that focuses the window must still count.
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, []);
  const armUntil = Math.max(state.controlsChangedAt, shownAt) + ARM_MS;
  const armed = armedFor === armUntil;
  useEffect(() => {
    const timer = setTimeout(() => setArmedFor(armUntil), Math.max(0, armUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [armUntil]);
  const armedRef = useLatest(armed);
  const releaseHeld = (): void => {
    pointerInZone.current = false;
    const held = heldRequests.current.splice(0);
    if (held.length === 0) return;
    const now = Date.now();
    // Applied to the newest state, never to a copy an event may have overtaken.
    setState((current) => applyControlRequests(current, held, now));
  };

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
    while (latestStateRef.current.revision < revision && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  // Answers a newer version would leave behind that this view carries (D42).
  const shownOrphansRef = useLatest<ReadonlySet<string>>(
    new Set(orphans.map((orphan) => orphan.id)),
  );
  const countNewOrphans = useCallback(
    async (latest: number): Promise<number> => {
      const carry = await carryOver(target.apiBase, latest);
      return carry.orphans.filter((orphan) => !shownOrphansRef.current.has(orphan.id)).length;
    },
    [target.apiBase, shownOrphansRef],
  );

  const switchVersion = useCallback(
    async (options: { readonly follow?: boolean } = {}): Promise<void> => {
      setBusy("switch");
      mark("", { shellSwitch: options.follow ? "following" : "switching" });
      try {
        // The version the banner described: a newer one published meanwhile gets a banner of its
        // own, with its own count, never a switch the viewer didn't see (Claude review finding 13).
        const latest = latestStateRef.current.latest.number;
        const flushed = await flushFrame("switch");
        if (options.follow) {
          // Following switches by itself only when nothing would be lost from view: checked again
          // after the frame saved everything, since an answer may have changed since the count
          // (LL-03, D63). Otherwise the banner stays, with the count, for the viewer to decide.
          const count = await countNewOrphans(latest);
          if (flushed?.unsaved === true || count > 0) {
            mark("", { shellSwitch: flushed?.unsaved === true ? "held-unsaved" : "held-orphans" });
            setNewOrphans(count);
            return;
          }
        }
        const next = await frameTicket(target.apiBase, session.csrf, latest);
        mark("", { shellSwitch: `to-${String(next.version.number)}` });
        setFocusFrame(frameHasFocus());
        setTicket(next);
        setLater(undefined);
        setNewOrphans(undefined);
      } catch (error) {
        mark("", { shellSwitch: "failed" });
        setProblem(submitProblem(error instanceof ShellError ? error.code : "NETWORK"));
      } finally {
        setBusy(undefined);
      }
    },
    [target.apiBase, session.csrf, countNewOrphans, latestStateRef],
  );

  // A newer version: its orphan count for the banner, the frame's notice, and following (D63).
  // The count is of answers the newer version would leave behind that this one carries: those
  // already not carried over stay in the panel either way (D42). It is counted again whenever the
  // draft changes, so an answer given after the banner appeared counts too.
  const newer = !ticket.pinned && state.latest.number > ticket.version.number;
  // A following viewer moves on by itself once the count says nothing would be left behind and
  // nothing is unsaved (LL-03); the count runs again when either changes, or a switch ends.
  const busyRef = useLatest(busy);
  useEffect(() => {
    if (!newer) return;
    let active = true;
    void countNewOrphans(state.latest.number)
      .then((count) => {
        if (!active) return;
        setNewOrphans(count);
        bridge.current?.notify(mostraVersionAvailable, {
          versionId: state.latest.id,
          version: state.latest.number,
          orphans: count,
        });
        if (follow && count === 0 && !state.unsaved && busyRef.current === undefined) {
          void switchVersion({ follow: true });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    newer,
    state.latest.id,
    state.latest.number,
    state.revision,
    state.unsaved,
    orphans,
    follow,
    busy,
    countNewOrphans,
    switchVersion,
    busyRef,
  ]);

  const heldBy: "unsaved" | "orphans" | undefined =
    !newer || !follow || newOrphans === undefined
      ? undefined
      : state.unsaved
        ? "unsaved"
        : newOrphans > 0
          ? "orphans"
          : undefined;

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
      const now = Date.now();
      // While the pointer is over the trusted controls, what they say and do holds still: a
      // change waits until it leaves (Claude review finding 6). Either way the request is applied
      // to the newest state: building it from `latestStateRef`, which follows renders, lost an
      // event that arrived just before (the draft's revision, a delivery state).
      if (pointerInZone.current) heldRequests.current.push(request);
      else setState((current) => applyControlRequests(current, [request], now));
      // Whether it shows depends on the view's ticket only, which no event changes.
      return withControlRequest(latestStateRef.current, request, now).shown;
    },
    onPage: (path) => {
      setState((current) => ({ ...current, page: path }));
      mark("", { shellPage: path });
    },
    onInitialized: (kind) => setFrameKind(kind),
    onWrongVersion: () => {
      // The frame session serves the version it last entered, which another tab may have moved
      // on (D98 item 5): this view's version is entered again. Several in a row mean two tabs
      // keep moving it, and the viewer is told instead of the frame reloading without end.
      const now = Date.now();
      reentries.current = reentries.current.filter((at) => now - at < REENTRY_WINDOW_MS);
      reentries.current.push(now);
      mark("", { frameReentries: String(reentries.current.length) });
      if (reentries.current.length > REENTRY_LIMIT) {
        setProblem(BANNER_WORDS.movedByOtherTab);
        return;
      }
      void frameTicket(target.apiBase, session.csrf, ticket.version.number)
        .then((next) => {
          setFocusFrame(frameHasFocus());
          setTicket(next);
        })
        .catch(() => setProblem(BANNER_WORDS.movedByOtherTab));
    },
  };

  const doSubmit = async (): Promise<void> => {
    if (!armedRef.current) return;
    setConfirming(false);
    setBusy("submit");
    setProblem(undefined);
    try {
      const kind = frameKindRef.current;
      const flushed = kind === "loading" ? undefined : await flushFrame("submit");
      const refused = submitRevision(kind, flushed, 0);
      if ("problem" in refused) {
        setProblem(submitProblem(refused.problem));
        return;
      }
      if (flushed) await caughtUp(Number(flushed.revision));
      const current = latestStateRef.current;
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
      const planned = submitRevision(kind, flushed, current.revision);
      if (!("revision" in planned)) return;
      const revision = planned.revision;
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
    if (!armedRef.current) return;
    if (state.submitConfirm !== undefined) {
      // The question is a control of its own: armed only after it appears, so a second click
      // meant for the first never answers it.
      setShownAt(Date.now());
      setConfirming(true);
    } else void doSubmit();
  };

  const doChoose = async (reviewSetId: string, candidateId: string, label?: string) => {
    setBusy("choose");
    setProblem(undefined);
    try {
      let base = String(latestStateRef.current.revision);
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

  // A `verify` run (D137) measures the page alone: the frame fills the viewport, at exactly the
  // size verify renders, with none of the shell's chrome. Sessions, tickets and the bridge are the
  // same as a viewer's, and `data-shell` still says when the page is ready.
  if (ticket.target === "verify") {
    return (
      <div className="mostra-verify" data-mostra-verify="">
        <Frame
          key={ticket.viewId}
          focus={false}
          title={session.artifact.title}
          ticket={ticket}
          handlers={handlers}
          onBridge={onBridge}
        />
      </div>
    );
  }

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
        {/* The page's save state, once its runtime reports it: until then it is "Connecting…",
            never a "Saved" nobody confirmed (Claude review finding 4). A version built before
            WP-07 reports none, and none is shown. */}
        {frameKind !== "legacy" && (
          <div
            className="mostra-status"
            data-mostra-save={frameKind === "loading" ? "connecting" : state.save}
            aria-live="polite"
          >
            <span
              className={`mostra-dot mostra-dot-${frameKind === "loading" ? "saving" : state.save}`}
              aria-hidden="true"
            />
            {frameKind === "loading" ? SAVE_WORDS.connecting : SAVE_WORDS[state.save]}
          </div>
        )}
        {(submitShown || chooses.length > 0) && (
          <div
            className="mostra-trusted"
            data-mostra-trusted=""
            data-mostra-armed={armed ? "" : undefined}
            onPointerEnter={() => {
              pointerInZone.current = true;
            }}
            onPointerLeave={releaseHeld}
          >
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
                  disabled={!armed || chosen || busy !== undefined || state.closed}
                  onClick={() => {
                    if (armedRef.current) {
                      void doChoose(request.reviewSetId, current.id, current.label);
                    }
                  }}
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
                disabled={!armed || submitted || busy !== undefined}
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
      {state.serverParked && (
        <div className="mostra-banner mostra-warn" data-mostra-server-notice="parked" role="alert">
          <div>
            <strong>{SERVER_WORDS.parked}</strong> <span>{SERVER_WORDS.parkedDetail}</span>
          </div>
        </div>
      )}
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
        {/* One frame element per view: a switch or a re-entry loads a new browsing context instead
            of navigating the old one, so it adds no entry to the tab's history (Back never takes
            the frame to a spent ticket) and nothing of the old page lingers. */}
        <Frame
          key={ticket.viewId}
          focus={focusFrame}
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
                disabled={!armed}
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
