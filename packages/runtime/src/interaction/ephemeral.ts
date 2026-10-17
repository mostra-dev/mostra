/**
 * Ephemeral traffic to pages (D47, D63, LL-04): run progress, log lines and result items, and live
 * values. None of it is an event: it reaches the views that asked for it within the last minute
 * (a run they started or attached to, a live source they read) and is lost by anyone who isn't
 * listening, because what it reports is also readable on demand (`runs/attach`, `live`). A view's
 * open event stream hears it at once; a view that long-polls collects it in a bounded queue
 * between polls.
 */
import type { EphemeralMessage } from "@mostra/protocol";

/** How long a view's interest in a run or a live source lasts without being renewed. */
export const INTEREST_LEASE_MS: number = 60_000;

/** The most messages a polling view keeps between polls; older ones are dropped. */
const POLL_QUEUE_MAX = 1000;

/** What a view listens to. */
interface ViewInterest {
  readonly artifactId: string;
  readonly runs: Map<string, number>;
  readonly live: Map<string, { until: number; window?: number }>;
  readonly listeners: Set<(message: EphemeralMessage) => void>;
  queue?: EphemeralMessage[];
  queueUntil?: number;
  wake?: () => void;
}

type RunMessage = Extract<EphemeralMessage, { kind: "run" }>;

/**
 * Adds `message` to a view's queue of messages not yet sent, coalesced (D130, FAILURE_MODEL §6;
 * Opus review 12), so a fast source can't make a slow reader fall behind:
 * - a live value in latest mode replaces the values of its source still queued: the page shows
 *   only the newest (append mode keeps every value, for the ring);
 * - a run's delta that continues the one queued for the run merges into it, losing nothing.
 */
function coalesceInto(
  view: ViewInterest,
  queue: EphemeralMessage[],
  message: EphemeralMessage,
): void {
  if (message.kind === "live") {
    const latestMode = view.live.get(message.live.key)?.window === undefined;
    if (latestMode && message.live.value !== undefined) {
      for (let index = queue.length - 1; index >= 0; index--) {
        const queued = queue[index] as EphemeralMessage;
        if (
          queued.kind === "live" &&
          queued.live.key === message.live.key &&
          queued.live.value !== undefined
        ) {
          queue.splice(index, 1);
        }
      }
    }
    queue.push(message);
    return;
  }
  const delta = message.run;
  for (let index = queue.length - 1; index >= 0; index--) {
    const queued = queue[index] as EphemeralMessage;
    if (queued.kind !== "run" || queued.run.runId !== delta.runId) continue;
    const prior = queued.run;
    if (
      delta.logFrom === prior.logFrom + prior.log.length &&
      delta.batchFrom === prior.batchFrom + prior.batches.length
    ) {
      const merged: RunMessage = {
        kind: "run",
        run: {
          ...prior,
          ...delta,
          logFrom: prior.logFrom,
          log: [...prior.log, ...delta.log],
          batchFrom: prior.batchFrom,
          batches: [...prior.batches, ...delta.batches],
          ...((delta.progress ?? prior.progress)
            ? { progress: delta.progress ?? prior.progress }
            : {}),
        },
      };
      queue[index] = merged;
      return;
    }
    break;
  }
  queue.push(message);
}

/** A live source some view, host or `always` keeps alive. */
export interface LiveInterest {
  readonly artifactId: string;
  readonly key: string;
}

/** The bus. */
export interface EphemeralBus {
  /**
   * Adds `message` to `queue`, a reader's messages not yet sent, coalescing it with what the
   * queue holds for the same source or run as the view's interest allows.
   */
  coalesce(
    artifactId: string,
    viewId: string,
    queue: EphemeralMessage[],
    message: EphemeralMessage,
  ): void;
  /** The view follows these runs for the next minute. */
  attachRuns(artifactId: string, viewId: string, runIds: readonly string[]): void;
  /** The view reads these live sources for the next minute. */
  watchLive(
    artifactId: string,
    viewId: string,
    keys: readonly { readonly key: string; readonly window?: number }[],
  ): void;
  /** Sends a run's change to every view following it. */
  publishRun(artifactId: string, message: Extract<EphemeralMessage, { kind: "run" }>): void;
  /** Sends a live update to every view reading the source. */
  publishLive(artifactId: string, message: Extract<EphemeralMessage, { kind: "live" }>): void;
  /** Hears the view's messages as they come (an open event stream); returns the stop. */
  listen(
    artifactId: string,
    viewId: string,
    listener: (message: EphemeralMessage) => void,
  ): () => void;
  /** Takes what the view collected since its last poll, starting its queue on the first. */
  drain(artifactId: string, viewId: string): EphemeralMessage[];
  /** Resolves when the polling view has something, or after `ms`. */
  wait(artifactId: string, viewId: string, ms: number, signal?: AbortSignal): Promise<void>;
  /** The live sources views read now. */
  liveInterest(): LiveInterest[];
  /** Hears every change of {@link liveInterest}; returns the stop. */
  onLiveInterest(listener: () => void): () => void;
  /** How many views listen or poll now: the daemon stays while any do (D62). */
  activeViews(): number;
  /** Stops the lease timer. */
  close(): void;
}

/** Creates the bus. */
export function createEphemeralBus(
  options: { readonly now?: () => number; readonly leaseMs?: number } = {},
): EphemeralBus {
  const now = options.now ?? Date.now;
  const lease = options.leaseMs ?? INTEREST_LEASE_MS;
  const views = new Map<string, ViewInterest>();
  const interestListeners = new Set<() => void>();
  let lastInterest = "";

  const viewOf = (artifactId: string, viewId: string): ViewInterest => {
    let view = views.get(viewId);
    if (!view || view.artifactId !== artifactId) {
      view = { artifactId, runs: new Map(), live: new Map(), listeners: new Set() };
      views.set(viewId, view);
    }
    return view;
  };

  const interestKey = (): string =>
    [...new Set(currentInterest().map((entry) => `${entry.artifactId}\u0000${entry.key}`))]
      .sort()
      .join("\u0001");

  const currentInterest = (): LiveInterest[] => {
    const at = now();
    const out: LiveInterest[] = [];
    for (const view of views.values()) {
      for (const [key, lease] of view.live) {
        if (lease.until > at) out.push({ artifactId: view.artifactId, key });
      }
    }
    return out;
  };

  const interestChanged = (): void => {
    const next = interestKey();
    if (next === lastInterest) return;
    lastInterest = next;
    for (const listener of interestListeners) listener();
  };

  const deliver = (view: ViewInterest, message: EphemeralMessage): void => {
    for (const listener of view.listeners) listener(message);
    if (view.queue && (view.queueUntil ?? 0) > now()) {
      coalesceInto(view, view.queue, message);
      if (view.queue.length > POLL_QUEUE_MAX)
        view.queue.splice(0, view.queue.length - POLL_QUEUE_MAX);
      view.wake?.();
    }
  };

  // Expired leases end; views with nothing left are forgotten.
  const sweep = setInterval(
    () => {
      const at = now();
      for (const [viewId, view] of views) {
        for (const [runId, until] of view.runs) if (until <= at) view.runs.delete(runId);
        for (const [key, lease] of view.live) if (lease.until <= at) view.live.delete(key);
        if (view.queue && (view.queueUntil ?? 0) <= at) {
          delete view.queue;
          delete view.queueUntil;
        }
        if (
          view.runs.size === 0 &&
          view.live.size === 0 &&
          view.listeners.size === 0 &&
          !view.queue
        ) {
          views.delete(viewId);
        }
      }
      interestChanged();
    },
    Math.min(5_000, Math.max(100, lease / 4)),
  );
  sweep.unref?.();

  return {
    coalesce(artifactId, viewId, queue, message) {
      coalesceInto(viewOf(artifactId, viewId), queue, message);
    },
    attachRuns(artifactId, viewId, runIds) {
      const view = viewOf(artifactId, viewId);
      const until = now() + lease;
      for (const runId of runIds) view.runs.set(runId, until);
    },
    watchLive(artifactId, viewId, keys) {
      const view = viewOf(artifactId, viewId);
      const until = now() + lease;
      for (const entry of keys) {
        view.live.set(entry.key, {
          until,
          ...(entry.window === undefined ? {} : { window: entry.window }),
        });
      }
      interestChanged();
    },
    publishRun(artifactId, message) {
      const at = now();
      for (const view of views.values()) {
        if (view.artifactId !== artifactId) continue;
        if ((view.runs.get(message.run.runId) ?? 0) > at) deliver(view, message);
      }
    },
    publishLive(artifactId, message) {
      const at = now();
      for (const view of views.values()) {
        if (view.artifactId !== artifactId) continue;
        if ((view.live.get(message.live.key)?.until ?? 0) > at) deliver(view, message);
      }
    },
    listen(artifactId, viewId, listener) {
      const view = viewOf(artifactId, viewId);
      view.listeners.add(listener);
      return () => {
        view.listeners.delete(listener);
      };
    },
    drain(artifactId, viewId) {
      const view = viewOf(artifactId, viewId);
      const taken = view.queue ?? [];
      view.queue = [];
      view.queueUntil = now() + lease;
      return taken;
    },
    wait(artifactId, viewId, ms, signal) {
      const view = viewOf(artifactId, viewId);
      if (view.queue && view.queue.length > 0) return Promise.resolve();
      return new Promise((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          if (view.wake === done) delete view.wake;
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener("abort", done, { once: true });
        view.wake = done;
      });
    },
    liveInterest: currentInterest,
    onLiveInterest(listener) {
      interestListeners.add(listener);
      return () => {
        interestListeners.delete(listener);
      };
    },
    activeViews() {
      const at = now();
      let count = 0;
      for (const view of views.values()) {
        if (view.listeners.size > 0 || (view.queueUntil ?? 0) > at) count += 1;
      }
      return count;
    },
    close() {
      clearInterval(sweep);
    },
  };
}
