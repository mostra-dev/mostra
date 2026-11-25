/**
 * The review ports (WP-20, HO-11): a host's `reviews` port mirrors each thread and each review
 * set's choice, and its `capture` port supplies the screenshot a comment's crop is cut from; without
 * them there is no mirror, and the crop comes from the instance's own verify browser.
 */
import { CommentId, MutationId, ThreadId } from "@mostra/protocol";
import { FORM } from "../fixtures.ts";
import { check, type Scenario, same } from "../scenario.ts";

interface PageThread {
  readonly id: string;
  readonly status: string;
  readonly crop: { readonly state: string; readonly reason?: string };
}

interface ExportedComment {
  readonly threadId: string;
  readonly status: string;
  readonly crop: { readonly path: string; readonly state?: string };
}

/** HO-11: threads and choices reach a host that serves `reviews`; none reach one that doesn't. */
export const reviewMirrors: Scenario = {
  id: "ports.reviews",
  title:
    "Each comment thread, its resolution and each review set's choice reach the host's reviews port, best effort; without the port nothing is mirrored and review/export still has them",
  covers: ["HO-11", "HO-05", "RV-05"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const threadId = ThreadId.create();
    const started = await viewer.comment(threadId, CommentId.create(), "The heading wraps.");
    same(started.status, 200, `a comment (${started.body})`);
    const resolved = await viewer.review(`threads/${threadId}/status`, {
      viewId: viewer.viewId,
      status: "resolved",
    });
    same(resolved.status, 200, `resolving the thread (${resolved.body})`);
    const chosen = await viewer.review("choose", {
      viewId: viewer.viewId,
      mutationId: MutationId.create(),
      baseRevision: "0",
      reviewSetId: "layout",
      candidateId: "airy",
      label: "Airy",
    });
    same(chosen.status, 200, `the trusted Choose (${chosen.body})`);
    if (context.host.serves("reviews")) {
      await context.eventually("the host receives the thread, resolved", async () =>
        (await context.store()).reviews?.find(
          (entry) =>
            entry.kind === "thread" && entry.threadId === threadId && entry.status === "resolved",
        ),
      );
      await context.eventually("the host receives the choice", async () =>
        (await context.store()).reviews?.find(
          (entry) =>
            entry.kind === "choice" &&
            entry.artifactId === receipt.artifactId &&
            entry.reviewSetId === "layout" &&
            entry.candidateId === "airy",
        ),
      );
    } else {
      check(
        ((await context.store()).reviews ?? []).length === 0,
        "a host that serves no reviews port was sent mirrors",
      );
    }
    // Mirrors or not, the instance keeps the review: review/export has the thread and the choice.
    const exported = (await context.host.call("review/export", {
      artifact: { artifactId: receipt.artifactId },
      format: "json",
    })) as { content: string };
    const review = JSON.parse(exported.content) as {
      comments: ExportedComment[];
      choices: { reviewSetId: string; candidateId: string }[];
    };
    same(
      review.comments.find((comment) => comment.threadId === threadId)?.status,
      "resolved",
      "the exported thread's status",
    );
    check(
      review.choices.some(
        (choice) => choice.reviewSetId === "layout" && choice.candidateId === "airy",
      ),
      "the exported review has no choice",
    );
  },
};

/** HO-11: a comment's crop comes from the host's `capture` port, else the verify browser. */
export const captures: Scenario = {
  id: "ports.capture",
  title:
    "A comment's crop is the screenshot the host's capture port supplies; without the port the instance captures it with its own verify browser",
  covers: ["HO-11", "HO-05", "RV-02"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const threadId = ThreadId.create();
    const started = await viewer.comment(threadId, CommentId.create(), "Crop this.");
    same(started.status, 200, `a comment (${started.body})`);
    // A cold verify browser takes its time: the default capture has a few minutes.
    const thread = await context.eventually(
      "the comment's crop is captured",
      async () => {
        const read = await viewer.review(`threads?view=${viewer.viewId}`);
        const found = read.json<{ threads: PageThread[] }>().threads.find((t) => t.id === threadId);
        if (found?.crop.state === "failed") {
          throw new Error(`the crop failed: ${found.crop.reason ?? "no reason"}`);
        }
        return found?.crop.state === "captured" ? found : undefined;
      },
      180_000,
    );
    same(thread.crop.state, "captured", "the crop's state");
    const exported = (await context.host.call("review/export", {
      artifact: { artifactId: receipt.artifactId },
      format: "json",
    })) as { content: string };
    const crop = (JSON.parse(exported.content) as { comments: ExportedComment[] }).comments.find(
      (comment) => comment.threadId === threadId,
    )?.crop;
    check(crop?.path, "the exported comment has no crop path");
    // Crops are kept by their SHA-256 (`blobs/<sha256>.png`): the host's own PNG, or another.
    const kept = /([0-9a-f]{64})\.png$/.exec(crop.path)?.[1];
    check(kept, `the crop's path names no digest (${crop.path})`);
    const asked = (await context.store()).captures?.find((entry) => entry.threadId === threadId);
    if (context.host.serves("capture")) {
      check(asked, "the host's capture port wasn't asked for the crop");
      same(kept, asked.sha256, "the crop kept, against the PNG the host supplied");
    } else {
      check(!asked, "a host that serves no capture port was asked for a crop");
    }
  },
};

/** The review port scenarios. */
export const REVIEW_SCENARIOS: readonly Scenario[] = [reviewMirrors, captures];
