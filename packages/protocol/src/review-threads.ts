/**
 * The review layer's threads as the shell's review routes, events, results and the `reviews` port
 * carry them (WP-20; D23, D47, RV-01 to RV-05, CO-06, HO-11). Anchors are `review.ts`'s, which
 * the bridge uses alone.
 */
import * as z from "zod";
import { CommentId, ThreadId, VersionId, ViewId } from "./ids.ts";
import { ViewerKind } from "./interaction.ts";
import { REVIEW_MENTIONS_MAX, REVIEW_TEXT_MAX, ReviewAnchor } from "./review.ts";
import { wireRegistry } from "./wire-registry.ts";

/**
 * A person as a page may know them (D168 item 2): their key on this artifact (`vk_…`) and display
 * name, never a `ref`, an email or a viewer ID; `self` for the page's own viewer.
 */
export interface ReviewPerson {
  /** Their key on this artifact (`vk_…`), the same a page sees in `useRespondents`. */
  readonly key: string;
  /** Their display name, when they have one. */
  readonly name?: string;
  /** Their kind of viewer. */
  readonly kind: ViewerKind;
  /** Whether a sign-in provider verified the name. */
  readonly verified?: boolean;
  /** Whether it is the page's own viewer. */
  readonly self: boolean;
}

/** The Zod schema of the `ReviewPerson` type. */
export const ReviewPerson: z.ZodType<ReviewPerson> = z
  .object({
    key: z.string().min(1).max(64),
    name: z.string().max(256).exactOptional(),
    kind: ViewerKind,
    verified: z.boolean().exactOptional(),
    self: z.boolean(),
  })
  .register(wireRegistry, {
    id: "ReviewPerson",
    description: "A person as a page may know them: their key on the artifact and display name.",
  });

/** Where a thread's crop stands: captured, being captured, or failed with why (RV-02). */
export type CropState = "pending" | "captured" | "failed";

/** The Zod schema of the `CropState` type. */
export const CropState: z.ZodType<CropState> = z.enum(["pending", "captured", "failed"]);

/** One comment of a thread, as a page sees it. */
export interface ReviewMessage {
  /** The comment's ID (`cmt_…`). */
  readonly id: string;
  /** When it was written. */
  readonly at: string;
  /** Who wrote it, as the page may know them. */
  readonly author: ReviewPerson;
  /** What they wrote, as text. */
  readonly text: string;
  /** The people it mentions (CO-06), as the page may know them. */
  readonly mentions?: readonly ReviewPerson[];
}

/** A comment thread as a page sees it (D47: replies, resolve and reopen, each message's author). */
export interface ReviewThread {
  /** The thread's ID (`thr_…`). */
  readonly id: string;
  /** The version and view it was made in. */
  readonly versionId: string;
  /** The number of the version it was made on. */
  readonly version: number;
  /** Open, or resolved. */
  readonly status: "open" | "resolved";
  /** Where it points, in every layer that applies. */
  readonly anchor: ReviewAnchor;
  /** When it was started. */
  readonly createdAt: string;
  /** Its comments, oldest first. */
  readonly messages: readonly ReviewMessage[];
  /** Who resolved it, and when, while resolved. */
  readonly resolved?: { readonly at: string; readonly by: ReviewPerson };
  /** Its crop: `pending` while the capture runs, `failed` with why. */
  readonly crop: {
    readonly state: CropState;
    readonly width?: number;
    readonly height?: number;
    readonly reason?: string;
  };
}

const Message = z.object({
  id: CommentId.schema,
  at: z.iso.datetime(),
  author: ReviewPerson,
  text: z.string().max(REVIEW_TEXT_MAX),
  mentions: z.array(ReviewPerson).max(REVIEW_MENTIONS_MAX).readonly().exactOptional(),
});

/** The Zod schema of the `ReviewThread` type. */
export const ReviewThread: z.ZodType<ReviewThread> = z
  .object({
    id: ThreadId.schema,
    versionId: VersionId.schema,
    version: z.int().min(1),
    status: z.enum(["open", "resolved"]),
    anchor: ReviewAnchor,
    createdAt: z.iso.datetime(),
    messages: z.array(Message).readonly(),
    resolved: z.object({ at: z.iso.datetime(), by: ReviewPerson }).exactOptional(),
    crop: z.object({
      state: CropState,
      width: z.int().min(1).exactOptional(),
      height: z.int().min(1).exactOptional(),
      reason: z.string().max(1024).exactOptional(),
    }),
  })
  .register(wireRegistry, {
    id: "ReviewThread",
    description: "A comment thread as a page sees it: anchor, messages, status and crop state.",
  });

/** `GET /a/{artifactId}/_mostra/v/{rev}/review/threads?view=…`: the threads a page may see. */
export interface ReviewThreads {
  /** The threads the page may see, oldest first. */
  readonly threads: readonly ReviewThread[];
  /** People this page may mention (CO-06). */
  readonly people: readonly ReviewPerson[];
  /** Whether this viewer may write: false once a `once` submission closed their draft. */
  readonly writable: boolean;
}

/** The Zod schema of the `ReviewThreads` type. */
export const ReviewThreads: z.ZodType<ReviewThreads> = z
  .object({
    threads: z.array(ReviewThread).readonly(),
    people: z.array(ReviewPerson).readonly(),
    writable: z.boolean(),
  })
  .register(wireRegistry, {
    id: "ReviewThreads",
    description: "The threads a page may see, the people it may mention, and whether it may write.",
  });

const Mentions = z
  .array(z.object({ key: z.string().min(1).max(64) }))
  .max(REVIEW_MENTIONS_MAX)
  .readonly();

/** `POST …/review/threads`: a new thread with its first comment, under a fresh client-made ID. */
export interface ReviewThreadRequest {
  /** The page's view. */
  readonly viewId: string;
  /** A fresh `thr_` ID; a retry repeats it and gets the same thread. */
  readonly threadId: string;
  /** The first comment's ID, made by the shell. */
  readonly commentId: string;
  /** Where the thread points. */
  readonly anchor: ReviewAnchor;
  /** The first comment's text. */
  readonly text: string;
  /** The people it mentions, by their keys. */
  readonly mentions?: readonly { readonly key: string }[];
}

/** The Zod schema of the `ReviewThreadRequest` type. */
export const ReviewThreadRequest: z.ZodType<ReviewThreadRequest> = z
  .object({
    viewId: ViewId.schema,
    threadId: ThreadId.schema,
    commentId: CommentId.schema,
    anchor: ReviewAnchor,
    text: z.string().min(1).max(REVIEW_TEXT_MAX),
    mentions: Mentions.exactOptional(),
  })
  .register(wireRegistry, {
    id: "ReviewThreadRequest",
    description: "A new comment thread: the view, client-made IDs, its anchor and first comment.",
  });

/** `POST …/review/threads/{threadId}/comments`: a reply. */
export interface ReviewReplyRequest {
  /** The page's view. */
  readonly viewId: string;
  /** The reply's ID, made by the shell. */
  readonly commentId: string;
  /** The reply's text. */
  readonly text: string;
  /** The people it mentions, by their keys. */
  readonly mentions?: readonly { readonly key: string }[];
}

/** The Zod schema of the `ReviewReplyRequest` type. */
export const ReviewReplyRequest: z.ZodType<ReviewReplyRequest> = z
  .object({
    viewId: ViewId.schema,
    commentId: CommentId.schema,
    text: z.string().min(1).max(REVIEW_TEXT_MAX),
    mentions: Mentions.exactOptional(),
  })
  .register(wireRegistry, {
    id: "ReviewReplyRequest",
    description: "A reply to a comment thread, under a client-made comment ID.",
  });

/** `POST …/review/threads/{threadId}/status`: resolve or reopen. */
export interface ReviewStatusRequest {
  /** The page's view. */
  readonly viewId: string;
  /** `resolved`, or `open` to reopen it. */
  readonly status: "open" | "resolved";
}

/** The Zod schema of the `ReviewStatusRequest` type. */
export const ReviewStatusRequest: z.ZodType<ReviewStatusRequest> = z
  .object({ viewId: ViewId.schema, status: z.enum(["open", "resolved"]) })
  .register(wireRegistry, {
    id: "ReviewStatusRequest",
    description: "Resolves or reopens a comment thread.",
  });
