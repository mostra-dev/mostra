/**
 * The review overlay (WP-20; D23, RV-01 to RV-04, CO-06): comment pins over the artifact's frame,
 * the comment mode that turns a click into an anchored comment, and the panel of threads with
 * replies, resolve, reopen, mentions and each thread's crop. All of it is shell DOM on the shell's
 * origin: the frame can only describe a point (`mostra/review.hitTest`) and say where an anchor is
 * now (`mostra/review.positions`); it can move a pin within its own box, never make, hide or
 * remove a thread, which the panel lists whatever the page reports (RV-04). Every name and comment
 * is text, never markup.
 */
import {
  type AnchorPosition,
  type Bridge,
  CommentId,
  mostraReviewHitTest,
  mostraReviewScrollTo,
  mostraReviewTrack,
  type ReviewAnchor,
  type ReviewPerson,
  type ReviewThread,
  ThreadId,
} from "@mostra/protocol";
import {
  type FormEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createThread,
  cropUrl,
  replyThread,
  reviewThreads,
  ShellError,
  setThreadStatus,
} from "./api.ts";
import { CloseIcon, CommentIcon } from "./icons.tsx";
import { REVIEW_WORDS, submitProblem } from "./words.ts";

/** A pin the viewer is placing: where, and what the page said is there. */
interface Draft {
  readonly anchor: ReviewAnchor;
  /** Its box in the frame, for its pin; none for a comment on the whole page. */
  readonly box?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** The state the overlay shares with the page around it. */
export interface ReviewState {
  readonly threads: readonly ReviewThread[];
  readonly people: readonly ReviewPerson[];
  readonly writable: boolean;
  readonly positions: ReadonlyMap<string, AnchorPosition>;
}

/** What the viewer page gives the overlay. */
export interface ReviewOptions {
  readonly apiBase: string;
  readonly csrf: string;
  readonly viewId: string;
  /** The page of a `pages/` artifact the viewer is on (D57), recorded with each comment. */
  readonly page?: string | undefined;
  readonly bridge: () => Bridge | undefined;
  /** Whether the frame's page has a client runtime that answers the review messages. */
  readonly agent: boolean;
  /** Whether the link may review at all: without the `review` scope nothing is read. */
  readonly enabled: boolean;
}

/** The overlay's controller: threads, positions, the comment mode, and their actions. */
export interface Review {
  readonly state: ReviewState;
  /** Whether a click on the page makes a comment. */
  readonly mode: boolean;
  setMode(on: boolean): void;
  /** Whether the panel of threads is open. */
  readonly panel: boolean;
  setPanel(open: boolean): void;
  /** The thread the viewer is looking at. */
  readonly focused: string | undefined;
  setFocused(threadId: string | undefined): void;
  /** A comment being written, and where. */
  readonly draft: Draft | undefined;
  setDraft(draft: Draft | undefined): void;
  readonly problem: string | undefined;
  setProblem(problem: string | undefined): void;
  /** Reads the threads again. */
  refresh(): Promise<void>;
  /** Where the page says the tracked anchors are. */
  onPositions(positions: readonly AnchorPosition[]): void;
  /** What is at a point of the frame. */
  hit(x: number, y: number): Promise<Draft | undefined>;
  /** Posts the draft's first comment. */
  post(text: string, mentions: readonly { key: string }[]): Promise<boolean>;
  /** Replies to a thread. */
  answer(threadId: string, text: string, mentions: readonly { key: string }[]): Promise<boolean>;
  setStatus(threadId: string, status: "open" | "resolved"): Promise<void>;
  /** Opens a thread in the panel and scrolls the page to its place. */
  open(threadId: string): void;
  /** Starts a comment on the whole page. */
  wholePage(): void;
}

/** Makes the overlay's controller for one view. */
export function useReview(options: ReviewOptions): Review {
  const [state, setState] = useState<ReviewState>({
    threads: [],
    people: [],
    writable: true,
    positions: new Map(),
  });
  const [mode, setMode] = useState(false);
  const [panel, setPanel] = useState(false);
  const [focused, setFocused] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const latest = useRef(options);
  // The newest options, written after each render commits, never during it.
  useLayoutEffect(() => {
    latest.current = options;
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!latest.current.enabled) return;
    try {
      const answer = await reviewThreads(latest.current.apiBase, latest.current.viewId);
      setState((current) => ({ ...current, ...answer }));
    } catch {
      // The panel keeps what it showed; the next event or action reads again.
    }
  }, []);
  useEffect(() => {
    if (options.enabled) void refresh();
  }, [refresh, options.viewId, options.enabled]);

  // The pins follow the page: the open threads' anchors are tracked by the page.
  const tracked = useMemo(
    () => state.threads.filter((thread) => thread.status === "open"),
    [state.threads],
  );
  const { agent, bridge } = options;
  useEffect(() => {
    if (!agent) return;
    bridge()?.notify(mostraReviewTrack, {
      anchors: tracked.map((thread) => ({ id: thread.id, anchor: thread.anchor })),
    });
  }, [tracked, agent, bridge]);

  const onPositions = useCallback((positions: readonly AnchorPosition[]) => {
    setState((current) => ({
      ...current,
      positions: new Map(positions.map((position) => [position.id, position])),
    }));
  }, []);

  /** What is at a point of the frame: the page's anchor, or the point alone (an older page). */
  const hit = useCallback(async (x: number, y: number): Promise<Draft | undefined> => {
    const bridge = latest.current.bridge();
    const point = { x, y };
    const fallback = (): Draft => ({
      anchor: {
        rect: { x: x - 12, y: y - 12, width: 24, height: 24 },
        point,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        label: REVIEW_WORDS.aPoint,
      },
      box: { x: x - 12, y: y - 12, width: 24, height: 24 },
    });
    if (!bridge || !latest.current.agent) return fallback();
    try {
      const answer = await bridge.call(mostraReviewHitTest, point, { timeoutMs: 2_000 });
      if (!answer.anchor || !answer.rect) return undefined;
      return { anchor: answer.anchor, box: answer.rect };
    } catch {
      return fallback();
    }
  }, []);

  const post = useCallback(
    async (text: string, mentions: readonly { key: string }[]): Promise<boolean> => {
      if (!draft) return false;
      const page = latest.current.page;
      try {
        await createThread(latest.current.apiBase, latest.current.csrf, {
          viewId: latest.current.viewId,
          threadId: ThreadId.create(),
          commentId: CommentId.create(),
          anchor:
            page !== undefined && draft.anchor.page === undefined
              ? { ...draft.anchor, page }
              : draft.anchor,
          text,
          ...(mentions.length > 0 ? { mentions } : {}),
        });
        setDraft(undefined);
        setMode(false);
        setProblem(undefined);
        await refresh();
        return true;
      } catch (error) {
        setProblem(reviewProblem(error));
        return false;
      }
    },
    [draft, refresh],
  );

  const answer = useCallback(
    async (
      threadId: string,
      text: string,
      mentions: readonly { key: string }[],
    ): Promise<boolean> => {
      try {
        await replyThread(latest.current.apiBase, latest.current.csrf, threadId, {
          viewId: latest.current.viewId,
          commentId: CommentId.create(),
          text,
          ...(mentions.length > 0 ? { mentions } : {}),
        });
        setProblem(undefined);
        await refresh();
        return true;
      } catch (error) {
        setProblem(reviewProblem(error));
        return false;
      }
    },
    [refresh],
  );

  const setStatus = useCallback(
    async (threadId: string, status: "open" | "resolved"): Promise<void> => {
      try {
        await setThreadStatus(latest.current.apiBase, latest.current.csrf, threadId, {
          viewId: latest.current.viewId,
          status,
        });
        setProblem(undefined);
        await refresh();
      } catch (error) {
        setProblem(reviewProblem(error));
      }
    },
    [refresh],
  );

  /** A comment on the whole page, which the keyboard reaches as well as the pointer. */
  const wholePage = useCallback((): void => {
    const page = latest.current.page;
    setDraft({
      anchor: {
        ...(page !== undefined ? { page } : {}),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        label: REVIEW_WORDS.thePage,
      },
    });
    setMode(false);
  }, []);

  const open = useCallback(
    (threadId: string) => {
      setPanel(true);
      setFocused(threadId);
      const thread = state.threads.find((entry) => entry.id === threadId);
      const bridge = latest.current.bridge();
      if (thread && bridge && latest.current.agent) {
        void bridge
          .call(mostraReviewScrollTo, { anchor: thread.anchor }, { timeoutMs: 2_000 })
          .catch(() => undefined);
      }
    },
    [state.threads],
  );

  return {
    state,
    mode,
    setMode,
    panel,
    setPanel,
    focused,
    setFocused,
    draft,
    setDraft,
    problem,
    setProblem,
    refresh,
    onPositions,
    hit,
    post,
    answer,
    setStatus,
    open,
    wholePage,
  };
}

/** What a refused review action means for the viewer. */
function reviewProblem(error: unknown): string {
  const code = error instanceof ShellError ? error.code : "NETWORK";
  if (code === "MOSTRA_SUBMIT_ALREADY") return REVIEW_WORDS.closed;
  if (code === "MOSTRA_REVIEW_MENTION_UNKNOWN") return REVIEW_WORDS.mentionUnknown;
  if (code.startsWith("MOSTRA_REVIEW_")) return REVIEW_WORDS.failed;
  return submitProblem(code);
}

/** Whether a thread belongs to the page the viewer is on (D57), or to every page. */
function onPage(thread: ReviewThread, page: string | undefined): boolean {
  return thread.anchor.page === undefined || page === undefined || thread.anchor.page === page;
}

/** The open threads' pin numbers: 1, 2, 3… in the order they were made. */
function numbers(threads: readonly ReviewThread[]): Map<string, number> {
  return new Map(
    threads
      .filter((thread) => thread.status === "open")
      .map((thread, index) => [thread.id, index + 1]),
  );
}

/**
 * The layer over the frame: the pins, and in comment mode the surface that takes the viewer's
 * point (the frame gets no pointer events meanwhile, so nothing of the page is clicked) and the
 * highlight of what is under it.
 */
export function ReviewLayer(props: {
  readonly review: Review;
  /** The page of a `pages/` artifact the viewer is on: only its comments get pins. */
  readonly page?: string | undefined;
}): ReactElement {
  const { review } = props;
  const [hover, setHover] = useState<Draft["box"] | undefined>();
  const asking = useRef(false);
  const pending = useRef<{ x: number; y: number } | undefined>(undefined);
  const pins = numbers(review.state.threads);
  // Escape leaves the comment mode, wherever the focus is.
  const { mode, setMode, setDraft } = review;
  useEffect(() => {
    if (!mode) return;
    const leave = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMode(false);
      setDraft(undefined);
    };
    document.addEventListener("keydown", leave);
    return () => document.removeEventListener("keydown", leave);
  }, [mode, setMode, setDraft]);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const look = async (at: { x: number; y: number }): Promise<void> => {
    if (asking.current) {
      pending.current = at;
      return;
    }
    asking.current = true;
    const found = await review.hit(at.x, at.y);
    setHover(found?.box);
    asking.current = false;
    const next = pending.current;
    pending.current = undefined;
    if (next) void look(next);
  };
  return (
    <div
      className="mostra-review-layer"
      data-mostra-review-layer={review.mode ? "commenting" : "pins"}
    >
      {review.mode && (
        <div
          className="mostra-review-surface"
          data-mostra-review-surface=""
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") void look(point(event));
          }}
          onPointerLeave={() => setHover(undefined)}
          onPointerUp={(event) => {
            const at = point(event);
            void review.hit(at.x, at.y).then((found) => {
              if (found) review.setDraft(found);
            });
          }}
        />
      )}
      {review.mode && hover && !review.draft && (
        <div
          className="mostra-review-hover"
          aria-hidden="true"
          style={{ left: hover.x, top: hover.y, width: hover.width, height: hover.height }}
        />
      )}
      {review.state.threads.map((thread) => {
        const number = pins.get(thread.id);
        const at = review.state.positions.get(thread.id)?.rect;
        if (number === undefined || !at || !onPage(thread, props.page)) return null;
        const first = thread.messages[0];
        return (
          <button
            key={thread.id}
            type="button"
            className="mostra-pin"
            data-mostra-pin={thread.id}
            data-focused={review.focused === thread.id ? "" : undefined}
            style={{ left: at.x + at.width, top: at.y }}
            aria-label={REVIEW_WORDS.pinLabel(number, first?.author.name, first?.text ?? "")}
            onClick={() => review.open(thread.id)}
          >
            {number}
          </button>
        );
      })}
      {review.draft?.box && (
        <span
          className="mostra-pin mostra-pin-draft"
          aria-hidden="true"
          style={{
            left: review.draft.box.x + review.draft.box.width,
            top: review.draft.box.y,
          }}
        />
      )}
    </div>
  );
}

/** A text box for a comment, with `@` mentions of the people the page may name (CO-06). */
function Composer(props: {
  readonly people: readonly ReviewPerson[];
  readonly placeholder: string;
  readonly submitWords: string;
  readonly autoFocus?: boolean;
  readonly onSubmit: (text: string, mentions: readonly { key: string }[]) => Promise<boolean>;
  readonly onCancel?: () => void;
}): ReactElement {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<ReviewPerson[]>([]);
  const listId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the caret is, kept as the viewer types, so the mention list reads no ref while rendering.
  const [caret, setCaret] = useState(0);
  const query = /(^|\s)@([^\s@]{0,32})$/.exec(text.slice(0, caret));
  const matches = query
    ? props.people
        .filter((person) =>
          (person.name ?? "").toLowerCase().includes((query[2] ?? "").toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const pick = (person: ReviewPerson): void => {
    const at = box.current?.selectionStart ?? text.length;
    const before = text
      .slice(0, at)
      .replace(/@[^\s@]*$/, `@${person.name ?? REVIEW_WORDS.someone} `);
    setText(before + text.slice(at));
    if (!chosen.some((entry) => entry.key === person.key)) setChosen([...chosen, person]);
    box.current?.focus();
  };
  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    // Only people still named in the text are mentioned.
    const mentions = chosen
      .filter((person) => trimmed.includes(`@${person.name ?? REVIEW_WORDS.someone}`))
      .map((person) => ({ key: person.key }));
    const done = await props.onSubmit(trimmed, mentions);
    setBusy(false);
    if (done) {
      setText("");
      setChosen([]);
    }
  };
  return (
    <form className="mostra-composer" onSubmit={(event) => void submit(event)}>
      <textarea
        ref={box}
        value={text}
        rows={2}
        maxLength={10_000}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        // biome-ignore lint/a11y/noAutofocus: the composer opens because the viewer asked for it.
        autoFocus={props.autoFocus}
        aria-controls={matches.length > 0 ? listId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          if (event.key === "Escape") props.onCancel?.();
        }}
      />
      {matches.length > 0 && (
        <ul className="mostra-mentions" id={listId} aria-label={REVIEW_WORDS.mention}>
          {matches.map((person) => (
            <li key={person.key}>
              <button
                type="button"
                className="mostra-link"
                data-mostra-mention={person.key}
                onClick={() => pick(person)}
              >
                {person.name ?? REVIEW_WORDS.someone}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mostra-actions">
        {props.onCancel && (
          <button type="button" className="mostra-button" onClick={props.onCancel}>
            {REVIEW_WORDS.cancel}
          </button>
        )}
        <button
          type="submit"
          className="mostra-button mostra-review-post"
          data-mostra-review-post=""
          disabled={busy || text.trim() === ""}
        >
          {props.submitWords}
        </button>
      </div>
    </form>
  );
}

/** A thread's crop, loaded once it is captured. */
function Crop(props: {
  readonly apiBase: string;
  readonly thread: ReviewThread;
}): ReactElement | null {
  const { thread } = props;
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (thread.crop.state !== "captured") return;
    let live = true;
    let made: string | undefined;
    void cropUrl(props.apiBase, thread.id)
      .then((value) => {
        made = value;
        if (live) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [props.apiBase, thread.id, thread.crop.state]);
  if (thread.crop.state === "pending") {
    return (
      <div className="mostra-crop mostra-crop-pending" data-mostra-crop="pending">
        {REVIEW_WORDS.capturing}
      </div>
    );
  }
  if (thread.crop.state === "failed") {
    return (
      <div className="mostra-crop mostra-crop-failed" data-mostra-crop="failed">
        {REVIEW_WORDS.cropFailed}
      </div>
    );
  }
  return url ? (
    <img
      className="mostra-crop"
      data-mostra-crop="captured"
      src={url}
      alt={REVIEW_WORDS.cropAlt(thread.anchor.label)}
      width={thread.crop.width}
      height={thread.crop.height}
    />
  ) : (
    <div className="mostra-crop mostra-crop-pending" data-mostra-crop="loading" />
  );
}

function author(person: ReviewPerson): string {
  return person.self ? REVIEW_WORDS.you : (person.name ?? REVIEW_WORDS.someone);
}

/** One thread in the panel: its place, its comments, the reply box, resolve and reopen. */
function ThreadCard(props: {
  readonly review: Review;
  readonly thread: ReviewThread;
  readonly number?: number | undefined;
  readonly apiBase: string;
  readonly candidateLabel?: string;
  readonly page?: string | undefined;
}): ReactElement {
  const { review, thread } = props;
  const [replying, setReplying] = useState(false);
  const where = [props.candidateLabel, thread.anchor.label].filter(Boolean).join(" · ");
  return (
    <article
      className="mostra-thread"
      data-mostra-thread={thread.id}
      data-mostra-thread-status={thread.status}
      data-focused={review.focused === thread.id ? "" : undefined}
    >
      <header className="mostra-thread-head">
        {props.number !== undefined ? (
          <button
            type="button"
            className="mostra-pin mostra-pin-static"
            onClick={() => review.open(thread.id)}
            aria-label={REVIEW_WORDS.show}
          >
            {props.number}
          </button>
        ) : (
          <span className="mostra-pin mostra-pin-static mostra-pin-resolved" aria-hidden="true" />
        )}
        <span className="mostra-thread-where">{where || REVIEW_WORDS.aPoint}</span>
        {thread.anchor.page !== undefined && thread.anchor.page !== props.page && (
          <span className="mostra-thread-page">{REVIEW_WORDS.otherPage(thread.anchor.page)}</span>
        )}
      </header>
      <Crop apiBase={props.apiBase} thread={thread} />
      <ol className="mostra-messages">
        {thread.messages.map((message) => (
          <li key={message.id} data-mostra-comment={message.id}>
            <div className="mostra-message-meta">
              <b>{author(message.author)}</b>
              {message.author.verified === false && !message.author.self && (
                <span className="mostra-unverified"> {REVIEW_WORDS.unverified}</span>
              )}
              <time dateTime={message.at}>
                {new Date(message.at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>
            <p className="mostra-message-text">{message.text}</p>
          </li>
        ))}
      </ol>
      {thread.status === "resolved" && thread.resolved && (
        <p className="mostra-thread-resolved">
          {REVIEW_WORDS.resolvedBy(author(thread.resolved.by))}
        </p>
      )}
      {review.state.writable && (
        <div className="mostra-thread-actions">
          {thread.status === "open" ? (
            <>
              {!replying && (
                <button
                  type="button"
                  className="mostra-link"
                  data-mostra-reply=""
                  onClick={() => setReplying(true)}
                >
                  {REVIEW_WORDS.reply}
                </button>
              )}
              <button
                type="button"
                className="mostra-link"
                data-mostra-resolve=""
                onClick={() => void review.setStatus(thread.id, "resolved")}
              >
                {REVIEW_WORDS.resolve}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mostra-link"
              data-mostra-reopen=""
              onClick={() => void review.setStatus(thread.id, "open")}
            >
              {REVIEW_WORDS.reopen}
            </button>
          )}
        </div>
      )}
      {replying && review.state.writable && (
        <Composer
          people={review.state.people}
          placeholder={REVIEW_WORDS.replyPlaceholder}
          submitWords={REVIEW_WORDS.reply}
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (text, mentions) => {
            const done = await review.answer(thread.id, text, mentions);
            if (done) setReplying(false);
            return done;
          }}
        />
      )}
    </article>
  );
}

/** The panel of threads: open first, numbered as their pins; resolved ones folded below. */
export function ReviewPanel(props: {
  readonly review: Review;
  readonly apiBase: string;
  readonly candidates: ReadonlyMap<string, string>;
  readonly page?: string | undefined;
}): ReactElement {
  const { review } = props;
  const [showResolved, setShowResolved] = useState(false);
  const titleId = useId();
  const pins = numbers(review.state.threads);
  const open = review.state.threads.filter((thread) => thread.status === "open");
  const resolved = review.state.threads.filter((thread) => thread.status === "resolved");
  const label = (thread: ReviewThread): string | undefined =>
    thread.anchor.candidateId !== undefined
      ? (props.candidates.get(`${thread.anchor.reviewSetId ?? ""}/${thread.anchor.candidateId}`) ??
        thread.anchor.candidateId)
      : undefined;
  return (
    <aside className="mostra-review-panel" aria-labelledby={titleId} data-mostra-review-panel="">
      <header className="mostra-review-panel-head">
        <h2 id={titleId}>{REVIEW_WORDS.title}</h2>
        <button
          type="button"
          className="mostra-icon"
          aria-label={REVIEW_WORDS.closePanel}
          title={REVIEW_WORDS.closePanel}
          onClick={() => review.setPanel(false)}
        >
          <CloseIcon />
        </button>
      </header>
      <p className="mostra-review-panel-intro">
        {review.state.writable ? REVIEW_WORDS.intro : REVIEW_WORDS.closed}
      </p>
      {review.problem !== undefined && (
        <p className="mostra-warn" role="alert" data-mostra-review-problem="">
          {review.problem}
        </p>
      )}
      {review.draft && (
        <div className="mostra-thread mostra-thread-new" data-mostra-review-new="">
          <header className="mostra-thread-head">
            <span className="mostra-pin mostra-pin-static mostra-pin-draft" aria-hidden="true" />
            <span className="mostra-thread-where">
              {review.draft.anchor.label ?? REVIEW_WORDS.aPoint}
            </span>
          </header>
          <Composer
            people={review.state.people}
            placeholder={REVIEW_WORDS.placeholder}
            submitWords={REVIEW_WORDS.post}
            autoFocus
            onCancel={() => review.setDraft(undefined)}
            onSubmit={(text, mentions) => review.post(text, mentions)}
          />
        </div>
      )}
      {open.length === 0 && resolved.length === 0 && !review.draft && (
        <p className="mostra-review-empty">{REVIEW_WORDS.empty}</p>
      )}
      {review.state.writable && !review.draft && (
        <button
          type="button"
          className="mostra-link mostra-review-whole"
          data-mostra-review-whole=""
          onClick={review.wholePage}
        >
          {REVIEW_WORDS.wholePage}
        </button>
      )}
      <div className="mostra-threads">
        {open.map((thread) => (
          <ThreadCard
            key={thread.id}
            review={review}
            thread={thread}
            number={pins.get(thread.id)}
            apiBase={props.apiBase}
            page={props.page}
            {...withLabel(label(thread))}
          />
        ))}
      </div>
      {resolved.length > 0 && (
        <section className="mostra-resolved">
          <button
            type="button"
            className="mostra-link"
            aria-expanded={showResolved}
            onClick={() => setShowResolved(!showResolved)}
          >
            {REVIEW_WORDS.resolvedCount(resolved.length)}
          </button>
          {showResolved &&
            resolved.map((thread) => (
              <ThreadCard
                key={thread.id}
                review={review}
                thread={thread}
                apiBase={props.apiBase}
                page={props.page}
                {...withLabel(label(thread))}
              />
            ))}
        </section>
      )}
    </aside>
  );
}

function withLabel(label: string | undefined): { candidateLabel?: string } {
  return label === undefined ? {} : { candidateLabel: label };
}

/** The bar's comment button: the count of open threads, and the comment mode. */
export function CommentButton(props: { readonly review: Review }): ReactElement {
  const { review } = props;
  const count = review.state.threads.filter((thread) => thread.status === "open").length;
  const on = review.mode || review.panel;
  const words = review.mode ? REVIEW_WORDS.pointHint : REVIEW_WORDS.comment;
  // On a phone only the icon and the count show: the name is the label, for every reader.
  const name = count > 0 ? `${words}, ${REVIEW_WORDS.countLabel(count)}` : words;
  return (
    <button
      type="button"
      className="mostra-pill mostra-comment-button"
      data-mostra-comment-button={review.mode ? "commenting" : on ? "open" : "closed"}
      aria-pressed={on}
      aria-label={name}
      title={name}
      onClick={() => {
        if (review.mode) {
          review.setMode(false);
          review.setDraft(undefined);
          return;
        }
        review.setPanel(true);
        if (review.state.writable) review.setMode(true);
      }}
    >
      <CommentIcon />
      <span className="mostra-button-text" aria-hidden="true">
        {words}
      </span>
      {count > 0 && (
        <span className="mostra-count" aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}
