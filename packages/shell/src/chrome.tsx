/**
 * The hosted shell's trusted chrome (D161, ARCHITECTURE §15.6, §15.8): the sender line, the
 * viewer and its sign-in, the footer that says never to enter passwords, the report control, the
 * interstitial an operator's policy may put before a page, and the paused notice. All of it is the
 * shell's, on the shell's origin, outside the artifact's frame, so no artifact can draw over it,
 * restyle it or hide it (invariant 7). Every string a tenant or an operator supplies (names,
 * reasons, the footer and after-submit wording) renders as text: React escapes it, and the shell's
 * Trusted Types policy refuses any string reaching a script sink.
 */
import type { FrameTicket, HostedChrome } from "@mostra/protocol";
import { type ReactElement, useState } from "react";
import { nameViewer, report, signInStart } from "./api.ts";
import { keepSignIn, pkcePair } from "./hosted.ts";
import { HOSTED_WORDS } from "./words.ts";

/** The sender and the viewer, beside the page's title in the rail. */
export function SenderLine(props: { readonly chrome: HostedChrome }): ReactElement | null {
  const { sender } = props.chrome;
  if (!sender) return null;
  return (
    <div className="mostra-subtitle" data-mostra-sender="">
      {HOSTED_WORDS.sentBy(sender.name)}
      {" · "}
      {sender.verifiedBy !== undefined ? (
        <span data-mostra-sender-verified="">{HOSTED_WORDS.verifiedWith(sender.verifiedBy)}</span>
      ) : (
        <span data-mostra-sender-unverified="">{HOSTED_WORDS.unverified}</span>
      )}
    </div>
  );
}

/** Who this browser is to the page, and the sign-in that names the person (INTERFACES §18.4). */
export function ViewerChip(props: {
  readonly chrome: HostedChrome;
  readonly apiBase: string;
  readonly csrf: string;
  readonly routeId: string;
}): ReactElement {
  const { viewer, signIn } = props.chrome;
  const [failed, setFailed] = useState(false);
  // An anonymous viewer may give a name, shown to the page's owner as not verified (D165 item 8).
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(viewer.name ?? "");
  const [named, setNamed] = useState(viewer.name);
  const saveName = async (): Promise<void> => {
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
      const started = await signInStart(props.apiBase, props.csrf, challenge);
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
  if (viewer.kind === "account") {
    return (
      <div className="mostra-viewer" data-mostra-viewer="account">
        {HOSTED_WORDS.signedInAs(viewer.name ?? "")}
      </div>
    );
  }
  return (
    <div className="mostra-viewer" data-mostra-viewer={viewer.kind}>
      {viewer.kind === "anonymous"
        ? named !== undefined
          ? HOSTED_WORDS.namedUnverified(named)
          : HOSTED_WORDS.anonymous
        : (viewer.name ?? "")}
      {viewer.kind === "anonymous" && !naming && (
        <>
          {" "}
          <button
            type="button"
            className="mostra-link"
            data-mostra-name=""
            onClick={() => setNaming(true)}
          >
            {named !== undefined ? HOSTED_WORDS.changeName : HOSTED_WORDS.giveName}
          </button>
        </>
      )}
      {naming && (
        <span data-mostra-naming="">
          {" "}
          <input
            aria-label={HOSTED_WORDS.giveName}
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />{" "}
          <button type="button" className="mostra-link" onClick={() => void saveName()}>
            {HOSTED_WORDS.saveName}
          </button>
        </span>
      )}
      {signIn && viewer.kind === "anonymous" && (
        <>
          {" "}
          <button
            type="button"
            className="mostra-link"
            data-mostra-sign-in=""
            onClick={() => void start()}
          >
            {HOSTED_WORDS.signIn}
          </button>
        </>
      )}
      {failed && (
        <span role="alert" className="mostra-warn">
          {" "}
          {HOSTED_WORDS.signInFailed}
        </span>
      )}
    </div>
  );
}

/** "This page is paused": viewable, taking no answers until resumed (D165 item 14). */
export function PausedNotice(props: { readonly ticket: FrameTicket }): ReactElement | null {
  if (!props.ticket.paused) return null;
  return (
    <div
      className="mostra-banner mostra-warn"
      data-mostra-paused={props.ticket.paused.by}
      role="status"
    >
      <div>
        <strong>{HOSTED_WORDS.paused}</strong> <span>{HOSTED_WORDS.pausedDetail}</span>
        {props.ticket.paused.reason !== undefined && (
          <span data-mostra-paused-reason=""> {props.ticket.paused.reason}</span>
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
      <h1>{HOSTED_WORDS.interstitialTitle}</h1>
      <p>{props.chrome.interstitial?.message ?? HOSTED_WORDS.interstitialDetail}</p>
      {props.chrome.sender && <SenderLine chrome={props.chrome} />}
      <div className="mostra-actions">
        <button type="button" className="mostra-button mostra-primary" onClick={props.onContinue}>
          {HOSTED_WORDS.interstitialContinue}
        </button>
      </div>
    </main>
  );
}

/** The footer, on every hosted page: never enter passwords, and the report control. */
export function HostedFooter(props: {
  readonly chrome: HostedChrome;
  readonly apiBase: string;
  readonly csrf: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("phishing");
  const [detail, setDetail] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "failed" | undefined>();
  const send = async (): Promise<void> => {
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
      <span data-mostra-passwords="">{HOSTED_WORDS.passwords}</span>
      {props.chrome.footer !== undefined && (
        <span data-mostra-footer-operator=""> {props.chrome.footer}</span>
      )}{" "}
      <button
        type="button"
        className="mostra-link"
        data-mostra-report=""
        onClick={() => {
          setOutcome(undefined);
          setOpen(true);
        }}
      >
        {HOSTED_WORDS.report}
      </button>
      {props.chrome.madeWith !== undefined && (
        <>
          {" · "}
          {props.chrome.madeWith.href?.startsWith("https:") ? (
            <a href={props.chrome.madeWith.href} rel="noopener noreferrer" target="_blank">
              Mostra
            </a>
          ) : (
            "Mostra"
          )}
        </>
      )}
      {outcome !== undefined && (
        <span role="status" data-mostra-report-outcome={outcome}>
          {" "}
          {outcome === "sent" ? HOSTED_WORDS.reportSent : HOSTED_WORDS.reportFailed}
        </span>
      )}
      {open && (
        <div className="mostra-dialog-backdrop">
          <div
            className="mostra-dialog"
            role="dialog"
            aria-modal="true"
            data-mostra-report-dialog=""
          >
            <h2>{HOSTED_WORDS.reportTitle}</h2>
            <p>{HOSTED_WORDS.reportIntro}</p>
            {Object.entries(HOSTED_WORDS.reportReasons).map(([value, label]) => (
              <label key={value} className="mostra-choice">
                <input
                  type="radio"
                  name="mostra-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                />{" "}
                {label}
              </label>
            ))}
            <label className="mostra-choice">
              {HOSTED_WORDS.reportDetail}
              <textarea
                value={detail}
                maxLength={2_000}
                onChange={(event) => setDetail(event.target.value)}
              />
            </label>
            <div className="mostra-actions">
              <button type="button" className="mostra-button" onClick={() => setOpen(false)}>
                {HOSTED_WORDS.reportCancel}
              </button>
              <button
                type="button"
                className="mostra-button mostra-primary"
                data-mostra-report-send=""
                onClick={() => void send()}
              >
                {HOSTED_WORDS.reportSend}
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
