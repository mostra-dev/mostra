/**
 * Diagnostic codes of the REVIEW area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the REVIEW area, in the order they were added. */
export const reviewDiagnosticCodes = [
  "MOSTRA_REVIEW_THREAD_NOT_FOUND",
  "MOSTRA_REVIEW_MENTION_UNKNOWN",
  "MOSTRA_REVIEW_ID_REUSED",
  "MOSTRA_REVIEW_ANCHOR_TOO_LARGE",
  "MOSTRA_REVIEW_TOO_MANY",
  "MOSTRA_REVIEW_CROP_MISSING",
  "MOSTRA_REVIEW_ANCHOR_LOST",
  // gen:codes
] as const;

/** The codes of the REVIEW area. */
export type ReviewDiagnosticCode = (typeof reviewDiagnosticCodes)[number];

/** The REVIEW area's catalog entries. */
export const reviewDiagnostics: AreaCatalog<ReviewDiagnosticCode> = {
  MOSTRA_REVIEW_THREAD_NOT_FOUND: {
    severity: "error",
    phase: "host",
    title: "No such comment thread",
    hint: "Read the threads again (`mostra review export`) and name one of them.",
    docs: {
      explanation:
        "A review action named a comment thread this artifact doesn't have, or one the page's viewer may not see.",
      fix: "Use a thread ID from the artifact's threads.",
    },
  },
  MOSTRA_REVIEW_MENTION_UNKNOWN: {
    severity: "error",
    phase: "host",
    title: "Mention of someone the page doesn't know",
    hint: "Mention someone from the list of people the shell offers.",
    docs: {
      explanation:
        "A comment mentioned a key that names nobody this page may mention: the artifact's expected respondents where the page sees them by name, and the authors of the threads it sees.",
      fix: "Choose the person from the mention list the shell offers.",
    },
  },
  MOSTRA_REVIEW_ID_REUSED: {
    severity: "error",
    phase: "host",
    title: "Thread or comment ID used twice",
    hint: "Make a new ID for a new thread or comment; repeat an ID only to retry the same one.",
    docs: {
      explanation:
        "A thread or comment ID was sent again with other contents. IDs make retries safe: the same ID with the same contents answers the first result.",
      fix: "Create a fresh `thr_` or `cmt_` ID for each new thread or comment.",
    },
  },
  MOSTRA_REVIEW_ANCHOR_TOO_LARGE: {
    severity: "error",
    phase: "host",
    title: "Anchor too large",
    hint: "Anchor to a smaller element, or keep an anchor provider's data under 16 KiB.",
    docs: {
      explanation:
        "A comment's anchor, with every layer it holds, was larger than an anchor may be (32 KiB of JSON).",
      fix: "Keep anchor provider data small: name the datum, not the dataset.",
    },
  },
  MOSTRA_REVIEW_TOO_MANY: {
    severity: "error",
    phase: "host",
    title: "Too many threads or comments",
    hint: "Resolve or reply in the existing threads instead of starting new ones.",
    docs: {
      explanation:
        "A viewer keeps at most 1,000 threads on one artifact, and a thread holds at most 500 comments.",
      fix: "Reply in an existing thread.",
    },
  },
  MOSTRA_REVIEW_CROP_MISSING: {
    severity: "error",
    phase: "host",
    title: "No crop for this thread",
    hint: "Wait for the crop, or read the thread's other anchor layers.",
    docs: {
      explanation:
        "The thread's crop isn't captured: it is still being captured, or its capture failed (the thread says why).",
      fix: "Read the crop again once the thread's crop state is `captured`.",
    },
  },
  MOSTRA_REVIEW_ANCHOR_LOST: {
    severity: "error",
    phase: "host",
    title: "Anchor not found for its crop",
    hint: "Give the element a `data-review-id`, so comments find it again in any version.",
    docs: {
      explanation:
        "Capturing a thread's crop, no layer of its anchor found its place in the page: the element is gone or moved past its selectors, and the anchor had no box to fall back on.",
      fix: "Add `data-review-id` to elements people comment on.",
    },
  },
  // gen:entries
};
