"use client";

/**
 * Server functions and live data in the page (INTERFACES §2.3, D54, D56): `useAction` turns calls
 * of a `"use server"` function into durable action runs, and `useLive` reads a live source. Both
 * share the page's runtime, its view and its event stream, so a run started in one tab or before a
 * reload is followed the same way, and every component showing one source shares one value.
 */
import { isFinalRunStatus, type RunProgress, type RunStatus } from "@mostra/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "./hooks.ts";
import { MostraError } from "./runtime/errors.ts";
import { serverFunctionId } from "./runtime/server-client.ts";

// ── useAction ─────────────────────────────────────────────────────────────────────────────

/** What `useAction` shows of its run (INTERFACES §2.3). */
export interface ActionHandle<A extends unknown[], R> {
  /**
   * Runs the action: a durable run (D24) whose result this resolves with, or whose failure it
   * rejects with as a `MostraError`. While this hook's run is in flight, another call joins it; with
   * a `key`, every call anywhere joins the one run of that key, so it happens at most once.
   */
  run(...args: A): Promise<R>;
  /**
   * `idle` before any run, then the run's state. `waiting` is reserved for a run waiting for its
   * owner's instance (a hosted artifact, WP-28).
   */
  readonly status: "idle" | RunStatus;
  /** Whether a run is starting or in flight. */
  readonly isPending: boolean;
  /** The result, once the run succeeded. */
  readonly data?: R;
  /** Why the run failed, was cancelled or couldn't start. */
  readonly error?: { readonly code: string; readonly message: string };
  /** The run's latest progress (`progress()` in the action). */
  readonly progress?: RunProgress;
  /** The run's log lines (`log()` and the console in the action), capped at 1 MB. */
  readonly log: readonly string[];
  /** For an action that returns an async iterable: the items it yielded so far. */
  readonly partial: readonly (R extends AsyncIterable<infer T> ? T : unknown)[];
  /** Cancels the run: the action's `abortSignal` fires (AC-04). */
  cancel(): void;
  /** The run's `run_` ID, once it has one. */
  readonly runId?: string;
}

const NO_LOG: readonly string[] = [];

/** What `useAction` knows of one function and key. */
interface IdentityState {
  readonly runId?: string | undefined;
  readonly starting: boolean;
  readonly startError?: { code: string; message: string } | undefined;
}

const IDLE: IdentityState = { starting: false };
const NO_STATES: ReadonlyMap<string, IdentityState> = new Map();

/**
 * Runs a `"use server"` function as durable action runs (D24, D54): each call is recorded before
 * it runs, streams progress, log lines and partial results, survives the tab closing, and is
 * found again after a reload. Without a `key`, a call while this hook's run is in flight joins it,
 * so a double click runs once; with a `key`, the run of that key happens at most once across
 * clicks, tabs, reloads and devices, and a page that opens later shows it.
 *
 * ```tsx
 * const send = useAction(sendReply, { key: `send.${message.id}` });
 * <button disabled={send.isPending || send.status === "succeeded"} onClick={() => send.run(message.id, reply)}>
 *   {send.status === "succeeded" ? "Sent" : (send.progress?.message ?? "Send")}
 * </button>
 * ```
 */
export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options?: { readonly key?: string },
): ActionHandle<A, Awaited<R>> {
  const store = useStore();
  const server = store.server;
  const fnId = serverFunctionId(fn);
  const key = options?.key;
  // Everything the hook knows belongs to one function and key: a component that changes either
  // shows the new one's run, never the old one's, and a late answer for the old one lands under
  // the old identity, where the hook no longer looks.
  const identity = `${fnId ?? ""}\u0000${key ?? ""}`;
  const [states, setStates] = useState<ReadonlyMap<string, IdentityState>>(NO_STATES);
  const current = states.get(identity) ?? IDLE;
  const { runId, starting, startError } = current;
  const update = useCallback((of: string, patch: Partial<IdentityState>): void => {
    setStates((previous) => {
      const next = new Map(previous);
      next.set(of, { ...(previous.get(of) ?? IDLE), ...patch });
      return next;
    });
  }, []);
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  useSyncExternalStore(server.subscribe, server.version, server.version);

  // A keyed run started earlier, in another tab or before a reload, is shown again (AC-02).
  useEffect(() => {
    if (key === undefined || fnId === undefined || store.mode !== "live") return;
    let active = true;
    server.attach({ keyed: [{ fnId, key }] }).then(
      (runs) => {
        const [found] = runs;
        if (active && found) update(identity, { runId: found.runId });
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [server, store.mode, fnId, key, identity, update]);

  const view = runId === undefined ? undefined : server.run(runId);

  const run = useCallback(
    (...args: A): Promise<Awaited<R>> => {
      if (fnId === undefined) {
        return Promise.reject(
          new TypeError(
            'useAction needs a server function: import it from a module that starts with "use server".',
          ),
        );
      }
      // One run in flight per hook instance and function and key (D54): a second click joins it.
      const joined = inFlight.current.get(identity);
      if (joined) return joined as Promise<Awaited<R>>;
      update(identity, { starting: true, startError: undefined });
      const started = (async () => {
        let state: Awaited<ReturnType<typeof server.startRun>>;
        try {
          state = await server.startRun(fnId, args, key);
        } catch (error) {
          // The run never started (a refused link, a parked worker, the network): say why.
          update(identity, {
            starting: false,
            startError:
              error instanceof MostraError
                ? { code: error.code, message: error.message }
                : { code: "MOSTRA_ACTION_THREW", message: (error as Error).message },
          });
          throw error;
        }
        update(identity, { starting: false, runId: state.runId });
        return server.settled(state.runId);
      })();
      inFlight.current.set(identity, started);
      const settle = (): void => {
        if (inFlight.current.get(identity) === started) inFlight.current.delete(identity);
      };
      started.then(settle, settle);
      return started as Promise<Awaited<R>>;
    },
    [server, fnId, key, identity, update],
  );

  const cancel = useCallback(() => {
    if (runId === undefined) return;
    const current = server.run(runId);
    if (current && !isFinalRunStatus(current.status)) void server.cancel(runId).catch(() => {});
  }, [server, runId]);

  return useMemo(() => {
    const status: ActionHandle<A, Awaited<R>>["status"] = view?.status ?? "idle";
    const error =
      view?.error && (view.status === "failed" || view.status === "cancelled")
        ? { code: view.error.code ?? "MOSTRA_ACTION_THREW", message: view.error.message }
        : view?.status === "cancelled"
          ? { code: "MOSTRA_ACTION_CANCELLED", message: "The run was cancelled." }
          : startError;
    return {
      run,
      cancel,
      status,
      isPending: starting || status === "queued" || status === "running" || status === "waiting",
      ...(view?.status === "succeeded" && view.data !== undefined
        ? { data: view.data as Awaited<R> }
        : {}),
      ...(error ? { error } : {}),
      ...(view?.progress ? { progress: view.progress } : {}),
      log: view?.log ?? NO_LOG,
      partial: (view?.partial ?? []) as ActionHandle<A, Awaited<R>>["partial"],
      ...(runId !== undefined ? { runId } : {}),
    };
  }, [run, cancel, view, starting, startError, runId]);
}

// ── useLive ───────────────────────────────────────────────────────────────────────────────

/**
 * The live sources of the artifact, by key, with their value types. A generated declaration
 * (`mostra-env.d.ts`, written by `mostra new`) fills it from `live.ts`:
 *
 * ```ts
 * declare module "@mostra/react" {
 *   interface LiveSources extends LiveValuesOf<typeof import("./live")> {}
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by each artifact's declaration.
export interface LiveSources {}

/** The value types of a `live.ts` module's sources, by export name (D56). */
export type LiveValuesOf<M> = {
  [K in keyof M as M[K] extends { readonly "~mostra.live": unknown } ? K : never]: M[K] extends {
    readonly __value?: infer T;
  }
    ? T
    : never;
};

/** A live source's key: one of `LiveSources`, or any string before the declaration exists. */
export type LiveKey = [keyof LiveSources] extends [never] ? string : keyof LiveSources & string;

/** A live source's value type. */
export type LiveValue<K extends string> = K extends keyof LiveSources ? LiveSources[K] : unknown;

/** What `useLive` shows (INTERFACES §2.3). */
export interface LiveResult<T> {
  /** The latest value; in append mode, the values kept, oldest first. */
  readonly data: T | undefined;
  /** Whether no value has arrived yet. */
  readonly isLoading: boolean;
  /** The producer's last failure; the last good value stays in `data` (FAILURE_MODEL §6). */
  readonly error?: Error;
  /** Asks the producer to load again now. */
  refresh(): void;
  /** The value's revision, which only grows. */
  readonly revision?: string;
  /** When the value was produced. */
  readonly at?: string;
}

/** How long append mode keeps values without a `window`. */
const DEFAULT_WINDOW = 1024;

/**
 * Reads a live source of `live.ts`, or one an agent or host pushes to (D56): the latest value, or
 * in append mode the recent values for a high-rate chart. The value is shared by every component
 * that shows it and updates without a reload; nothing of it is a durable event (D63).
 *
 * ```tsx
 * const { data, isLoading, error } = useLive("inbox");
 * const { data: points } = useLive("cpu", { mode: "append", window: 600 });
 * ```
 */
export function useLive<K extends LiveKey>(
  key: K,
  options: { readonly mode: "append"; readonly window?: number },
): LiveResult<LiveValue<K>[]>;
/** Reads a live source's latest value (D56). See the first signature. */
export function useLive<K extends LiveKey>(
  key: K,
  options?: { readonly mode?: "latest"; readonly window?: number },
): LiveResult<LiveValue<K>>;
export function useLive<K extends LiveKey>(
  key: K,
  options?: { readonly mode?: "latest" | "append"; readonly window?: number },
): LiveResult<unknown> {
  const store = useStore();
  const server = store.server;
  const append = options?.mode === "append";
  const window = append ? (options?.window ?? DEFAULT_WINDOW) : undefined;
  useSyncExternalStore(server.subscribe, server.version, server.version);
  useEffect(() => server.watchLive(key, window), [server, key, window]);
  const view = server.liveView(key);
  const refresh = useCallback(() => server.refreshLive(key), [server, key]);
  return useMemo(() => {
    const data = append
      ? view?.ring.length
        ? view.ring.slice(-(window ?? 0))
        : undefined
      : view?.data;
    return {
      data,
      isLoading: data === undefined && (view?.loading ?? true),
      ...(view?.error
        ? {
            error: new MostraError(
              view.error.code ?? "MOSTRA_LIVE_SOURCE_FAILED",
              view.error.message,
            ),
          }
        : {}),
      refresh,
      ...(view?.revision !== undefined ? { revision: view.revision } : {}),
      ...(view?.at !== undefined ? { at: view.at } : {}),
    };
  }, [view, append, window, refresh]);
}
