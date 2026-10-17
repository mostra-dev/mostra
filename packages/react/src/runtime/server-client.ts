/**
 * The page's server side (D54, D56; WP-08): plain calls to `"use server"` functions, durable action
 * runs, and live sources, over the store's transport. Runs and sources are tracked per page: one
 * record per run and per source however many hooks show it, fed by the stream's ephemeral
 * messages and read again whenever a message may have been missed (a gap, a reconnect, a renewal),
 * so what a page shows always converges on what the server holds.
 */
import {
  type AnyFunction,
  type Batches,
  type CallLine,
  deserializeAll,
  type EphemeralMessage,
  type Frame,
  isFinalRunStatus,
  type LiveState,
  type LiveUpdate,
  RemoteError,
  type RunDelta,
  type RunProgress,
  type RunState,
  type RunStatus,
  serializeAll,
  ValueReader,
  type WireError,
} from "@mostra/protocol";
import { MostraError, targetUnavailable } from "./errors.ts";
import { NetworkError, type Transport } from "./transport.ts";

/** How often a page renews its interest in the runs and sources it shows (the lease is a minute). */
export const RENEW_MS = 20_000;

/** How many times a run's start is retried after the network failed, with the same client key. */
const START_ATTEMPTS = 6;

/** The function ID a server reference carries, or `undefined` for any other function. */
export function serverFunctionId(fn: unknown): string | undefined {
  const id = (fn as { mostraServerFunctionId?: unknown } | null | undefined)
    ?.mostraServerFunctionId;
  return typeof id === "string" ? id : undefined;
}

/** A random client key: a run's request idempotency (a retried POST joins its own run). */
function clientKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The error a failed or cancelled run, or call, rejects with. */
function failure(error: WireError | undefined, fallback: string): MostraError {
  return new MostraError(error?.code ?? fallback, error?.message ?? "The action failed.");
}

/** What a page knows of one run. */
export interface RunView {
  readonly runId: string;
  readonly fnId: string;
  readonly key?: string;
  readonly status: RunStatus;
  readonly reason?: string;
  readonly progress?: RunProgress;
  readonly log: readonly string[];
  readonly error?: WireError;
  readonly finishedAt?: string;
  /** The result, once it succeeded (an async iterable result: the iterable). */
  readonly data?: unknown;
  /** Items an async iterable result yielded so far. */
  readonly partial: readonly unknown[];
}

interface TrackedRun {
  view: RunView;
  batches: Frame[][];
  reader: ValueReader;
  rootDecoded: boolean;
  settled: Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/** What a page knows of one live source. */
export interface LiveView {
  readonly key: string;
  readonly loading: boolean;
  readonly data?: unknown;
  readonly revision?: string;
  readonly at?: string;
  readonly error?: WireError;
  /** Append mode: the values kept, oldest first, at most the largest window asked for. */
  readonly ring: readonly unknown[];
}

interface TrackedLive {
  view: LiveView;
  watchers: Map<number, number | undefined>;
  /** Revision numbers decoded or decoding, so an older value never replaces a newer one. */
  newest: number;
  ringRevisions: number[];
  /**
   * Every read and update of this source applies in the order it arrived, one at a time: values
   * decode asynchronously, and two in flight must never land out of order.
   */
  applying: Promise<void>;
  /** The newest value in latest mode still waiting its turn; a newer one replaces it. */
  pending?: LiveUpdate;
}

/** Options for {@link ServerClient}. */
export interface ServerClientOptions {
  readonly transport?: Transport;
  /** The page's view (D104), in live mode. */
  readonly viewId?: string;
  readonly timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** Plain calls, action runs and live sources for one page. */
export class ServerClient {
  readonly #options: ServerClientOptions;
  readonly #runs = new Map<string, TrackedRun>();
  readonly #live = new Map<string, TrackedLive>();
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #nextWatcher = 1;
  #renewTimer: unknown;
  #liveFlush: Promise<void> | undefined;
  #liveRefresh = new Set<string>();
  #notifyScheduled = false;

  constructor(options: ServerClientOptions) {
    this.#options = options;
  }

  // ── Subscription ───────────────────────────────────────────────────────────────────────

  /** Calls `listener` after every change; returns the function that stops. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** A number that changes with every change, for `useSyncExternalStore`. */
  version = (): number => this.#version;

  /**
   * Notes a change. Listeners hear about it once per animation frame (FAILURE_MODEL §6), or in a
   * microtask where a page has no frames to draw (a hidden tab, outside a browser), so a source
   * producing hundreds of values a second renders at most once a frame.
   */
  #changed(): void {
    this.#version += 1;
    if (this.#notifyScheduled) return;
    this.#notifyScheduled = true;
    const notify = (): void => {
      this.#notifyScheduled = false;
      for (const listener of [...this.#listeners]) listener();
    };
    const visible =
      typeof document === "undefined" ? false : document.visibilityState === "visible";
    if (visible && typeof requestAnimationFrame === "function") requestAnimationFrame(notify);
    else queueMicrotask(notify);
  }

  #transport(what: string): Transport & Required<Pick<Transport, "call">> {
    const transport = this.#options.transport;
    if (!transport?.call || this.#options.viewId === undefined) throw targetUnavailable(what);
    return transport as Transport & Required<Pick<Transport, "call">>;
  }

  get #viewId(): string {
    return this.#options.viewId ?? "";
  }

  // ── Plain calls (D54) ──────────────────────────────────────────────────────────────────

  /**
   * Calls a server function: no record, the result as soon as its first batch arrives (an async
   * iterable result keeps yielding as later batches come).
   */
  async call(fnId: string, args: readonly unknown[]): Promise<unknown> {
    const transport = this.#transport(`Calling the server function ${fnId}`);
    const batches = await serializeAll([...args], {
      mode: "argument",
      serverFunctionId: (fn: AnyFunction) => serverFunctionId(fn),
    });
    const reader = new ValueReader({ serverFunction: (id) => this.reference(id) });
    const lines = transport
      .call(fnId, { viewId: this.#viewId, args: batches })
      [Symbol.asyncIterator]();
    let ended: Extract<CallLine, { end: unknown }>["end"] | undefined;
    const pump = async (): Promise<void> => {
      for (;;) {
        const next = await lines.next();
        if (next.done) break;
        const line = next.value;
        if ("batch" in line) reader.push(line.batch);
        else ended = line.end;
      }
      if (ended?.status === "failed") throw failure(ended.error, "MOSTRA_ACTION_THREW");
      if (!ended) throw new NetworkError("The call's answer ended early.");
    };
    const pumped = pump();
    // The value as soon as it exists; a failure before it rejects the call.
    const root = await Promise.race([reader.root, pumped.then(() => reader.root)]);
    pumped.catch((error: unknown) => reader.fail(error));
    return root;
  }

  /** The client stub of a server function a result refers to. */
  reference(id: string): AnyFunction {
    const fn = ((...args: unknown[]) => this.call(id, args)) as AnyFunction;
    Object.defineProperty(fn, "mostraServerFunctionId", { value: id, enumerable: true });
    return fn;
  }

  // ── Action runs (D24, D54) ─────────────────────────────────────────────────────────────

  /** What the page knows of a run. */
  run(runId: string): RunView | undefined {
    return this.#runs.get(runId)?.view;
  }

  /**
   * Starts a run, or joins the one its key names (AC-03). The request carries a client key, so a
   * retry after a dropped answer joins the run it started instead of starting another.
   */
  async startRun(fnId: string, args: readonly unknown[], key?: string): Promise<RunView> {
    const transport = this.#transport("Running actions");
    const batches: Batches = await serializeAll([...args], {
      mode: "argument",
      serverFunctionId: (fn: AnyFunction) => serverFunctionId(fn),
    });
    const ck = clientKey();
    let delay = 500;
    for (let attempt = 1; ; attempt++) {
      try {
        const state = await (transport.startRun as NonNullable<Transport["startRun"]>)({
          viewId: this.#viewId,
          fnId,
          args: batches,
          ...(key !== undefined ? { key } : {}),
          clientKey: ck,
        });
        return this.#track(state);
      } catch (error) {
        if (!(error instanceof NetworkError) || attempt >= START_ATTEMPTS) throw error;
        await new Promise((resolve) => this.#setTimeout(() => resolve(undefined), delay));
        delay = Math.min(delay * 2, 8_000);
      }
    }
  }

  /** Finds runs by ID, or by function and key (a reloaded page re-attaching, AC-02). */
  async attach(input: {
    readonly runIds?: readonly string[];
    readonly keyed?: readonly { readonly fnId: string; readonly key: string }[];
  }): Promise<RunView[]> {
    const transport = this.#transport("Running actions");
    // What the page holds of each run already isn't sent again (Opus review 14).
    const held = (input.runIds ?? []).flatMap((runId) => {
      const tracked = this.#runs.get(runId);
      return tracked && (tracked.view.log.length > 0 || tracked.batches.length > 0)
        ? [{ runId, log: tracked.view.log.length, batches: tracked.batches.length }]
        : [];
    });
    const { runs } = await (transport.attachRuns as NonNullable<Transport["attachRuns"]>)({
      viewId: this.#viewId,
      ...(input.runIds && input.runIds.length > 0 ? { runIds: input.runIds } : {}),
      ...(input.keyed && input.keyed.length > 0 ? { keyed: input.keyed } : {}),
      ...(held.length > 0 ? { held } : {}),
    });
    return runs.map((state) => this.#track(state));
  }

  /** Cancels a run (AC-04): its `abortSignal` fires on the server. */
  async cancel(runId: string): Promise<void> {
    const transport = this.#transport("Cancelling actions");
    const state = await (transport.cancelRun as NonNullable<Transport["cancelRun"]>)(
      runId,
      this.#viewId,
    );
    this.#track(state);
  }

  /** Resolves with the run's result once it succeeded; rejects when it failed or was cancelled. */
  settled(runId: string): Promise<unknown> {
    const tracked = this.#runs.get(runId);
    if (!tracked) return Promise.reject(new MostraError("MOSTRA_ACTION_RUN_NOT_FOUND", runId));
    return tracked.settled;
  }

  #newRun(state: RunState): TrackedRun {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const settled = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    settled.catch(() => {});
    return {
      view: {
        runId: state.runId,
        fnId: state.fnId,
        ...(state.key !== undefined ? { key: state.key } : {}),
        status: state.status,
        log: [],
        partial: [],
      },
      batches: [],
      reader: new ValueReader({ serverFunction: (id) => this.reference(id) }),
      rootDecoded: false,
      settled,
      resolve,
      reject,
    };
  }

  /** Merges a full run state: the server's account wins. */
  #track(state: RunState): RunView {
    let tracked = this.#runs.get(state.runId);
    if (!tracked) {
      tracked = this.#newRun(state);
      this.#runs.set(state.runId, tracked);
    }
    this.#merge(tracked, {
      runId: state.runId,
      status: state.status,
      ...(state.reason !== undefined ? { reason: state.reason } : {}),
      ...(state.progress ? { progress: state.progress } : {}),
      logFrom: state.logFrom ?? 0,
      log: state.log,
      batchFrom: state.batchFrom ?? 0,
      batches: state.batches,
      ...(state.error ? { error: state.error } : {}),
      ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    });
    this.#renewSoon();
    return tracked.view;
  }

  /** Applies a run delta; returns `false` when it skipped something the page doesn't have. */
  #merge(tracked: TrackedRun, delta: RunDelta): boolean {
    const view = tracked.view;
    if (delta.logFrom > view.log.length || delta.batchFrom > tracked.batches.length) return false;
    // A final state is final: a late "running" never takes it back.
    if (isFinalRunStatus(view.status) && !isFinalRunStatus(delta.status)) return true;
    const log = [...view.log, ...delta.log.slice(view.log.length - delta.logFrom)];
    const fresh = delta.batches.slice(tracked.batches.length - delta.batchFrom);
    for (const batch of fresh) {
      tracked.batches.push([...batch]);
      try {
        tracked.reader.push(batch);
      } catch (error) {
        tracked.reader.fail(error);
      }
    }
    tracked.view = {
      ...view,
      status: delta.status,
      ...(delta.reason !== undefined ? { reason: delta.reason } : {}),
      ...(delta.progress ? { progress: delta.progress } : {}),
      log,
      ...(delta.error ? { error: delta.error } : {}),
      ...(delta.finishedAt ? { finishedAt: delta.finishedAt } : {}),
    };
    if (fresh.length > 0 && !tracked.rootDecoded) this.#decodeRoot(tracked);
    if (isFinalRunStatus(delta.status)) this.#settle(tracked);
    this.#changed();
    return true;
  }

  #decodeRoot(tracked: TrackedRun): void {
    tracked.rootDecoded = true;
    void tracked.reader.root.then(
      (root) => {
        tracked.view = { ...tracked.view, data: root };
        this.#changed();
        // An async iterable result: its items as they come, for `partial`.
        if (root !== null && typeof root === "object" && Symbol.asyncIterator in root) {
          void (async () => {
            try {
              for await (const item of root as AsyncIterable<unknown>) {
                tracked.view = { ...tracked.view, partial: [...tracked.view.partial, item] };
                this.#changed();
              }
            } catch {
              // The run's own state says what went wrong.
            }
          })();
        }
      },
      () => {},
    );
  }

  /** Settles the run's promise once it reached a final state. */
  #settle(tracked: TrackedRun): void {
    const { status, error } = tracked.view;
    if (status === "succeeded") {
      if (tracked.batches.length === 0) {
        tracked.resolve(undefined);
        return;
      }
      if (!tracked.rootDecoded) this.#decodeRoot(tracked);
      tracked.reader.root.then(tracked.resolve, tracked.reject);
      // Every batch is in: whatever they never settled won't be.
      queueMicrotask(() => {
        if (!tracked.reader.complete) {
          tracked.reader.fail(new RemoteError({ message: "The result ended early." }));
        }
      });
      return;
    }
    const ended =
      status === "cancelled"
        ? (error ?? { code: "MOSTRA_ACTION_CANCELLED", message: "The run was cancelled." })
        : error;
    tracked.reader.fail(new RemoteError(ended ?? { message: "The action failed." }));
    tracked.reject(
      failure(ended, status === "cancelled" ? "MOSTRA_ACTION_CANCELLED" : "MOSTRA_ACTION_THREW"),
    );
  }

  // ── Live sources (D56) ─────────────────────────────────────────────────────────────────

  /** What the page knows of a live source. */
  liveView(key: string): LiveView | undefined {
    return this.#live.get(key)?.view;
  }

  /**
   * Shows a live source: reads it now and keeps it produced while the page shows it. Returns the
   * function that stops showing it.
   */
  watchLive(key: string, window?: number): () => void {
    let tracked = this.#live.get(key);
    if (!tracked) {
      tracked = {
        view: { key, loading: true, ring: [] },
        watchers: new Map(),
        newest: 0,
        ringRevisions: [],
        applying: Promise.resolve(),
      };
      this.#live.set(key, tracked);
    }
    const id = this.#nextWatcher++;
    tracked.watchers.set(id, window);
    this.#flushLive();
    return () => {
      tracked.watchers.delete(id);
    };
  }

  /** Asks the source's producer to load again now (`useLive`'s `refresh()`). */
  refreshLive(key: string): void {
    this.#liveRefresh.add(key);
    this.#flushLive();
  }

  #windowOf(tracked: TrackedLive): number | undefined {
    let largest: number | undefined;
    for (const window of tracked.watchers.values()) {
      if (window !== undefined) largest = Math.max(largest ?? 0, window);
    }
    return largest;
  }

  /** Reads every shown source in one request, coalesced within a tick. */
  #flushLive(): void {
    if (this.#liveFlush) return;
    this.#liveFlush = Promise.resolve().then(async () => {
      this.#liveFlush = undefined;
      const shown = [...this.#live.values()].filter((tracked) => tracked.watchers.size > 0);
      if (shown.length === 0) return;
      const refresh = this.#liveRefresh;
      this.#liveRefresh = new Set();
      let transport: Transport;
      try {
        transport = this.#transport("Live data");
      } catch (error) {
        for (const tracked of shown) {
          const diagnostic = error as MostraError;
          tracked.view = {
            ...tracked.view,
            loading: false,
            error: { message: diagnostic.message, code: diagnostic.code },
          };
        }
        this.#changed();
        return;
      }
      try {
        const { sources } = await (transport.live as NonNullable<Transport["live"]>)({
          viewId: this.#viewId,
          keys: shown.map((tracked) => {
            const window = this.#windowOf(tracked);
            return {
              key: tracked.view.key,
              ...(window !== undefined ? { window } : {}),
              ...(refresh.has(tracked.view.key) ? { refresh: true } : {}),
            };
          }),
        });
        for (const source of sources) await this.#applyLiveState(source);
      } catch (error) {
        for (const tracked of shown) {
          if (tracked.view.revision !== undefined) continue;
          tracked.view = {
            ...tracked.view,
            ...(error instanceof MostraError
              ? { loading: false, error: { message: error.message, code: error.code } }
              : {}),
          };
        }
        this.#changed();
      }
      this.#renewSoon();
    });
  }

  /** Applies `apply` to a source after everything that arrived for it before. */
  #inOrder(key: string, apply: (tracked: TrackedLive) => Promise<void>): Promise<void> {
    const tracked = this.#live.get(key);
    if (!tracked) return Promise.resolve();
    const next = tracked.applying.then(() => apply(tracked)).catch(() => {});
    tracked.applying = next;
    return next;
  }

  #applyLiveState(state: LiveState): Promise<void> {
    return this.#inOrder(state.key, (tracked) => this.#applyLiveStateNow(tracked, state));
  }

  #applyLiveUpdate(update: LiveUpdate): Promise<void> {
    const tracked = this.#live.get(update.key);
    if (!tracked) return Promise.resolve();
    // In latest mode only the newest value shows: one still waiting its turn is replaced, never
    // decoded (Opus review 12). Append mode keeps every value for its ring.
    if (update.value !== undefined && this.#windowOf(tracked) === undefined) {
      const waiting = tracked.pending;
      // Never for an older one arriving late.
      if (!waiting || Number(update.revision ?? 0) > Number(waiting.revision ?? 0)) {
        tracked.pending = update;
      }
      if (waiting) return tracked.applying;
      return this.#inOrder(update.key, async (current) => {
        const next = current.pending;
        delete current.pending;
        if (next) await this.#applyLiveUpdateNow(current, next);
      });
    }
    return this.#inOrder(update.key, (current) => this.#applyLiveUpdateNow(current, update));
  }

  async #applyLiveStateNow(tracked: TrackedLive, state: LiveState): Promise<void> {
    const revision = Number(state.revision ?? 0);
    if (state.ring) {
      const values = await Promise.all(state.ring.map((entry) => decode(entry.value)));
      const revisions = state.ring.map((entry) => Number(entry.revision));
      // A read answered after newer updates arrived keeps them: the ring only moves forward.
      const last = revisions.at(-1) ?? 0;
      const kept = tracked.ringRevisions.flatMap((held, index) =>
        held > last ? [{ revision: held, value: tracked.view.ring[index] }] : [],
      );
      const window = this.#windowOf(tracked);
      const merged = [...values, ...kept.map((entry) => entry.value)];
      const mergedRevisions = [...revisions, ...kept.map((entry) => entry.revision)];
      tracked.ringRevisions =
        window === undefined ? mergedRevisions : mergedRevisions.slice(-window);
      tracked.view = {
        ...tracked.view,
        ring: window === undefined ? merged : merged.slice(-window),
      };
    }
    if (state.value && revision >= tracked.newest) {
      tracked.newest = revision;
      const data = await decode(state.value);
      if (revision < tracked.newest) return;
      tracked.view = {
        ...tracked.view,
        data,
        ...(state.revision !== undefined ? { revision: state.revision } : {}),
        ...(state.at !== undefined ? { at: state.at } : {}),
      };
    }
    tracked.view = {
      ...tracked.view,
      loading: false,
      ...(state.error ? { error: state.error } : {}),
    };
    if (!state.error && tracked.view.error) {
      const { error: _cleared, ...rest } = tracked.view;
      tracked.view = rest;
    }
    this.#changed();
  }

  async #applyLiveUpdateNow(tracked: TrackedLive, update: LiveUpdate): Promise<void> {
    if (update.error && !update.value) {
      tracked.view = { ...tracked.view, loading: false, error: update.error };
      this.#changed();
      return;
    }
    const revision = Number(update.revision ?? 0);
    if (!update.value || revision <= tracked.newest) return;
    // A value skipped (a dropped message): read the source again, ring included.
    const skipped =
      tracked.newest > 0 && revision > tracked.newest + 1 && this.#windowOf(tracked) !== undefined;
    tracked.newest = revision;
    const data = await decode(update.value);
    const window = this.#windowOf(tracked);
    const ring =
      window === undefined ? tracked.view.ring : [...tracked.view.ring, data].slice(-window);
    if (window !== undefined)
      tracked.ringRevisions = [...tracked.ringRevisions, revision].slice(-window);
    const { error: _cleared, ...rest } = tracked.view;
    tracked.view = {
      ...rest,
      loading: false,
      data,
      ring,
      revision: String(revision),
      ...(update.at !== undefined ? { at: update.at } : {}),
    };
    this.#changed();
    if (skipped) this.#flushLive();
  }

  // ── The stream ─────────────────────────────────────────────────────────────────────────

  /** One ephemeral message from the page's stream. */
  receive(message: EphemeralMessage): void {
    if (message.kind === "run") {
      const tracked = this.#runs.get(message.run.runId);
      if (!tracked) return;
      if (!this.#merge(tracked, message.run))
        void this.attach({ runIds: [message.run.runId] }).catch(() => {});
    } else {
      void this.#applyLiveUpdate(message.live);
    }
  }

  /** The stream came back after a gap: read again what may have been missed. */
  resync(): void {
    const open = [...this.#runs.values()].filter(
      (tracked) => !isFinalRunStatus(tracked.view.status),
    );
    if (open.length > 0) {
      void this.attach({ runIds: open.map((tracked) => tracked.view.runId) }).catch(() => {});
    }
    this.#flushLive();
  }

  /** Renews interest in open runs and shown sources before their lease ends. */
  #renewSoon(): void {
    if (this.#renewTimer !== undefined) return;
    this.#renewTimer = this.#setTimeout(() => {
      this.#renewTimer = undefined;
      const open = [...this.#runs.values()].filter(
        (tracked) => !isFinalRunStatus(tracked.view.status),
      );
      const shown = [...this.#live.values()].some((tracked) => tracked.watchers.size > 0);
      if (open.length > 0 || shown) {
        this.resync();
        this.#renewSoon();
      }
    }, RENEW_MS);
  }

  #setTimeout(fn: () => void, ms: number): unknown {
    return this.#options.timers ? this.#options.timers.setTimeout(fn, ms) : setTimeout(fn, ms);
  }

  /** Stops renewing (the page is going away, or a test ends). */
  stop(): void {
    if (this.#renewTimer === undefined) return;
    if (this.#options.timers) this.#options.timers.clearTimeout(this.#renewTimer);
    else clearTimeout(this.#renewTimer as ReturnType<typeof setTimeout>);
    this.#renewTimer = undefined;
  }
}

/** A serialized live value, read back. */
function decode(value: Batches): Promise<unknown> {
  return deserializeAll(value);
}
