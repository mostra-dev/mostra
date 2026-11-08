/**
 * What the shell's trusted controls, version banner and receipt say to a person (WP-07). Every
 * viewer-facing sentence of these features lives here, so it is reviewed in one place (IN-13:
 * Mirza reviews the wording) and kept plain: short words, no jargon.
 */

/** The rail's save state (D47). */
export const SAVE_WORDS: Readonly<
  Record<"saved" | "saving" | "offline" | "conflict" | "connecting", string>
> = {
  connecting: "Connecting…",
  saved: "Saved",
  saving: "Saving…",
  offline: "Not saved yet: offline",
  conflict: "Changed elsewhere",
};

/** The mark of a `mostra dev` preview (D140 item 12), shown as long as the view lasts. */
export const DEV_WORDS = {
  preview: "Development preview, not published",
} as const;

/** What the shell says when the view's server code keeps crashing (WP-08, FAILURE_MODEL §2). */
export const SERVER_WORDS = {
  parked: "This artifact's server code keeps crashing.",
  parkedDetail: "Its buttons and live data won't work until a fixed version is published.",
} as const;

/** The trusted controls' fixed words. */
export const CONTROL_WORDS = {
  submit: "Submit",
  submitted: "Submitted",
  submitting: "Submitting…",
  seal: "Mostra · trusted control",
  choose: (label: string): string => `Choose ${label}`,
  chosen: (label: string): string => `Chosen: ${label}`,
  confirm: "Submit",
  cancel: "Cancel",
} as const;

/** Why the trusted Submit didn't go through, in plain words. */
export function submitProblem(code: string): string {
  switch (code) {
    case "MOSTRA_SUBMIT_REVISION_MOVED":
      return "Your answers changed while you submitted. Check them, then submit again.";
    case "MOSTRA_SUBMIT_ALREADY":
      return "This was already submitted.";
    case "MOSTRA_SUBMIT_POLICY_NONE":
      return "This artifact doesn't take submissions.";
    case "MOSTRA_SUBMIT_CHANNEL_DENIED":
      return "This host doesn't take submissions from here.";
    case "MOSTRA_HYGIENE_TOKEN_REVOKED":
      return "This link was revoked or has expired. Your answers are kept in this browser.";
    case "MOSTRA_HYGIENE_SCOPE_DENIED":
      return "This link can view but not submit.";
    case "NOT_READY":
      return "The page is still loading. Submit again in a moment.";
    case "NO_ANSWER":
      return "The page didn't confirm your answers are saved. Nothing was submitted; try again.";
    case "UNSAVED":
      return "Some answers aren't saved yet. Submit again when the page is back online.";
    case "NETWORK":
      return "Mostra can't be reached right now. Nothing was submitted; try again.";
    // A hosted page's refusals, each keeping the draft (D165 items 13, 14; INTERFACES §18.4).
    case "MOSTRA_REMOTE_RATE_LIMITED":
      return HOSTED_WORDS.tryAgain;
    case "MOSTRA_REMOTE_LIMIT_REACHED":
    case "MOSTRA_REMOTE_OPERATOR_UNAVAILABLE":
      return HOSTED_WORDS.notAccepting;
    case "MOSTRA_REMOTE_SIGN_IN_REQUIRED":
      return HOSTED_WORDS.signInToAnswer;
    case "MOSTRA_SUBMIT_PAUSED":
      return `${HOSTED_WORDS.paused} ${HOSTED_WORDS.pausedDetail}`;
    default:
      return "The submission didn't go through. Try again.";
  }
}

/** The blockers' heading and one line per field. */
export const BLOCKER_WORDS = {
  heading: (count: number): string =>
    count === 1 ? "One answer needs attention" : `${String(count)} answers need attention`,
  reason: (reason: "required" | "invalid" | "conflict"): string =>
    reason === "required"
      ? "needs an answer"
      : reason === "invalid"
        ? "isn't valid yet"
        : "was changed elsewhere: keep yours or take theirs",
} as const;

/** The submission receipt (IN-13): Mostra's record and each host's delivery, kept apart. */
export const RECEIPT_WORDS = {
  /** On a hosted link a respondent sees only this, once the hosted home has the answer (D165). */
  sent: "Your answer was sent.",
  submitted: "Submitted",
  delivered: "Delivered",
  pending: "Pending delivery",
  undeliverable: "Undeliverable",
  saved: "Saved by Mostra",
  deliveredTo: (host: string): string => `Delivered to ${host}`,
  pendingTo: (host: string): string => `Pending delivery to ${host}: Mostra will retry.`,
  undeliverableTo: (host: string, reason?: string): string =>
    host +
    " couldn't take it" +
    (reason !== undefined && reason !== "undeliverable" ? ` (${reason})` : "") +
    ".",
  footnote: (version: number): string =>
    "This submission names version " +
    String(version) +
    ". Nothing is lost if delivery is delayed.",
  stale: (latest: number): string =>
    `A newer version (${String(latest)}) existed when you submitted.`,
} as const;

/** The version banner (VR-04, D42, D63). */
export const BANNER_WORDS = {
  available: (version: number): string => `Version ${String(version)} is available.`,
  orphans: (count: number): string =>
    count === 1
      ? "1 of your answers isn't in it; it stays here, read-only, and is still sent."
      : String(count) +
        " of your answers aren't in it; they stay here, read-only, and are still sent.",
  switch: "Switch",
  follow: "Always follow this artifact",
  following: "Following: new versions open by themselves",
  unfollow: "Stop following",
  later: "Later",
  heldUnsaved: "Not switched yet: some answers aren't saved.",
  heldOrphans: "Not switched by itself: some answers wouldn't carry over.",
  movedByOtherTab:
    "Another tab of this artifact keeps opening a different version. Close one of them, then reload this page.",
} as const;

/** The artifact's frame (D157). */
export const FRAME_WORDS = {
  unreachable: "This page didn't load. Reload this page to try again.",
  /** Worker mode's bootstrap couldn't start the frame's session (D70, FAILURE_MODEL §8). */
  frameSession:
    "This browser didn't let the page start here: it needs service workers, which private windows and some settings turn off. Open the link in a normal window, or ask for a tailnet or Funnel link.",
} as const;

/** The "Not carried over" panel (D42). */
export const ORPHAN_WORDS = {
  title: "Not carried over",
  intro: "These answers came from an earlier version. They are kept and sent with your submission.",
  from: (version: number): string => `From version ${String(version)}`,
  copy: "Copy",
  copied: "Copied",
  show: (count: number): string =>
    count === 1 ? "1 answer not carried over" : `${String(count)} answers not carried over`,
  hide: "Hide",
} as const;

/**
 * The hosted shell's trusted chrome (D161, ARCHITECTURE §15.8): drafts for Mirza's review with
 * the package's prose (D149). Every name and reason a tenant or an operator supplies is shown as
 * text beside these, never as markup.
 */
export const HOSTED_WORDS = {
  /** The sender line: whose page this is, and who verified the name. */
  sentBy: (name: string): string => `Sent by ${name}`,
  verifiedWith: (provider: string): string => `verified with ${provider}`,
  unverified: "name not verified",
  /** The footer, on every hosted page. */
  passwords: "Never enter passwords on this page.",
  /** The report control. */
  report: "Report this page",
  reportTitle: "Report this page",
  reportIntro: "Tell the people who run this server what's wrong with this page.",
  reportReasons: {
    phishing: "It asks for passwords or payment details",
    abuse: "It's abusive or harmful",
    spam: "It's spam",
    other: "Something else",
  } as Readonly<Record<string, string>>,
  reportDetail: "More detail (optional)",
  reportSend: "Send report",
  reportCancel: "Cancel",
  reportSent: "Thanks. The report was sent.",
  reportFailed: "The report couldn't be sent. Try again shortly.",
  /** The viewer. */
  signIn: "Sign in",
  signedInAs: (name: string): string => `Signed in as ${name}`,
  anonymous: "Not signed in",
  giveName: "Add your name",
  changeName: "Change name",
  saveName: "Save",
  namedUnverified: (name: string): string => `${name} (not verified)`,
  signInFailed: "Sign-in didn't finish. Open the page again and try once more.",
  signingIn: "Signing you in…",
  /** A page an operator paused, or that its owner paused. */
  paused: "This page is paused.",
  pausedDetail: "You can look at it, but it takes no answers right now. What you typed is kept.",
  /** The interstitial an operator's policy may put before a page. */
  interstitialTitle: "Before you open this page",
  interstitialDetail:
    "Someone sent you this page. Don't enter passwords or payment details unless you trust them.",
  interstitialContinue: "Open the page",
  /** A submission refused for a limit: try again shortly, the draft kept (RM-08). */
  tryAgain: "Too many answers at once. Try again shortly; what you typed is kept.",
  notAccepting: "This page isn't accepting answers right now. What you typed is kept.",
  signInToAnswer: "Sign in to answer this page.",
} as const;
