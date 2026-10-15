/**
 * The shell's own event stream for its view (WP-07): the same browser-protocol stream the frame
 * reads, served on the shell origin behind the shell's session, so the trusted controls, the
 * banner and the receipt never depend on what the artifact tells them. It falls back to long
 * polling on the same cursor after two failures in a row (D47, FAILURE_MODEL §8).
 */
import type { EventRecord, PollResult, StreamSnapshot } from "@mostra/protocol";
import { eventsUrl } from "./api.ts";

/** What the stream hears. */
export interface StreamListener {
  onSnapshot(snapshot: StreamSnapshot): void;
  onEvents(events: readonly EventRecord[]): void;
  onStatus(status: "live" | "offline" | "revoked"): void;
}

/** Opens the shell's stream for a view; returns the function that closes it. */
export function openStream(apiBase: string, viewId: string, listener: StreamListener): () => void {
  let closed = false;
  let cursor: string | undefined;
  let source: EventSource | undefined;
  let failures = 0;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async (): Promise<void> => {
    polling = true;
    let backoff = 1_000;
    while (!closed) {
      const url = `${eventsUrl(apiBase, viewId, true)}${cursor === undefined ? "" : `&cursor=${cursor}`}&wait=25`;
      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (response.status === 410) {
          listener.onStatus("revoked");
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const result = (await response.json()) as PollResult;
        backoff = 1_000;
        listener.onStatus("live");
        if (result.snapshot) listener.onSnapshot(result.snapshot);
        if (result.events.length > 0) listener.onEvents(result.events);
        cursor = result.cursor;
      } catch {
        listener.onStatus("offline");
        await new Promise((resolve) => {
          timer = setTimeout(resolve, backoff);
        });
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  };

  source = new EventSource(eventsUrl(apiBase, viewId));
  source.addEventListener("open", () => {
    failures = 0;
    listener.onStatus("live");
  });
  source.addEventListener("snapshot", (event) => {
    failures = 0;
    const snapshot = JSON.parse((event as MessageEvent<string>).data) as StreamSnapshot;
    cursor = snapshot.cursor;
    listener.onSnapshot(snapshot);
  });
  source.addEventListener("mostra", (event) => {
    failures = 0;
    const record = JSON.parse((event as MessageEvent<string>).data) as EventRecord;
    cursor = record.cursor;
    listener.onEvents([record]);
  });
  source.addEventListener("error", () => {
    if (closed) return;
    failures += 1;
    listener.onStatus("offline");
    if (source?.readyState === EventSource.CLOSED || failures >= 2) {
      source?.close();
      source = undefined;
      if (!polling) void poll();
    }
  });

  return () => {
    closed = true;
    source?.close();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Reads the view's snapshot once (after another tab's submission, say). */
export async function readSnapshot(
  apiBase: string,
  viewId: string,
): Promise<StreamSnapshot | undefined> {
  try {
    const response = await fetch(`${eventsUrl(apiBase, viewId, true)}&wait=0`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as PollResult).snapshot;
  } catch {
    return undefined;
  }
}
