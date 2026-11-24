/**
 * The shell's trusted chrome (D161, D171; ARCHITECTURE §15.6, §15.8): whose page this is, the
 * viewer and their sign-in, the status beside Submit, the footer that says never to enter
 * passwords, the report control, the made-with mark, the light-or-dark button and the button that
 * folds the chrome away. All of it is the shell's, on the shell's origin, outside the artifact's
 * frame, so no artifact can draw over it, restyle it or hide it (invariant 7). Every string a
 * tenant or an operator supplies (names, reasons, the footer and after-submit wording) renders as
 * text: React escapes it, and the shell's Trusted Types policy refuses any string reaching a script
 * sink.
 */
import type { FrameTicket, HostedChrome } from "@mostra/protocol";
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { nameViewer, report, signInStart } from "./api.ts";
import { currentAppearance, toggleAppearance } from "./appearance.ts";
import { keepSignIn, pkcePair, sessionUnstored, signedOutHere } from "./hosted.ts";
import {
  CloseIcon,
  FlagIcon,
  FoldIcon,
  LockIcon,
  MoonIcon,
  MostraMark,
  PersonIcon,
  SunIcon,
  UnfoldIcon,
  VerifiedIcon,
} from "./icons.tsx";
import { CHROME_WORDS, DELIVERY_WORDS, HOSTED_WORDS, STATUS_WORDS } from "./words.ts";

/** What the status beside Submit shows (D171 item 7). */
export type StatusKind = keyof typeof STATUS_WORDS;

/** One host's delivery of the submission, as the status's details list it (IN-13). */
export interface DeliveryLine {
  readonly key: string;
  /** `delivered`, `pending`, `rejected` or `undeliverable`. */
  readonly state: string;
  readonly text: string;
}

/** The kinds that tell where a submission stands rather than where the draft does. */
const SUBMISSION_KINDS: ReadonlySet<StatusKind> = new Set([
  "sent",
  "submitted",
  "pending",
  "delivered",
  "undeliverable",
]);

/** The tick of a submission that is in, and the mark of one a host couldn't take. */
function StatusMark(props: { readonly kind: StatusKind }): ReactElement | null {
  if (props.kind === "undeliverable") {
    return (
      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <path
          d="M8 4.5v4.2M8 11.2v.3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (props.kind === "pending") return null;
  if (!SUBMISSION_KINDS.has(props.kind)) return null;
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path
        d="M4.8 8.2l2.1 2.1 4.3-4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The status: one small shape whose form and colour change together (a dot when saved, a ring
 * while saving, a diamond offline or in conflict, a tick once submitted and delivered, a ring with
 * a tick while delivery waits, a mark when a host couldn't take it), its words for screen readers
 * and on hover, and beside it on a phone and once a submission is in. Once one is, it is also the
 * way to what the receipt used to say (D175 item 12): each host's delivery and a stale view's note,
 * in a small panel. `save` is the rail's save state for whoever reads `data-mostra-save`; a second,
 * quiet copy (the folded chrome's) carries neither it nor a live region.
 */
export function StatusIndicator(props: {
  readonly kind: StatusKind;
  readonly words?: string;
  readonly save?: string;
  readonly quiet?: boolean;
  /** Each host's delivery, for the details. */
  readonly deliveries?: readonly DeliveryLine[];
  /** A stale view's note, for the details. */
  readonly stale?: string;
}): ReactElement {
  const words = props.words ?? STATUS_WORDS[props.kind];
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const submission = SUBMISSION_KINDS.has(props.kind);
  const details =
    !props.quiet &&
    submission &&
    ((props.deliveries?.length ?? 0) > 0 || props.stale !== undefined);
  const shape = (
    <span className={`mostra-dot mostra-dot-${props.kind}`} aria-hidden="true">
      <StatusMark kind={props.kind} />
    </span>
  );
  return (
    <div
      className="mostra-status"
      data-mostra-save={props.save}
      data-mostra-status={props.kind}
      data-mostra-submission={submission && !props.quiet ? props.kind : undefined}
      data-open={open ? "" : undefined}
      role={props.quiet ? undefined : "status"}
      title={details ? undefined : words}
    >
      {details ? (
        <button
          type="button"
          className="mostra-status-button"
          aria-expanded={open}
          aria-controls={detailsId}
          title={DELIVERY_WORDS.details}
          onClick={() => setOpen(!open)}
        >
          {shape}
          <span className="mostra-status-words">{words}</span>
        </button>
      ) : (
        <>
          {shape}
          <span className="mostra-status-words">{words}</span>
        </>
      )}
      {details && (
        <div className="mostra-status-details" id={detailsId} hidden={!open}>
          <ul>
            {(props.deliveries ?? []).map((line) => (
              <li key={line.key} data-mostra-delivery={line.state}>
                {line.text}
              </li>
            ))}
          </ul>
          {props.stale !== undefined && (
            <p className="mostra-status-stale" data-mostra-stale="">
              {props.stale}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The button that folds the chrome away, or brings it back. Only the person presses it. */
export function FoldButton(props: {
  readonly folded: boolean;
  readonly onToggle: () => void;
  readonly id?: string;
}): ReactElement {
  const label = props.folded ? CHROME_WORDS.unfold : CHROME_WORDS.fold;
  return (
    <button
      type="button"
      id={props.id}
      className="mostra-icon"
      data-mostra-fold={props.folded ? "folded" : "open"}
      aria-label={label}
      title={label}
      aria-expanded={!props.folded}
      onClick={props.onToggle}
    >
      {props.folded ? <UnfoldIcon /> : <FoldIcon />}
    </button>
  );
}

/** One small button that turns the shell light or dark; the device's setting until pressed. */
export function AppearanceButton(): ReactElement {
  const [mode, setMode] = useState(currentAppearance);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = (): void => setMode(currentAppearance());
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  const label = mode === "dark" ? CHROME_WORDS.toLight : CHROME_WORDS.toDark;
  return (
    <button
      type="button"
      className="mostra-icon"
      data-mostra-appearance={mode}
      aria-label={label}
      title={label}
      onClick={() => setMode(toggleAppearance())}
    >
      {mode === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** The sender and who verified the name, under the page's title. */
export function SenderLine(props: { readonly chrome: HostedChrome }): ReactElement | null {
  const { sender } = props.chrome;
  if (!sender) return null;
  return (
    <div className="mostra-sender" data-mostra-sender="">
      <span className="mostra-sender-name">
        {HOSTED_WORDS.sentBy("")}
        <b>{sender.name}</b>
      </span>{" "}
      {sender.verifiedBy !== undefined ? (
        <span className="mostra-verified" data-mostra-sender-verified="">
          <VerifiedIcon />
          {HOSTED_WORDS.verifiedWith(sender.verifiedBy)}
        </span>
      ) : (
        <span className="mostra-unverified" data-mostra-sender-unverified="">
          {HOSTED_WORDS.unverified}
        </span>
      )}
    </div>
  );
}

/**
 * Who this browser is to the page, and the sign-in that names the person (INTERFACES §18.4), or
 * once signed in, the sign-out that takes the name off (MT-06): pill buttons in the bar on a
 * computer; on a phone, one button that opens them as a sheet.
 */
export function ViewerChip(props: {
  readonly chrome: HostedChrome;
  readonly apiBase: string;
  readonly csrf: string;
  readonly routeId: string;
  /** Signs this page out: its session goes back to this browser's anonymous viewer (MT-06). */
  readonly onSignOut: () => Promise<void>;
}): ReactElement {
  const { viewer, signIn } = props.chrome;
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // An anonymous viewer may give a name, shown to the page's owner as not verified (D165 item 8).
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(viewer.name ?? "");
  const [named, setNamed] = useState(viewer.name);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming) nameInput.current?.focus();
  }, [naming]);
  const saveName = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const chosen = name.trim().slice(0, 64);
    try {
      await nameViewer(props.apiBase, props.csrf, chosen === "" ? null : chosen);
      setNamed(chosen === "" ? undefined : chosen);
      setNaming(false);
    } catch {
      setFailed(true);
    }
  };
  const start = async (): Promise<void> => {
    try {
      const { verifier, challenge } = await pkcePair();
      // After a sign-out here, the sign-in asks the person to name themselves again, whoever the
      // server still has signed in in this browser (MT-06).
      const started = await signInStart(
        props.apiBase,
        props.csrf,
        challenge,
        signedOutHere(props.routeId) ? "consent" : undefined,
      );
      const kept = keepSignIn({
        routeId: props.routeId,
        verifier,
        state: started.state,
        issuer: new URL(started.url).origin,
        back: location.pathname,
      });
      if (!kept) throw new Error("This tab can't keep the sign-in.");
      location.assign(started.url);
    } catch {
      setFailed(true);
    }
  };
  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await props.onSignOut();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };
  // Sign-in leaves the page and comes back to a session it reads from storage: with none stored
  // (a full or blocked storage), it couldn't finish and would lose the link, so it isn't offered
  // (second Fable review of WP-30, 7).
  const offerSignIn = signIn && viewer.kind === "anonymous" && !sessionUnstored();
  return (
    <div
      className="mostra-viewer"
      data-mostra-viewer={viewer.kind}
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        className="mostra-icon mostra-viewer-toggle"
        aria-label={CHROME_WORDS.viewer}
        title={CHROME_WORDS.viewer}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <PersonIcon />
      </button>
      <div className="mostra-viewer-body" id={bodyId}>
        <button
          type="button"
          className="mostra-icon mostra-viewer-close"
          aria-label={CHROME_WORDS.closeViewer}
          onClick={() => setOpen(false)}
        >
          <CloseIcon />
        </button>
        {viewer.kind === "account" ? (
          <span className="mostra-pill mostra-pill-static">
            <PersonIcon />
            <span className="mostra-sr">{HOSTED_WORDS.signedIn}</span>
            <span className="mostra-pill-text">{viewer.name ?? ""}</span>
          </span>
        ) : viewer.kind === "anonymous" ? (
          <button
            type="button"
            className="mostra-pill"
            data-mostra-name=""
            aria-expanded={naming}
            onClick={() => setNaming(!naming)}
          >
            <PersonIcon />
            {named === undefined && <span className="mostra-sr">{HOSTED_WORDS.anonymous}. </span>}
            <span className="mostra-pill-text">
              {named !== undefined ? HOSTED_WORDS.namedUnverified(named) : HOSTED_WORDS.giveName}
            </span>
          </button>
        ) : (
          <span className="mostra-pill mostra-pill-static">
            <PersonIcon />
            <span className="mostra-pill-text">{viewer.name ?? ""}</span>
          </span>
        )}
        {viewer.kind === "account" && (
          <button
            type="button"
            className="mostra-pill"
            data-mostra-sign-out=""
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {HOSTED_WORDS.signOut}
          </button>
        )}
        {offerSignIn && (
          <button
            type="button"
            className="mostra-pill"
            data-mostra-sign-in=""
            onClick={() => void start()}
          >
            {HOSTED_WORDS.signIn}
          </button>
        )}
        {naming && (
          <form
            className="mostra-popover"
            data-mostra-naming=""
            onSubmit={(event) => void saveName(event)}
          >
            <label className="mostra-field">
              <span>{HOSTED_WORDS.giveName}</span>
              <input
                ref={nameInput}
                value={name}
                maxLength={64}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="mostra-hint">{HOSTED_WORDS.nameHint}</p>
            <div className="mostra-actions">
              <button type="button" className="mostra-button" onClick={() => setNaming(false)}>
                {HOSTED_WORDS.cancelName}
              </button>
              <button type="submit" className="mostra-button mostra-primary">
                {HOSTED_WORDS.saveName}
              </button>
            </div>
          </form>
        )}
        {failed && (
          <span role="alert" className="mostra-warn">
            {HOSTED_WORDS.signInFailed}
          </span>
        )}
        {signOutFailed && (
          <span role="alert" className="mostra-warn">
            {HOSTED_WORDS.signOutFailed}
          </span>
        )}
      </div>
    </div>
  );
}

/** "This page is paused": viewable, taking no answers until resumed (D165 item 14). */
export function PausedNotice(props: { readonly ticket: FrameTicket }): ReactElement | null {
  if (!props.ticket.paused) return null;
  return (
    <div
      className="mostra-banner mostra-banner-warn"
      data-mostra-paused={props.ticket.paused.by}
      role="status"
    >
      {/* A long reason scrolls, and a keyboard must reach it (WCAG 2.1.1). */}
      <div className="mostra-scroll" tabIndex={props.ticket.paused.reason ? 0 : undefined}>
        <strong>{HOSTED_WORDS.paused}</strong> <span>{HOSTED_WORDS.pausedDetail}</span>
        {props.ticket.paused.reason !== undefined && (
          <span className="mostra-reason" data-mostra-paused-reason="">
            {" "}
            {props.ticket.paused.reason}
          </span>
        )}
      </div>
    </div>
  );
}

/** The interstitial a server's policy puts before a page: the frame loads only once passed. */
export function Interstitial(props: {
  readonly chrome: HostedChrome;
  readonly onContinue: () => void;
}): ReactElement {
  return (
    <main
      className="mostra-shell mostra-notice"
      data-mostra-interstitial={props.chrome.interstitial?.kind ?? ""}
    >
      <div className="mostra-card">
        <h1>{HOSTED_WORDS.interstitialTitle}</h1>
        <p className="mostra-reason">
          {props.chrome.interstitial?.message ?? HOSTED_WORDS.interstitialDetail}
        </p>
        {props.chrome.sender && <SenderLine chrome={props.chrome} />}
        <div className="mostra-actions">
          <button type="button" className="mostra-button mostra-primary" onClick={props.onContinue}>
            {HOSTED_WORDS.interstitialContinue}
          </button>
        </div>
      </div>
    </main>
  );
}

/** Mostra's mark and "Make pages like this", on pages on free terms (D171 item 5). */
export function MadeWith(props: { readonly chrome: HostedChrome }): ReactElement | null {
  const madeWith = props.chrome.madeWith;
  if (!madeWith) return null;
  // The visible words are the link's name (WCAG 2.5.3); "Made with" is for screen readers only.
  const inner = (
    <>
      <MostraMark />
      <span className="mostra-sr">{HOSTED_WORDS.madeWithPrefix}</span>
      <b className="mostra-footer-words">Mostra</b>
      <span className="mostra-made-line">{HOSTED_WORDS.madeWith}</span>
    </>
  );
  return madeWith.href?.startsWith("https:") ? (
    <a
      className="mostra-made"
      data-mostra-made-with=""
      href={madeWith.href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {inner}
    </a>
  ) : (
    <span className="mostra-made" data-mostra-made-with="">
      {inner}
    </span>
  );
}

/** The footer, on every hosted page: never enter passwords, the report control, the made-with mark. */
export function HostedFooter(props: {
  readonly chrome: HostedChrome;
  readonly apiBase: string;
  readonly csrf: string;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("phishing");
  const [detail, setDetail] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "failed" | undefined>();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await report(props.apiBase, props.csrf, {
        reason,
        ...(detail.trim() !== "" ? { detail: detail.trim().slice(0, 2_000) } : {}),
      });
      setOutcome("sent");
      setOpen(false);
    } catch {
      setOutcome("failed");
    }
  };
  return (
    <footer className="mostra-footer" data-mostra-footer="">
      <span className="mostra-footer-item" data-mostra-passwords="">
        <LockIcon />
        {HOSTED_WORDS.passwords}
      </span>
      {props.chrome.footer !== undefined && (
        <span className="mostra-footer-item mostra-reason" data-mostra-footer-operator="">
          {props.chrome.footer}
        </span>
      )}
      <button
        type="button"
        className="mostra-footer-item mostra-footer-link"
        data-mostra-report=""
        title={HOSTED_WORDS.reportTitle}
        onClick={() => {
          setOutcome(undefined);
          setOpen(true);
        }}
      >
        <FlagIcon />
        {/* On a phone the flag stands alone, its word kept for screen readers. */}
        <span className="mostra-footer-words">{HOSTED_WORDS.report}</span>
      </button>
      <span role="status" className="mostra-footer-item" data-mostra-report-outcome={outcome}>
        {outcome === "sent"
          ? HOSTED_WORDS.reportSent
          : outcome === "failed"
            ? HOSTED_WORDS.reportFailed
            : ""}
      </span>
      <span className="mostra-footer-end">
        <MadeWith chrome={props.chrome} />
        <AppearanceButton />
      </span>
      <dialog
        ref={dialog}
        className="mostra-dialog"
        data-mostra-report-dialog=""
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={(event) => void send(event)}>
          <h2 id={titleId}>{HOSTED_WORDS.reportTitle}</h2>
          <p>{HOSTED_WORDS.reportIntro}</p>
          <fieldset className="mostra-choices">
            <legend className="mostra-sr">{HOSTED_WORDS.reportTitle}</legend>
            {Object.entries(HOSTED_WORDS.reportReasons).map(([value, label]) => (
              <label key={value} className="mostra-choice">
                <input
                  type="radio"
                  name="mostra-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className="mostra-field">
            <span>{HOSTED_WORDS.reportDetail}</span>
            <textarea
              value={detail}
              maxLength={2_000}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
          {outcome === "failed" && (
            <p role="alert" className="mostra-warn">
              {HOSTED_WORDS.reportFailed}
            </p>
          )}
          <div className="mostra-actions">
            <button type="button" className="mostra-button" onClick={() => setOpen(false)}>
              {HOSTED_WORDS.reportCancel}
            </button>
            <button
              type="submit"
              className="mostra-button mostra-primary"
              data-mostra-report-send=""
            >
              {HOSTED_WORDS.reportSend}
            </button>
          </div>
        </form>
      </dialog>
    </footer>
  );
}
