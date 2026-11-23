/**
 * The review layer's ledger side (WP-20; D23, D47, RV-01 to RV-05, CO-06): comment threads, their
 * comments, who may see and write them, mentions, and the crop each thread keeps. Every change is
 * one transaction with its event; the crop is captured after the thread commits and set once.
 *
 * Who sees a thread (D182 item 1): hosts and agents every thread; a page the threads its viewer
 * started, wrote in or is mentioned in, and every thread when its viewer is the artifact's owner
 * or the artifact's `team.visibility` is `names` (D168 item 8). People appear to a page by their
 * key on the artifact and display name, never a viewer ID or `ref` (D168 item 2).
 */
import {
  type Actor,
  type AnchorRect,
  type AnchorSelector,
  type CapabilityScope,
  CommentId,
  type CropState,
  createDiagnostic,
  type KnownDiagnosticCode,
  type ResultComment,
  type ReviewAnchor,
  type ReviewEnvelope,
  type ReviewPerson,
  type ReviewThread,
  RpcError,
  scopeAllows,
  ThreadId,
  type Viewer,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";
import { code, quoted } from "./results.ts";
import { peerKey, teamVisibility } from "./roster.ts";
import { assertDraftOpen } from "./submissions.ts";
import { viewer, viewFor } from "./viewers.ts";

/** The most threads one viewer keeps on one artifact. */
export const THREADS_PER_VIEWER_MAX = 1_000;
/** The most comments one thread holds. */
export const COMMENTS_PER_THREAD_MAX = 500;
/** An anchor's JSON at most (the provider's 16 KiB and the other layers). */
export const ANCHOR_JSON_MAX: number = 32 * 1024;

/** A `thread` row. */
export interface ThreadRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly version_id: string;
  readonly view_id: string;
  readonly viewer_id: string;
  readonly anchor_json: string;
  readonly review_set_id: string | null;
  readonly candidate_id: string | null;
  readonly page: string | null;
  readonly status: "open" | "resolved";
  readonly status_at: string | null;
  readonly status_by: string | null;
  readonly created_at: string;
  readonly crop_state: "pending" | "captured" | "failed";
  readonly crop_blob: string | null;
  readonly crop_width: number | null;
  readonly crop_height: number | null;
  readonly crop_source: string | null;
  readonly crop_error: string | null;
  readonly crop_at: string | null;
}

/** A `comment` row. */
export interface CommentRow {
  readonly id: string;
  readonly thread_id: string;
  readonly author_viewer_id: string;
  readonly text: string;
  readonly mentions_json: string | null;
  readonly at: string;
}

/** Who acts: the page's artifact and viewer, and the link it came through. */
export interface ReviewPage {
  readonly artifactId: string;
  readonly viewerId: string;
  readonly tokenId?: string;
  /** Whether the viewer is the artifact's owner, who sees every thread (CO-07). */
  readonly owner: boolean;
}

function refused(code: KnownDiagnosticCode, message: string): RpcError {
  return new RpcError(createDiagnostic(code, { message }));
}

function threadRow(db: LedgerDb, artifactId: string, threadId: string): ThreadRow {
  const row = ThreadId.is(threadId)
    ? db.get<ThreadRow>(
        "SELECT * FROM thread WHERE id = ? AND artifact_id = ?",
        threadId,
        artifactId,
      )
    : undefined;
  if (!row)
    throw refused(
      "MOSTRA_REVIEW_THREAD_NOT_FOUND",
      `This artifact has no thread ${String(threadId).slice(0, 64)}.`,
    );
  return row;
}

/** Every viewer a comment of the thread mentions, and every author. */
function participants(
  db: LedgerDb,
  threadId: string,
): { authors: Set<string>; mentioned: Set<string> } {
  const authors = new Set<string>();
  const mentioned = new Set<string>();
  for (const row of db.all<CommentRow>("SELECT * FROM comment WHERE thread_id = ?", threadId)) {
    authors.add(row.author_viewer_id);
    for (const id of mentionsOf(row)) mentioned.add(id);
  }
  return { authors, mentioned };
}

function mentionsOf(row: CommentRow): string[] {
  if (row.mentions_json === null) return [];
  return (JSON.parse(row.mentions_json) as { viewerId: string }[]).map((entry) => entry.viewerId);
}

/** Whether a page may see a thread. */
function visible(db: LedgerDb, page: ReviewPage, row: ThreadRow, everyone: boolean): boolean {
  if (everyone || row.viewer_id === page.viewerId) return true;
  const { authors, mentioned } = participants(db, row.id);
  return authors.has(page.viewerId) || mentioned.has(page.viewerId);
}

/** Whether a page sees every thread of its artifact: its owner, or under `names`. */
function seesEveryone(db: LedgerDb, page: ReviewPage): boolean {
  return page.owner || teamVisibility(db, page.artifactId) === "names";
}

/** A viewer as a page sees them. */
export function personFor(
  db: LedgerDb,
  artifactId: string,
  viewerId: string,
  self: string,
): ReviewPerson {
  const record = viewer(db, viewerId);
  return {
    key: peerKey(artifactId, viewerId),
    ...(record.name !== undefined ? { name: record.name } : {}),
    kind: record.kind,
    ...(record.verified !== undefined ? { verified: record.verified } : {}),
    self: viewerId === self,
  };
}

/**
 * The people a page may mention (CO-06): the artifact's expected respondents where the page may
 * see them by name, the authors of the threads it sees, and for the owner, everyone who opened the
 * artifact; never itself.
 */
export function mentionable(db: LedgerDb, page: ReviewPage): Map<string, string> {
  const people = new Map<string, string>();
  const add = (viewerId: string): void => {
    if (viewerId !== page.viewerId) people.set(peerKey(page.artifactId, viewerId), viewerId);
  };
  if (seesEveryone(db, page)) {
    for (const row of db.all<{ viewer_id: string }>(
      "SELECT viewer_id FROM roster_entry WHERE artifact_id = ? ORDER BY position",
      page.artifactId,
    )) {
      add(row.viewer_id);
    }
  }
  // The owner sees everyone (CO-07): every person who opened the artifact may be mentioned.
  if (page.owner) {
    for (const row of db.all<{ viewer_id: string }>(
      "SELECT DISTINCT viewer_id FROM view WHERE artifact_id = ?",
      page.artifactId,
    )) {
      add(row.viewer_id);
    }
  }
  for (const thread of threadsVisible(db, page)) {
    add(thread.viewer_id);
    for (const author of participants(db, thread.id).authors) add(author);
  }
  return people;
}

function threadsVisible(db: LedgerDb, page: ReviewPage): ThreadRow[] {
  const everyone = seesEveryone(db, page);
  return db
    .all<ThreadRow>(
      "SELECT * FROM thread WHERE artifact_id = ? ORDER BY created_at, id",
      page.artifactId,
    )
    .filter((row) => visible(db, page, row, everyone));
}

/** A thread as a page sees it. */
export function threadForPage(db: LedgerDb, page: ReviewPage, row: ThreadRow): ReviewThread {
  const person = (id: string): ReviewPerson => personFor(db, page.artifactId, id, page.viewerId);
  const version = db.get<{ number: number }>(
    "SELECT number FROM version WHERE id = ?",
    row.version_id,
  );
  return {
    id: row.id,
    versionId: row.version_id,
    version: version?.number ?? 1,
    status: row.status,
    anchor: JSON.parse(row.anchor_json) as ReviewAnchor,
    createdAt: row.created_at,
    messages: db
      .all<CommentRow>("SELECT * FROM comment WHERE thread_id = ? ORDER BY at, id", row.id)
      .map((comment) => {
        const mentions = mentionsOf(comment);
        return {
          id: comment.id,
          at: comment.at,
          author: person(comment.author_viewer_id),
          text: comment.text,
          ...(mentions.length > 0 ? { mentions: mentions.map(person) } : {}),
        };
      }),
    ...(row.status === "resolved" && row.status_at !== null && row.status_by !== null
      ? { resolved: { at: row.status_at, by: person(row.status_by) } }
      : {}),
    crop: {
      state: row.crop_state,
      ...(row.crop_width !== null ? { width: row.crop_width } : {}),
      ...(row.crop_height !== null ? { height: row.crop_height } : {}),
      ...(row.crop_error !== null ? { reason: row.crop_error } : {}),
    },
  };
}

/** The threads a page sees, oldest first. */
export function threadsForPage(db: LedgerDb, page: ReviewPage): ReviewThread[] {
  return threadsVisible(db, page).map((row) => threadForPage(db, page, row));
}

/** Resolves mention keys to viewers the page may mention; refuses an unknown key. */
function resolveMentions(
  db: LedgerDb,
  page: ReviewPage,
  mentions: readonly { readonly key: string }[] | undefined,
): { viewerId: string; key: string }[] {
  if (!mentions || mentions.length === 0) return [];
  const people = mentionable(db, page);
  const out: { viewerId: string; key: string }[] = [];
  for (const { key } of mentions) {
    const viewerId = people.get(key);
    if (viewerId === undefined) {
      throw refused(
        "MOSTRA_REVIEW_MENTION_UNKNOWN",
        `This page can't mention ${key.slice(0, 64)}: it isn't someone the page knows.`,
      );
    }
    if (!out.some((entry) => entry.viewerId === viewerId)) out.push({ viewerId, key });
  }
  return out;
}

/** The event naming one mentioned viewer (CO-06), for hosts only: one per viewer per comment. */
function mentionEvents(
  db: LedgerDb,
  artifactId: string,
  threadId: string,
  commentId: string,
  by: string,
  mentioned: readonly { viewerId: string; key: string }[],
): void {
  for (const entry of mentioned) {
    const record = viewer(db, entry.viewerId);
    const author = viewer(db, by);
    appendEvent(db, {
      artifactId,
      type: "review.mentioned",
      actor: actorOf(author),
      payload: {
        threadId,
        commentId,
        mentioned: {
          viewerId: entry.viewerId,
          key: entry.key,
          kind: record.kind,
          ...(record.name !== undefined ? { name: record.name } : {}),
          ...(record.ref !== undefined ? { ref: record.ref } : {}),
        },
        by: { viewerId: by, ...(author.name !== undefined ? { name: author.name } : {}) },
      },
    });
  }
}

function actorOf(record: Viewer): Actor {
  return {
    kind: "viewer",
    id: record.id,
    ...(record.name !== undefined ? { name: record.name } : {}),
  };
}

/** The layers of an anchor an event names: enough to route on, never its quoted text. */
function anchorSummary(anchor: ReviewAnchor): Record<string, unknown> {
  return {
    ...(anchor.reviewId !== undefined ? { reviewId: anchor.reviewId } : {}),
    ...(anchor.page !== undefined ? { page: anchor.page } : {}),
    ...(anchor.reviewSetId !== undefined ? { reviewSetId: anchor.reviewSetId } : {}),
    ...(anchor.candidateId !== undefined ? { candidateId: anchor.candidateId } : {}),
    ...(anchor.provider !== undefined ? { provider: anchor.provider.kind } : {}),
  };
}

/** Creates a thread with its first comment; a retry with the same IDs answers the same thread. */
export function createThread(
  db: LedgerDb,
  page: ReviewPage,
  input: {
    readonly viewId: string;
    readonly threadId: string;
    readonly commentId: string;
    readonly anchor: ReviewAnchor;
    readonly text: string;
    readonly mentions?: readonly { readonly key: string }[];
  },
): { readonly row: ThreadRow; readonly created: boolean } {
  const existing = db.get<ThreadRow>("SELECT * FROM thread WHERE id = ?", input.threadId);
  if (existing) {
    const first = db.get<CommentRow>(
      "SELECT * FROM comment WHERE thread_id = ? ORDER BY at, id LIMIT 1",
      existing.id,
    );
    if (
      existing.viewer_id === page.viewerId &&
      first?.id === input.commentId &&
      first.text === input.text
    ) {
      return { row: existing, created: false };
    }
    throw refused(
      "MOSTRA_REVIEW_ID_REUSED",
      `The thread ID ${input.threadId} was used for another comment.`,
    );
  }
  const view = viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
  assertDraftOpen(db, page.artifactId, page.viewerId);
  const anchorJson = JSON.stringify(input.anchor);
  if (anchorJson.length > ANCHOR_JSON_MAX) {
    throw refused(
      "MOSTRA_REVIEW_ANCHOR_TOO_LARGE",
      `This anchor is ${anchorJson.length} characters; an anchor holds at most ${ANCHOR_JSON_MAX}.`,
    );
  }
  const count =
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM thread WHERE artifact_id = ? AND viewer_id = ?",
      page.artifactId,
      page.viewerId,
    )?.n ?? 0;
  if (count >= THREADS_PER_VIEWER_MAX) {
    throw refused(
      "MOSTRA_REVIEW_TOO_MANY",
      `This viewer has ${count} threads on this artifact, the most one keeps.`,
    );
  }
  if (!CommentId.is(input.commentId))
    throw refused("MOSTRA_HOST_INVALID_PARAMS", "The comment ID isn't a cmt_ ID.");
  const mentioned = resolveMentions(db, page, input.mentions);
  const at = new Date().toISOString();
  db.run(
    "INSERT INTO thread (id, artifact_id, version_id, view_id, viewer_id, anchor_json, review_set_id, candidate_id, page, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
    input.threadId,
    page.artifactId,
    view.version_id,
    view.id,
    page.viewerId,
    anchorJson,
    input.anchor.reviewSetId ?? null,
    input.anchor.candidateId ?? null,
    input.anchor.page ?? null,
    at,
  );
  db.run(
    "INSERT INTO comment (id, thread_id, author_viewer_id, text, mentions_json, at) VALUES (?, ?, ?, ?, ?, ?)",
    input.commentId,
    input.threadId,
    page.viewerId,
    input.text,
    mentioned.length > 0 ? JSON.stringify(mentioned) : null,
    at,
  );
  const author = viewer(db, page.viewerId);
  appendEvent(db, {
    artifactId: page.artifactId,
    type: "review.thread.created",
    actor: actorOf(author),
    payload: {
      threadId: input.threadId,
      commentId: input.commentId,
      versionId: view.version_id,
      viewId: view.id,
      viewerId: page.viewerId,
      anchor: anchorSummary(input.anchor),
    },
  });
  mentionEvents(db, page.artifactId, input.threadId, input.commentId, page.viewerId, mentioned);
  return { row: threadRow(db, page.artifactId, input.threadId), created: true };
}

/** Adds a reply; a retry with the same comment ID answers the same comment. */
export function reply(
  db: LedgerDb,
  page: ReviewPage,
  threadId: string,
  input: {
    readonly viewId: string;
    readonly commentId: string;
    readonly text: string;
    readonly mentions?: readonly { readonly key: string }[];
  },
): { readonly row: ThreadRow; readonly created: boolean } {
  const row = threadRow(db, page.artifactId, threadId);
  if (!visible(db, page, row, seesEveryone(db, page))) {
    throw refused(
      "MOSTRA_REVIEW_THREAD_NOT_FOUND",
      `This artifact has no thread ${threadId} this page may see.`,
    );
  }
  const existing = db.get<CommentRow>("SELECT * FROM comment WHERE id = ?", input.commentId);
  if (existing) {
    if (
      existing.thread_id === threadId &&
      existing.author_viewer_id === page.viewerId &&
      existing.text === input.text
    ) {
      return { row, created: false };
    }
    throw refused(
      "MOSTRA_REVIEW_ID_REUSED",
      `The comment ID ${input.commentId} was used for another comment.`,
    );
  }
  viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
  assertDraftOpen(db, page.artifactId, page.viewerId);
  const count =
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM comment WHERE thread_id = ?", threadId)?.n ??
    0;
  if (count >= COMMENTS_PER_THREAD_MAX) {
    throw refused(
      "MOSTRA_REVIEW_TOO_MANY",
      `This thread has ${count} comments, the most one holds.`,
    );
  }
  const mentioned = resolveMentions(db, page, input.mentions);
  const at = new Date().toISOString();
  db.run(
    "INSERT INTO comment (id, thread_id, author_viewer_id, text, mentions_json, at) VALUES (?, ?, ?, ?, ?, ?)",
    input.commentId,
    threadId,
    page.viewerId,
    input.text,
    mentioned.length > 0 ? JSON.stringify(mentioned) : null,
    at,
  );
  appendEvent(db, {
    artifactId: page.artifactId,
    type: "review.comment.added",
    actor: actorOf(viewer(db, page.viewerId)),
    payload: { threadId, commentId: input.commentId, viewerId: page.viewerId },
  });
  mentionEvents(db, page.artifactId, threadId, input.commentId, page.viewerId, mentioned);
  return { row: threadRow(db, page.artifactId, threadId), created: true };
}

/** Resolves or reopens a thread; the same status again changes nothing. */
export function setStatus(
  db: LedgerDb,
  page: ReviewPage,
  threadId: string,
  input: { readonly viewId: string; readonly status: "open" | "resolved" },
): { readonly row: ThreadRow; readonly changed: boolean } {
  const row = threadRow(db, page.artifactId, threadId);
  if (!visible(db, page, row, seesEveryone(db, page))) {
    throw refused(
      "MOSTRA_REVIEW_THREAD_NOT_FOUND",
      `This artifact has no thread ${threadId} this page may see.`,
    );
  }
  if (row.status === input.status) return { row, changed: false };
  viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
  assertDraftOpen(db, page.artifactId, page.viewerId);
  const at = new Date().toISOString();
  db.run(
    "UPDATE thread SET status = ?, status_at = ?, status_by = ? WHERE id = ?",
    input.status,
    at,
    page.viewerId,
    threadId,
  );
  appendEvent(db, {
    artifactId: page.artifactId,
    type: input.status === "resolved" ? "review.thread.resolved" : "review.thread.reopened",
    actor: actorOf(viewer(db, page.viewerId)),
    payload: { threadId, viewerId: page.viewerId },
  });
  return { row: threadRow(db, page.artifactId, threadId), changed: true };
}

/** A captured crop, or why the capture failed. */
export type CropOutcome =
  | {
      readonly kind: "captured";
      readonly blob: string;
      readonly width: number;
      readonly height: number;
      readonly source: string;
    }
  | { readonly kind: "failed"; readonly reason: string };

/** Records a thread's crop, once: a crop already set stays as it is (`false`). */
export function setCrop(db: LedgerDb, threadId: string, outcome: CropOutcome): boolean {
  const row = db.get<ThreadRow>("SELECT * FROM thread WHERE id = ?", threadId);
  if (row?.crop_state !== "pending") return false;
  const at = new Date().toISOString();
  if (outcome.kind === "captured") {
    db.run(
      "UPDATE thread SET crop_state = 'captured', crop_blob = ?, crop_width = ?, crop_height = ?, crop_source = ?, crop_at = ? WHERE id = ?",
      outcome.blob,
      outcome.width,
      outcome.height,
      outcome.source,
      at,
      threadId,
    );
  } else {
    db.run(
      "UPDATE thread SET crop_state = 'failed', crop_error = ?, crop_at = ? WHERE id = ?",
      outcome.reason.slice(0, 1024),
      at,
      threadId,
    );
  }
  appendEvent(db, {
    artifactId: row.artifact_id,
    type: "review.crop.captured",
    actor: { kind: "mostra" },
    payload: {
      threadId,
      state: outcome.kind,
      ...(outcome.kind === "captured"
        ? { width: outcome.width, height: outcome.height }
        : { reason: outcome.reason.slice(0, 1024) }),
    },
  });
  return true;
}

/** The threads whose crops are still pending, oldest first. */
export function pendingCrops(db: LedgerDb, limit = 100): ThreadRow[] {
  return db.all<ThreadRow>(
    "SELECT * FROM thread WHERE crop_state = 'pending' ORDER BY created_at LIMIT ?",
    limit,
  );
}

/** A thread as a submission's snapshot keeps it (D10: comments are part of the draft). */
export interface SnapshotThread {
  readonly threadId: string;
  readonly versionId: string;
  readonly status: "open" | "resolved";
  readonly anchor: ReviewAnchor;
  readonly createdAt: string;
  readonly messages: readonly {
    readonly id: string;
    readonly author: Viewer;
    readonly at: string;
    readonly text: string;
    readonly mentions?: readonly Viewer[];
  }[];
  readonly crop:
    | {
        readonly state: "captured";
        readonly blob: string;
        readonly width: number;
        readonly height: number;
        readonly source: string;
      }
    | { readonly state: "pending" }
    | { readonly state: "failed"; readonly reason: string };
}

/**
 * The threads a viewer's submission carries (D182 item 2): every thread they started or wrote in on
 * the artifact, as it stands, with every message and its crop.
 */
export function snapshotThreads(
  db: LedgerDb,
  artifactId: string,
  viewerId: string,
): SnapshotThread[] {
  const rows = db.all<ThreadRow>(
    `SELECT * FROM thread WHERE artifact_id = ? AND (viewer_id = ? OR id IN
       (SELECT thread_id FROM comment WHERE author_viewer_id = ?)) ORDER BY created_at, id`,
    artifactId,
    viewerId,
    viewerId,
  );
  return rows.map((row) => snapshotThread(db, row));
}

/** One thread as it stands now, as a snapshot keeps it. */
export function snapshotThread(db: LedgerDb, row: ThreadRow): SnapshotThread {
  return {
    threadId: row.id,
    versionId: row.version_id,
    status: row.status,
    anchor: JSON.parse(row.anchor_json) as ReviewAnchor,
    createdAt: row.created_at,
    messages: db
      .all<CommentRow>("SELECT * FROM comment WHERE thread_id = ? ORDER BY at, id", row.id)
      .map((comment) => {
        const mentions = mentionsOf(comment).map((id) => viewer(db, id));
        return {
          id: comment.id,
          author: viewer(db, comment.author_viewer_id),
          at: comment.at,
          text: comment.text,
          ...(mentions.length > 0 ? { mentions } : {}),
        };
      }),
    crop:
      row.crop_state === "captured" && row.crop_blob !== null
        ? {
            state: "captured" as const,
            blob: row.crop_blob,
            width: row.crop_width ?? 0,
            height: row.crop_height ?? 0,
            source: row.crop_source ?? "capture",
          }
        : row.crop_state === "failed"
          ? { state: "failed" as const, reason: row.crop_error ?? "" }
          : { state: "pending" as const },
  };
}

/** A thread row by ID, of any artifact; `undefined` when there is none. */
export function threadById(db: LedgerDb, threadId: string): ThreadRow | undefined {
  return db.get<ThreadRow>("SELECT * FROM thread WHERE id = ?", threadId);
}

/** Whether a page may see a thread (for its events and its crop). */
export function threadVisible(db: LedgerDb, page: ReviewPage, threadId: string): boolean {
  const row = threadById(db, threadId);
  return (
    row !== undefined &&
    row.artifact_id === page.artifactId &&
    visible(db, page, row, seesEveryone(db, page))
  );
}

/** A thread for the `reviews` port's mirror (HO-11). */
export function threadEnvelope(db: LedgerDb, threadId: string): ReviewEnvelope | undefined {
  const row = threadById(db, threadId);
  if (!row) return undefined;
  return {
    kind: "thread",
    artifactId: row.artifact_id,
    viewerId: row.viewer_id,
    thread: resultComment(snapshotThread(db, row), relativeCrop),
  };
}

/** Every thread of an artifact, as results carry them, oldest first (`review export`). */
export function artifactComments(
  db: LedgerDb,
  artifactId: string,
  crops: CropPaths,
): ResultComment[] {
  return db
    .all<ThreadRow>(
      "SELECT * FROM thread WHERE artifact_id = ? ORDER BY created_at, id",
      artifactId,
    )
    .map((row) => resultComment(snapshotThread(db, row), crops));
}

/** The crop's rectangle in the page: the anchor's box with a margin, inside the document. */
export function cropRect(anchor: ReviewAnchor): AnchorRect | undefined {
  const rect = anchor.rect;
  if (!rect) return undefined;
  const margin = 24;
  const width = Math.min(Math.max(rect.width + margin * 2, 240), 1280);
  const height = Math.min(Math.max(rect.height + margin * 2, 140), 900);
  const x = Math.max(0, rect.x + rect.width / 2 - width / 2);
  const y = Math.max(0, rect.y + rect.height / 2 - height / 2);
  return { x, y, width, height };
}

/** New IDs, for hosts and tests. */
export const newThreadIds = (): { threadId: string; commentId: string } => ({
  threadId: ThreadId.create(),
  commentId: CommentId.create(),
});

/** Where a crop's file is for a reader: relative to the home by default (`blobs/<sha256>.png`). */
export type CropPaths = (sha256: string) => string;

/** A crop's path relative to the home. */
export const relativeCrop: CropPaths = (sha256) => `blobs/${sha256}.png`;

/** A thread of a snapshot as results carry it (INTERFACES §8). */
export function resultComment(
  thread: SnapshotThread,
  crops: CropPaths,
  submissionVersionId?: string,
): ResultComment {
  const { anchor } = thread;
  const pick = <K extends keyof ReviewAnchor>(key: K) =>
    anchor[key] !== undefined ? { [key]: anchor[key] } : {};
  return {
    threadId: thread.threadId,
    status: thread.status,
    messages: thread.messages.map((message) => ({
      author: message.author,
      at: message.at,
      text: message.text,
      id: message.id,
      ...(message.mentions !== undefined ? { mentions: message.mentions } : {}),
    })),
    anchor: {
      ...pick("reviewId"),
      ...pick("selectors"),
      ...pick("rect"),
      ...pick("viewport"),
      ...pick("page"),
      ...pick("candidateId"),
      ...pick("time"),
      ...pick("slide"),
      ...pick("reviewSetId"),
      ...pick("point"),
      ...pick("scroll"),
      ...pick("provider"),
      ...pick("frames"),
      ...pick("label"),
    },
    crop:
      thread.crop.state === "captured"
        ? {
            path: crops(thread.crop.blob),
            width: thread.crop.width,
            height: thread.crop.height,
            state: "captured",
          }
        : thread.crop.state === "failed"
          ? { path: "", width: 0, height: 0, state: "failed", reason: thread.crop.reason }
          : { path: "", width: 0, height: 0, state: "pending" },
    ...(submissionVersionId !== undefined && thread.versionId !== submissionVersionId
      ? { versionId: thread.versionId }
      : {}),
  };
}

/** How a person is named in Markdown: their display name, else their reference or ID. */
function personName(viewer: Viewer): string {
  return viewer.name ?? viewer.ref ?? viewer.id;
}

/** Where an anchor points, as one Markdown line's parts: every layer the comment has. */
function whereParts(anchor: ResultComment["anchor"]): string[] {
  const parts: string[] = [];
  if (anchor.label !== undefined) parts.push(quoted(anchor.label));
  if (anchor.reviewId !== undefined) parts.push(`review ID ${code(anchor.reviewId)}`);
  if (anchor.provider !== undefined) {
    parts.push(
      `${code(anchor.provider.kind)} ${code(JSON.stringify(anchor.provider.data))}${anchor.provider.label !== undefined ? ` (${quoted(anchor.provider.label)})` : ""}`,
    );
  }
  for (const selector of (anchor.selectors ?? []) as AnchorSelector[]) {
    if (selector.type === "CssSelector") parts.push(`CSS ${code(selector.value)}`);
    else if (selector.type === "TextQuoteSelector") parts.push(`text ${quoted(selector.exact)}`);
    else parts.push(`fragment ${code(selector.value)}`);
  }
  if (anchor.rect !== undefined) {
    const { x, y, width, height } = anchor.rect;
    const viewport = anchor.viewport;
    parts.push(
      `at ${Math.round(x)},${Math.round(y)} ${Math.round(width)}×${Math.round(height)} px${viewport ? ` in a ${viewport.width}×${viewport.height} viewport at DPR ${viewport.dpr}` : ""}`,
    );
  }
  if (anchor.frames !== undefined && anchor.frames.length > 0) {
    parts.push(
      `inside ${anchor.frames.map((frame) => `${frame.served ? "served" : "opaque"} frame ${code(frame.selector)}`).join(", then ")}`,
    );
  }
  if (anchor.page !== undefined) parts.push(`page ${code(anchor.page)}`);
  if (anchor.reviewSetId !== undefined) {
    parts.push(
      `review set ${code(anchor.reviewSetId)}${anchor.candidateId !== undefined ? `, candidate ${code(anchor.candidateId)}` : ""}`,
    );
  }
  if (anchor.slide !== undefined) {
    parts.push(`slide ${anchor.slide.index + 1}, step ${anchor.slide.step}`);
  }
  if (anchor.time !== undefined) parts.push(`at ${anchor.time} s`);
  return parts;
}

/**
 * One comment thread in Markdown for agents (results and `review export`): its status, where it
 * points (every layer), its crop's path, and each message by its author. Viewers' text is data.
 */
export function commentMarkdown(comment: ResultComment): string[] {
  const crop =
    comment.crop.state === "pending"
      ? "crop pending"
      : comment.crop.state === "failed"
        ? `no crop (${quoted(comment.crop.reason ?? "the capture failed")})`
        : `crop ${code(comment.crop.path)} (${comment.crop.width}×${comment.crop.height})`;
  const where = whereParts(comment.anchor);
  return [
    `- Thread ${comment.threadId} (${comment.status})${comment.versionId !== undefined ? ` on version ${comment.versionId}` : ""}, ${crop}`,
    ...(where.length > 0 ? [`  - Where: ${where.join("; ")}`] : []),
    ...comment.messages.map(
      (message) =>
        `  - ${quoted(personName(message.author))} at ${message.at}: ${quoted(message.text)}${message.mentions !== undefined && message.mentions.length > 0 ? ` (mentions ${message.mentions.map((person) => quoted(personName(person))).join(", ")})` : ""}`,
    ),
  ];
}

/** A thread whose crop is to be captured: its view and anchor (the capture port's request). */
export interface CropJob {
  readonly threadId: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly viewId: string;
  readonly viewerId: string;
  readonly anchor: ReviewAnchor;
  readonly crop: CropState;
}

/** What happened to a thread. */
export type ThreadChange = "created" | "replied" | "resolved" | "reopened" | "cropped";

/** A thread row as a crop job. */
export function cropJob(row: ThreadRow): CropJob {
  return {
    threadId: row.id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    viewId: row.view_id,
    viewerId: row.viewer_id,
    anchor: JSON.parse(row.anchor_json) as ReviewAnchor,
    crop: row.crop_state,
  };
}

/** The pending crops of the threads a viewer's submission would carry. */
export function pendingCropsOf(db: LedgerDb, artifactId: string, viewerId: string): string[] {
  return db
    .all<{ id: string }>(
      "SELECT id FROM thread WHERE artifact_id = ? AND crop_state = 'pending' AND (viewer_id = ? OR id IN (SELECT thread_id FROM comment WHERE author_viewer_id = ?))",
      artifactId,
      viewerId,
      viewerId,
    )
    .map((row) => row.id);
}

/** Whether a page may write review threads: a link with `review`, on a draft still open. */
export function reviewWritable(
  db: LedgerDb,
  page: ReviewPage & { readonly scopes?: readonly CapabilityScope[] },
): boolean {
  if (page.scopes !== undefined && !scopeAllows(page.scopes, "review")) return false;
  try {
    assertDraftOpen(db, page.artifactId, page.viewerId);
    return true;
  } catch {
    return false;
  }
}
