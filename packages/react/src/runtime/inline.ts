"use client";

/**
 * What a page shows of Mostra inside an MCP Apps host (D175 items 6, 7): there is no shell, so the
 * runtime renders a small bar itself, below the page. It shows the save state and what blocks a
 * submit, offers Submit (and a review set's Choose) through the artifact channel where the view
 * allows it, and always "Open the full page". It is the artifact channel, recorded as such, and
 * never a trusted control (invariant 7): where the view takes only the shell's channel, it says to
 * submit from the full page. Every feature a chat host's frame can't give states its message in
 * the bar (MC-03).
 *
 * The bar lives in a shadow root, so the page's styles and its own never meet; its colors
 * are the host's MCP Apps variables where the host gives them.
 */
import type { ControlRequest } from "@mostra/protocol";
import { setInlineSink, type Unavailable } from "./inline-sink.ts";
import type { McpAppHandles, McpHostConnection } from "./mcp-host.ts";
import type { Store } from "./store.ts";

/** The bar's words: viewer-facing, plain (D149). */
export const INLINE_WORDS: {
  readonly saved: string;
  readonly saving: string;
  readonly offline: string;
  readonly conflict: string;
  readonly submit: string;
  readonly submitting: string;
  readonly submitted: string;
  readonly confirm: string;
  readonly open: string;
  readonly shellOnly: string;
  readonly closed: string;
  needed(count: number): string;
  choose(label: string): string;
  readonly unavailable: Readonly<Record<Exclude<Unavailable, "origin">, string>>;
  origin(origin: string): string;
} = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Not saved yet",
  conflict: "Changed elsewhere",
  submit: "Submit",
  submitting: "Submitting…",
  submitted: "Submitted",
  confirm: "Submit now?",
  open: "Open the full page",
  shellOnly: "Submit from the full page.",
  closed: "This page takes no more answers.",
  needed: (count) => (count === 1 ? "1 answer needed" : `${count} answers needed`),
  choose: (label) => `Choose ${label}`,
  unavailable: {
    presence: "Who else is here shows on the full page.",
    review: "Comments are made on the full page.",
    choose: "Choosing is done on the full page.",
    versions: "A newer version is on the full page.",
    frames: "Embedded views show on the full page.",
    tools:
      "This chat app can't save answers here: they stay in this browser. Open the full page to send them.",
    streaming: "Results here arrive all at once.",
    calls: "A step that took longer than 45 seconds stopped here. Open the full page to run it.",
    personal: "This link is made for one person, so it opens only for them.",
  },
  origin: (origin) =>
    `This chat app blocks ${origin}, which the page loads. Open the full page to see all of it.`,
};

/** The longest origin a message names. */
const ORIGIN_MAX = 120;

/** The bar's styles: the host's variables first, plain system colors after. */
const STYLE = `
:host { all: initial; display: block; }
.bar { box-sizing: border-box; margin-top: 16px; padding: 10px 12px; display: flex; flex-wrap: wrap;
  align-items: center; gap: 8px 12px; font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
  color: var(--color-text-secondary, GrayText);
  border-top: 1px solid var(--color-border-secondary, color-mix(in srgb, currentColor 20%, transparent)); }
.notes { flex-basis: 100%; margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.notes:empty { display: none; }
.status { flex: 1 1 auto; min-width: 8ch; }
button { font: inherit; padding: 6px 12px; cursor: pointer;
  border-radius: var(--border-radius-md, 6px);
  border: 1px solid var(--color-border-primary, color-mix(in srgb, currentColor 30%, transparent));
  background: var(--color-background-secondary, transparent); color: var(--color-text-primary, CanvasText); }
button.primary { background: var(--color-background-inverse, CanvasText); color: var(--color-text-inverse, Canvas);
  border-color: transparent; }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible { outline: 2px solid var(--color-ring-primary, Highlight); outline-offset: 2px; }
`;

/** Starts the bar for a page inline: its notes, its controls, its Submit. */
export function startInline(options: {
  readonly store: Store;
  readonly host: McpHostConnection;
  /** The page's handles, without which it runs on its own and only offers the full page. */
  readonly handles: McpAppHandles | undefined;
}): void {
  const { store, host, handles } = options;
  const element = document.createElement("mostra-inline");
  // Open, so tools that read the page (a screen reader's, a test's) reach it: nothing in it is
  // trusted, and its own styles stay apart from the page's either way.
  const root = element.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Mostra");
  const notes = document.createElement("ul");
  notes.className = "notes";
  notes.setAttribute("aria-live", "polite");
  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("aria-live", "polite");
  const choose = document.createElement("button");
  choose.type = "button";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "primary";
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = INLINE_WORDS.open;
  bar.append(notes, status, choose, submit, open);
  root.append(style, bar);

  const noted = new Set<string>();
  /** Shows a message once, as text. */
  const say = (text: string): void => {
    if (noted.has(text)) return;
    noted.add(text);
    const item = document.createElement("li");
    item.textContent = text;
    notes.append(item);
  };
  const note = (feature: Unavailable, detail?: string): void => {
    say(
      feature === "origin"
        ? INLINE_WORDS.origin((detail ?? "").slice(0, ORIGIN_MAX))
        : INLINE_WORDS.unavailable[feature],
    );
  };

  let submitLabel: string | undefined;
  let confirmText: string | undefined;
  let confirming = false;
  let submitting = false;
  const choices = new Map<
    string,
    { candidates: Map<string, string | undefined>; current?: string }
  >();
  const control = (request: ControlRequest): void => {
    const asked = request as {
      control: string;
      label?: string;
      confirm?: string;
      submit?: boolean;
      reviewSetId?: string;
      candidates?: { id: string; label?: string }[];
      current?: string;
    };
    if (asked.control === "submit") {
      submitLabel = asked.label;
      confirmText = asked.confirm;
    } else if (asked.control === "choose" && asked.reviewSetId !== undefined) {
      choices.set(asked.reviewSetId, {
        candidates: new Map((asked.candidates ?? []).map((one) => [one.id, one.label])),
        ...(asked.current !== undefined ? { current: asked.current } : {}),
      });
    } else if (asked.control === "release") {
      if (asked.submit === true) {
        submitLabel = undefined;
        confirmText = undefined;
      }
      if (asked.reviewSetId !== undefined) choices.delete(asked.reviewSetId);
    }
    render();
  };

  const artifactChannel = (): boolean =>
    store.mode === "live" && store.view?.submitChannels.includes("artifact") === true;

  const render = (): void => {
    const view = store.view;
    const blockers = store.blockers();
    const state = store.submitState();
    const save = store.pageSave();
    const live = store.mode === "live" && view !== undefined;
    const takesSubmissions = live && view.policy.policy !== "none";
    status.textContent = !live
      ? ""
      : state === "submitted" || state === "delivered" || state === "pending-delivery"
        ? INLINE_WORDS.submitted
        : blockers.length > 0
          ? INLINE_WORDS.needed(blockers.length)
          : INLINE_WORDS[save];
    // Submit: the artifact channel where the view allows it, else the full page's.
    const draftOpen =
      state === "open" || (view?.policy.policy === "epochs" && state !== "submitting");
    submit.hidden = !takesSubmissions || !artifactChannel() || !store.canSubmit() || !draftOpen;
    submit.disabled = submitting || blockers.length > 0;
    submit.textContent = submitting
      ? INLINE_WORDS.submitting
      : confirming
        ? (confirmText ?? INLINE_WORDS.confirm)
        : (submitLabel ?? INLINE_WORDS.submit);
    // The view takes only the shell's trusted Submit, which isn't here (invariant 7).
    if (takesSubmissions && !artifactChannel()) say(INLINE_WORDS.shellOnly);
    if (live && store.closed && view.policy.policy === "once") say(INLINE_WORDS.closed);
    // Choose: the current candidate of the first review set that asked for it.
    const [reviewSetId, set] = [...choices.entries()][0] ?? [];
    const current = set?.current;
    choose.hidden = reviewSetId === undefined || current === undefined || !artifactChannel();
    if (reviewSetId !== undefined && current !== undefined) {
      choose.textContent = INLINE_WORDS.choose(set?.candidates.get(current) ?? current);
      if (!artifactChannel()) note("choose");
    }
    open.hidden = handles === undefined;
  };

  submit.addEventListener("click", () => {
    if (confirmText !== undefined && !confirming) {
      confirming = true;
      render();
      return;
    }
    confirming = false;
    submitting = true;
    render();
    void store
      .submit()
      .catch(() => undefined)
      .finally(() => {
        submitting = false;
        render();
      });
  });
  choose.addEventListener("click", () => {
    const [reviewSetId, set] = [...choices.entries()][0] ?? [];
    if (reviewSetId === undefined || set?.current === undefined) return;
    const label = set.candidates.get(set.current);
    store.set("viewer", `review.${reviewSetId}.choice`, set.current, {
      ...(label !== undefined ? { label } : {}),
      immediate: true,
    });
    void store.flush();
  });
  open.addEventListener("click", () => {
    if (handles !== undefined) void host.openLink(handles.url);
  });

  // A host's policy blocks what the page loads from elsewhere: each is named as it is blocked.
  document.addEventListener("securitypolicyviolation", (event) => {
    const directive = event.effectiveDirective;
    if (directive === "frame-src" || directive === "child-src") {
      note("frames");
      return;
    }
    let origin: string;
    try {
      origin = new URL(event.blockedURI).origin;
    } catch {
      return;
    }
    if (origin !== "null") note("origin", origin);
  });

  setInlineSink({ note, control, openLink: (url) => host.openLink(url) });
  store.subscribe(render);
  render();
  document.body.append(element);
  // What the page renders, judged as it appears (the page renders after the bar starts, and may
  // add more later): review surfaces, which the shell's overlay would serve, and frames of origins
  // the host didn't grant, which its policy blocks (MCP Apps: `frame-src 'none'` unless declared).
  // Frames are judged here, not only by the policy's violation event, since Firefox reports a
  // frame's violation to the document that holds the policy, the host's, not to the page.
  const granted = new Set(grantedFrameOrigins(host));
  const blockedFrame = (frame: Element): boolean => {
    const source = frame.getAttribute("src");
    if (source === null || source === "") return false;
    let origin: string;
    try {
      origin = new URL(source, document.baseURI).origin;
    } catch {
      return false;
    }
    return origin !== "null" && !granted.has(origin);
  };
  const judge = (): boolean => {
    if (document.querySelector("[data-review-id]")) note("review");
    if ([...document.querySelectorAll("iframe, frame, embed, object")].some(blockedFrame)) {
      note("frames");
    }
    return noted.has(INLINE_WORDS.unavailable.review) && noted.has(INLINE_WORDS.unavailable.frames);
  };
  if (!judge() && typeof MutationObserver !== "undefined") {
    const watcher = new MutationObserver(() => {
      if (judge()) watcher.disconnect();
    });
    watcher.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-review-id", "src"],
    });
  }
}

/** The origins a host lets the page frame: what its sandbox's policy granted (`frameDomains`). */
function grantedFrameOrigins(host: McpHostConnection): string[] {
  const sandbox = (host.host.hostCapabilities as { sandbox?: { csp?: { frameDomains?: unknown } } })
    .sandbox;
  const domains = sandbox?.csp?.frameDomains;
  if (!Array.isArray(domains)) return [];
  const origins: string[] = [];
  for (const domain of domains) {
    if (typeof domain !== "string") continue;
    try {
      origins.push(new URL(domain).origin);
    } catch {
      // A host's pattern (`https://*.example.com`) names no one origin: such frames aren't judged.
    }
  }
  return origins;
}
