/**
 * Sending the queue (D140 item 6): a detached process the CLI starts after a command, at most one
 * at a time and at most once a minute. It reads the decision again before it sends, so consent
 * withdrawn in between drops the events; it posts at most 100 events per request with no header
 * but `Content-Type`, `User-Agent` and the ones HTTP itself needs, and keeps what a failed
 * attempt couldn't send for the next flush.
 */
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join, parse } from "node:path";
import type { Environment } from "../home.ts";
import { cliVersion, fromSource, packageRoot } from "../version.ts";
import { buildEndpoint, decide } from "./decision.ts";
import { TelemetryEvent } from "./events.ts";
import { QUEUE_MAX_EVENTS, type TelemetryStore } from "./store.ts";

/** At most this many events per request. */
export const BATCH = 100;
/** A flush starts at most this often. */
export const FLUSH_INTERVAL_MS = 60_000;
/** The flush interval; `MOSTRA_TEST_FLUSH_INTERVAL_MS` shortens it, for tests only. */
function flushInterval(env: Environment): number {
  const test = Number(env["MOSTRA_TEST_FLUSH_INTERVAL_MS"]);
  return Number.isInteger(test) && test >= 0 && test < FLUSH_INTERVAL_MS ? test : FLUSH_INTERVAL_MS;
}

/** One request's limit. */
const REQUEST_TIMEOUT_MS = 5000;

/** Posts one batch; resolves with whether the collector took it (any 2xx). */
export function post(endpoint: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(endpoint);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `mostra-cli/${cliVersion()}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300),
        );
        response.on("error", () => resolve(false));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end(body);
  });
}

/**
 * Sends the queue: the decision again, then batches until one fails. Events the schema refuses
 * never leave the machine.
 */
export async function flush(
  store: TelemetryStore,
  env: Environment,
  now: () => number,
): Promise<void> {
  const settings = store.read();
  // The queue holds only events of uses that aren't embedded; the rest of the order applies again.
  const decision = decide({
    env,
    buildEndpoint: buildEndpoint(),
    embedded: false,
    settings,
    askFirst: false,
  });
  if (!decision.enabled || decision.endpoint === undefined) {
    // Consent withdrawn (or never given) since the events were queued: they go unsent.
    if (decision.reason !== "no-collector" && settings.ok) store.drop(store.queued(now()), now());
    return;
  }
  // The queue holds at most QUEUE_MAX_EVENTS, so a flush needs at most this many batches.
  for (let round = 0; round <= Math.ceil(QUEUE_MAX_EVENTS / BATCH); round += 1) {
    const lines = store.queued(now()).slice(0, BATCH);
    if (lines.length === 0) return;
    const events: unknown[] = [];
    for (const line of lines) {
      try {
        const parsed = TelemetryEvent.safeParse(JSON.parse(line));
        if (parsed.success) events.push(parsed.data);
      } catch {
        // Not an event: dropped with the batch.
      }
    }
    const sent = events.length === 0 || (await post(decision.endpoint, JSON.stringify({ events })));
    if (!sent) return;
    // Nothing removed (another process changed the queue, or the lock was out of reach): stop
    // rather than send the same batch again.
    if (store.drop(lines, now()) === 0) return;
  }
}

/** The flusher's entry in the CLI's package. */
function flusherEntry(): { readonly entry: string; readonly nodeArgs: readonly string[] } {
  const root = packageRoot();
  return fromSource()
    ? {
        entry: join(root, "src", "telemetry", "flush-main.ts"),
        nodeArgs: ["--conditions=@mostra/source"],
      }
    : { entry: join(root, "dist", "telemetry", "flush-main.js"), nodeArgs: [] };
}

/**
 * Starts a flusher when the queue has events and no flush started in the last minute, fully
 * detached: no stdio, its own process group, never waited for, so `mostra … | jq` and every
 * harness reading to end of file finish when the command does.
 */
export function startFlusher(store: TelemetryStore, env: Environment, now: number): void {
  if (store.queued(now).length === 0) return;
  let due = false;
  store.update((current) => {
    const last = current.lastFlushAt === undefined ? 0 : Date.parse(current.lastFlushAt);
    if (Number.isFinite(last) && now - last < flushInterval(env)) return current;
    due = true;
    return { ...current, lastFlushAt: new Date(now).toISOString() };
  });
  if (!due) return;
  const { entry, nodeArgs } = flusherEntry();
  try {
    const child = spawn(process.execPath, [...nodeArgs, entry, store.dir], {
      detached: true,
      stdio: "ignore",
      // Not the command's directory but its file system's root, which always exists: on Windows
      // a process's working directory can't be removed or renamed while it runs, and the flusher
      // outlives the command (WP-W2).
      cwd: parse(store.dir).root,
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Telemetry never changes a command's outcome.
  }
}
