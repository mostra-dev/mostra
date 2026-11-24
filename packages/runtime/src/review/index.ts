/**
 * The review layer's work outside the ledger (WP-20; D23, RV-02, RV-05, HO-11): each thread's crop,
 * captured after the thread commits and kept as a content-addressed file in the home's `blobs/`,
 * and `review/export`, an artifact's review for agents with every anchor layer and crop path.
 *
 * Crops (D183 item 5): a thread's crop is asked of the host's `capture` port when one is
 * registered, else made by the default, the verify runner's browser rendering the view's version
 * with the viewer's answers at the view's viewport (ARCHITECTURE §8); a host whose capture fails
 * leaves it to the default. A capture is tried three times, with a growing pause; then the crop is
 * `failed` with why, and the thread keeps every other layer. A crop is set once.
 *
 * ```ts
 * const blobs = openBlobs(home);
 * const cropper = createCropper({ log, blobs, capture, pending: interaction.pendingCrops, record: interaction.setCrop });
 * interaction.onThread((job, change) => change === "created" && cropper.kick());
 * await cropper.settled(interaction.pendingCropsOf(artifactId, viewerId), 20_000);
 * ```
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  type ArtifactRef,
  createDiagnostic,
  type ResultComment,
  type ReviewAnchor,
  type ReviewExport,
  type ReviewExportResult,
  RpcError,
  reviewExportMethod,
  type Viewer,
} from "@mostra/protocol";
import { type CropOutcome, commentMarkdown } from "../interaction/index.ts";
import type { Log } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";

/** What a capture is asked to photograph: a thread's view and anchor. */
export interface CaptureJob {
  readonly threadId: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly viewId: string;
  readonly viewerId: string;
  readonly anchor: ReviewAnchor;
}

/** A capture's answer: the PNG, its size, and who made it. */
export interface Captured {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** `host` for a host's `capture` port, `default` for the verify runner's browser. */
  readonly source: "host" | "default";
}

/** Where crops come from. */
export type Capture = (job: CaptureJob) => Promise<Captured>;

/** The largest crop kept, in bytes. */
export const CROP_BYTES_MAX: number = 8 * 1024 * 1024;
/** How many times a capture is tried before its crop is `failed`. */
export const CAPTURE_ATTEMPTS = 3;
/**
 * How long a submit waits for the crops of the threads it carries (D183 item 2): a crop is
 * usually captured within seconds of its comment; one still pending past this is submitted as
 * `pending`, and the submission is never held back for it.
 */
export const CROP_WAIT_MS = 20_000;

/** The PNG signature, which every crop starts with. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** The home's crops: content-addressed PNG files (DATA_MODEL §1, `blobs/<sha256>.png`). */
export interface Blobs {
  /** The directory. */
  readonly dir: string;
  /** Stores a PNG, once; returns its SHA-256. Refuses bytes that aren't a PNG. */
  put(png: Uint8Array): Promise<string>;
  /** A crop's absolute path, whether or not it exists. */
  path(sha256: string): string;
  /** A crop's bytes, checked against its name; `undefined` when missing or altered. */
  read(sha256: string): Promise<Buffer | undefined>;
  /** Removes a crop no thread names any more (a removed hosted artifact's); none is no error. */
  remove(sha256: string): Promise<void>;
}

/** Opens the home's crop store. */
export function openBlobs(home: string): Blobs {
  const dir = join(home, "blobs");
  const path = (sha256: string): string => {
    if (!/^[0-9a-f]{64}$/.test(sha256))
      throw new Error(`Not a crop's name: ${sha256.slice(0, 80)}.`);
    return join(dir, `${sha256}.png`);
  };
  return {
    dir,
    path,
    async put(png) {
      if (
        png.byteLength < PNG_SIGNATURE.length ||
        PNG_SIGNATURE.some((byte, at) => png[at] !== byte)
      ) {
        throw new Error("the capture answered something that isn't a PNG");
      }
      const sha = createHash("sha256").update(png).digest("hex");
      const target = path(sha);
      if (existsSync(target)) return sha;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      try {
        await writeFile(temporary, png, { mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      return sha;
    },
    async read(sha256) {
      try {
        const bytes = await readFile(path(sha256));
        return createHash("sha256").update(bytes).digest("hex") === sha256 ? bytes : undefined;
      } catch {
        return undefined;
      }
    },
    async remove(sha256) {
      await rm(path(sha256), { force: true });
    },
  };
}

/** What the capture queue needs of the instance. */
export interface CropperOptions {
  readonly log: Log;
  readonly blobs: Blobs;
  readonly capture: Capture;
  /**
   * Pending crops: a page of them in the order of their threads' IDs after `after`, or the ones of
   * `ids` still pending.
   */
  readonly pending: (which?: {
    readonly after?: string;
    readonly ids?: readonly string[];
  }) => readonly CaptureJob[];
  /** Records a crop, once. */
  readonly record: (threadId: string, outcome: CropOutcome) => void;
  /**
   * Whether a pending crop waits instead of being tried (a hosted home's owner away): it is never
   * failed for that, and it is tried again once `kick` is called.
   */
  readonly away?: (job: CaptureJob) => boolean;
  /** Tests shorten the pauses between attempts (2 s, then 4 s). */
  readonly pauseMs?: number;
}

/** The capture queue: one capture at a time, oldest first. */
export interface Cropper {
  /** A thread was made, or captures may succeed now: pending crops are captured soon. */
  kick(): void;
  /** Resolves once none of these threads' crops is pending, or after `timeoutMs`. */
  settled(threadIds: readonly string[], timeoutMs: number): Promise<void>;
  /** Stops taking captures; the one under way finishes. */
  stop(): Promise<void>;
}

/** Starts the capture queue. */
export function createCropper(options: CropperOptions): Cropper {
  const attempts = new Map<string, number>();
  const waiting = new Set<() => void>();
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;
  const pause = options.pauseMs ?? 2_000;

  const wake = (): void => {
    for (const listener of [...waiting]) listener();
  };

  /** One attempt; `true` when the crop is still pending and should be tried again. */
  const one = async (job: CaptureJob): Promise<boolean> => {
    const tried = (attempts.get(job.threadId) ?? 0) + 1;
    attempts.set(job.threadId, tried);
    try {
      const captured = await options.capture(job);
      // An instance stopping records nothing more; the crop stays pending for its next start.
      if (stopped) return false;
      if (captured.png.byteLength > CROP_BYTES_MAX) {
        throw new Error(`the crop is ${captured.png.byteLength} bytes, more than a crop may be`);
      }
      const blob = await options.blobs.put(captured.png);
      options.record(job.threadId, {
        kind: "captured",
        blob,
        width: captured.width,
        height: captured.height,
        source: captured.source,
      });
      attempts.delete(job.threadId);
      return false;
    } catch (error) {
      const reason =
        error instanceof RpcError
          ? error.diagnostic.message
          : error instanceof Error
            ? error.message
            : String(error);
      if (options.away?.(job)) {
        // Its owner is away: the crop waits for them, never fails for it.
        attempts.delete(job.threadId);
        return false;
      }
      options.log.warn("review.capture_failed", {
        threadId: job.threadId,
        attempt: tried,
        error: reason,
      });
      if (tried >= CAPTURE_ATTEMPTS) {
        options.record(job.threadId, { kind: "failed", reason: reason.slice(0, 500) });
        attempts.delete(job.threadId);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pause * 2 ** (tried - 1)));
      return true;
    }
  };

  /** The threads a submit waits for: their crops go first (WP-20's review, finding 3). */
  const urgent = new Set<string>();

  /** Tries one job unless its owner is away; `true` when it should be tried again. */
  const attempt = async (job: CaptureJob): Promise<boolean> => {
    if (options.away?.(job)) return false;
    const retry = await one(job);
    wake();
    return retry;
  };

  const drain = async (): Promise<void> => {
    do {
      again = false;
      if (urgent.size > 0) {
        const ids = [...urgent];
        urgent.clear();
        for (const job of options.pending({ ids })) {
          if (stopped) return;
          if (await attempt(job)) again = true;
        }
      }
      // Every pending crop, a page at a time: crops an away owner keeps waiting never hold back
      // the others behind them.
      let after = "";
      for (;;) {
        const page = options.pending({ after });
        if (page.length === 0) break;
        for (const job of page) {
          if (stopped) return;
          // A crop that failed this attempt is tried again on the next pass.
          if (await attempt(job)) again = true;
        }
        after = page[page.length - 1]?.threadId ?? after;
        // A submit waiting for its crops goes before the rest of the queue.
        if (urgent.size > 0) {
          again = true;
          break;
        }
      }
    } while (again && !stopped);
  };

  const kick = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = drain()
      .catch((error: unknown) => options.log.error("review.cropper_failed", { error }))
      .finally(() => {
        running = undefined;
        wake();
        if (again && !stopped) kick();
      });
  };

  return {
    kick,
    settled(threadIds, timeoutMs) {
      if (threadIds.length === 0) return Promise.resolve();
      // These threads themselves, however many other crops are pending (finding 3).
      const open = (): boolean => options.pending({ ids: threadIds }).length > 0;
      if (!open()) return Promise.resolve();
      for (const id of threadIds) urgent.add(id);
      kick();
      return new Promise((resolve) => {
        const done = (): void => {
          waiting.delete(check);
          clearTimeout(timer);
          resolve();
        };
        const check = (): void => {
          if (!open()) done();
        };
        const timer = setTimeout(done, timeoutMs);
        waiting.add(check);
      });
    },
    async stop() {
      stopped = true;
      // A capture under way finishes or is left after a few seconds: it records nothing now.
      await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 5_000).unref?.())]);
    },
  };
}

/**
 * The capture port's order (HO-11): the host's `capture` port when one is registered, its answer
 * checked; the default (the verify runner's browser) when there is none, or when the host fails.
 */
export function captureWith(sources: {
  readonly host: () => ((job: CaptureJob) => Promise<Captured>) | undefined;
  readonly fallback: Capture;
  readonly log: Log;
}): Capture {
  return async (job) => {
    const host = sources.host();
    if (host) {
      try {
        return await host(job);
      } catch (error) {
        sources.log.warn("review.capture_port_failed", {
          threadId: job.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return sources.fallback(job);
  };
}

/** What `review/export` needs of the instance. */
export interface ReviewExportOptions {
  /** The artifact a host names, with its title. */
  readonly artifact: (ref: ArtifactRef) => { readonly id: string; readonly title: string };
  /** A submission's review: its threads and choices, with crops' absolute paths. */
  readonly submission: (
    artifactId: string,
    submissionId: string,
  ) =>
    | {
        readonly at: string;
        readonly viewer: Viewer;
        readonly version: number;
        readonly comments: readonly ResultComment[];
        readonly choices: ReviewExport["choices"];
      }
    | undefined;
  /** Every thread of the artifact and every viewer's choices now, crops' paths absolute. */
  readonly current: (artifactId: string) => {
    readonly comments: readonly ResultComment[];
    readonly choices: ReviewExport["choices"];
  };
}

/** The export as Markdown for agents: choices, then every thread with each anchor layer and crop. */
export function reviewMarkdown(review: ReviewExport): string {
  const name = (viewer: Viewer): string => JSON.stringify(viewer.name ?? viewer.ref ?? viewer.id);
  const lines = [
    `# Review of ${JSON.stringify(review.artifact.title)} (${review.artifact.id})`,
    "",
    review.submission
      ? `- Submission ${review.submission.id} by ${name(review.submission.viewer)} at ${review.submission.at}, version ${review.submission.version}`
      : "- Every comment thread and choice of the artifact now",
    `- ${review.comments.length} ${review.comments.length === 1 ? "thread" : "threads"}; each crop is a PNG of the place the comment points at, outlined`,
    "",
    "## Choices",
    ...(review.choices.length > 0
      ? review.choices.map(
          (choice) =>
            `- \`${choice.reviewSetId}\`: ${JSON.stringify(choice.candidateId)}${choice.label !== undefined ? ` (${JSON.stringify(choice.label)})` : ""}${choice.viewer ? ` by ${name(choice.viewer)}` : ""}`,
        )
      : ["- (none)"]),
    "",
    "## Comments",
    ...(review.comments.length > 0 ? review.comments.flatMap(commentMarkdown) : ["- (none)"]),
    "",
  ];
  return lines.join("\n");
}

/**
 * `review/export` (RV-05): an artifact's review, or one submission's, as Markdown or JSON. With
 * `out`, a directory: `review.md` or `review.json`, and each captured crop copied beside it as
 * `crops/<threadId>.png`, which the paths in it name. Without, the text, naming the crops where the
 * home keeps them.
 */
export function reviewMethods(options: ReviewExportOptions): MethodHandler[] {
  return [
    handler(reviewExportMethod, async (params): Promise<ReviewExportResult> => {
      const artifact = options.artifact(params.artifact);
      const format = params.format ?? "md";
      let review: ReviewExport;
      if (params.submission !== undefined) {
        const found = options.submission(artifact.id, params.submission);
        if (!found) {
          throw new RpcError(
            createDiagnostic("MOSTRA_ARTIFACT_NOT_FOUND", {
              message: `The artifact ${artifact.id} has no submission ${params.submission}.`,
            }),
          );
        }
        review = {
          artifact,
          submission: {
            id: params.submission,
            at: found.at,
            viewer: found.viewer,
            version: found.version,
          },
          choices: found.choices,
          comments: found.comments,
        };
      } else {
        review = { artifact, ...options.current(artifact.id) };
      }
      const crops = review.comments.filter((comment) => comment.crop.path !== "").length;
      if (params.out === undefined) {
        return {
          format,
          threads: review.comments.length,
          crops,
          content:
            format === "json" ? `${JSON.stringify(review, null, 2)}\n` : reviewMarkdown(review),
        };
      }
      if (!isAbsolute(params.out)) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message: "`out` is an absolute path." }),
        );
      }
      const cropsDir = join(params.out, "crops");
      await mkdir(cropsDir, { recursive: true });
      const comments: ResultComment[] = [];
      for (const comment of review.comments) {
        if (comment.crop.path === "" || !existsSync(comment.crop.path)) {
          comments.push(comment);
          continue;
        }
        const copied = join(cropsDir, `${comment.threadId}.png`);
        await copyFile(comment.crop.path, copied);
        comments.push({ ...comment, crop: { ...comment.crop, path: copied } });
      }
      const written: ReviewExport = { ...review, comments };
      const file = join(params.out, format === "json" ? "review.json" : "review.md");
      await writeFile(
        file,
        format === "json" ? `${JSON.stringify(written, null, 2)}\n` : reviewMarkdown(written),
      );
      return { format, threads: comments.length, crops, path: file };
    }),
  ];
}
