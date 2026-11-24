/**
 * The capture queue (WP-20, D183 item 4; WP-20's review, finding 3): crops are taken a page at a
 * time, so crops an away owner keeps waiting never hold back the others, and a submit's wait asks
 * about its own threads, whatever else is pending.
 */
import { describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import { type Blobs, type CaptureJob, createCropper } from "../../src/review/index.ts";

/** A queue of pending crops in memory, read as the ledger reads them: by thread ID. */
function queue(count: number, away: (index: number) => boolean) {
  const pending = new Map<string, CaptureJob & { readonly away: boolean }>();
  for (let index = 0; index < count; index += 1) {
    const threadId = `thr_${String(index).padStart(5, "0")}`;
    pending.set(threadId, {
      threadId,
      artifactId: away(index) ? "art_away" : `art_${index}`,
      versionId: "ver_x",
      viewId: "vw_x",
      viewerId: "vwr_x",
      anchor: {},
      away: away(index),
    });
  }
  const read = (which?: { after?: string; ids?: readonly string[] }): CaptureJob[] => {
    const ids = which?.ids;
    if (ids !== undefined) return ids.flatMap((id) => pending.get(id) ?? []);
    return [...pending.values()]
      .filter((job) => job.threadId > (which?.after ?? ""))
      .sort((a, b) => (a.threadId < b.threadId ? -1 : 1))
      .slice(0, 100);
  };
  return { pending, read };
}

const blobs: Blobs = {
  dir: "/nowhere",
  put: async () => "a".repeat(64),
  path: (sha) => `/nowhere/${sha}.png`,
  read: async () => undefined,
  remove: async () => undefined,
};

describe("the capture queue (finding 3)", () => {
  it("captures every crop past a hundred an away owner keeps waiting, and a submit waits for its own", async () => {
    const { pending, read } = queue(150, (index) => index < 120);
    const captured: string[] = [];
    const cropper = createCropper({
      log: silentLog,
      blobs,
      pending: read,
      away: (job) => job.artifactId === "art_away",
      capture: async (job) => {
        captured.push(job.threadId);
        return { png: new Uint8Array([1]), width: 1, height: 1, source: "host" };
      },
      record: (threadId) => {
        pending.delete(threadId);
      },
      pauseMs: 1,
    });
    const last = "thr_00149";
    const waited = Date.now();
    await cropper.settled([last], 10_000);
    expect(pending.has(last)).toBe(false);
    expect(Date.now() - waited).toBeLessThan(5_000);
    // Every crop whose owner is here is taken; the away owner's wait.
    for (let tries = 0; tries < 100 && captured.length < 30; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(new Set(captured).size).toBe(30);
    expect(captured.every((id) => id >= "thr_00120")).toBe(true);
    expect(pending.size).toBe(120);
    await cropper.stop();
  });
});
