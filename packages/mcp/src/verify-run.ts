/**
 * `artifact_verify` within a tool call's time (#157, D175 item 10). Verify can take minutes, and
 * MCP clients end a call long before (a chat host after about a minute), leaving an agent with
 * only a timeout. So a call waits at most {@link VERIFY_ANSWER_MS} for the verdict and otherwise
 * answers `{ status: "running", stage, elapsedSeconds }`; the same call again joins the run under
 * way, never starting a second, and waits again.
 *
 * Runs are kept here, outside any one server instance: over Streamable HTTP each request builds
 * its own server, so the call that joins arrives in another one. They are keyed by the instance
 * the tools act on (`McpServerOptions.scope`), the artifact's directory and the screenshots asked
 * for. A run ends in one of two ways: answered to a call waiting when it ends, then forgotten; or
 * ending while no call waits, kept for the next call (which asked for it by asking again), and
 * forgotten after {@link VERIFY_KEPT_MS} if none comes.
 */

/** How long one call waits for the verdict before it answers that verify is still running. */
export const VERIFY_ANSWER_MS: number = 45_000;
/** How long a verdict no call has collected yet is kept for the call that asks again. */
export const VERIFY_KEPT_MS: number = 10 * 60_000;

/** What a call answers. */
export type VerifyAnswer<V> =
  | { readonly done: true; readonly verdict: V }
  | { readonly done: false; readonly stage?: string; readonly elapsedSeconds: number };

/** One run under way, or ended and not yet collected. */
interface Run<V> {
  readonly started: number;
  stage?: string;
  /** The waiting calls' listeners, told each stage as it starts. */
  readonly listeners: Set<(stage: string) => void>;
  /** Settles with the run: its verdict, or its failure. */
  readonly ended: Promise<{ ok: true; verdict: V } | { ok: false; error: unknown }>;
  /** Calls waiting on it now. */
  waiting: number;
  /** Set once it ended with no call waiting: the timer that forgets it. */
  forget?: ReturnType<typeof setTimeout>;
}

const runs = new Map<string, Run<unknown>>();

/** The runs kept now, for tests. */
export function verifyRunsKept(): number {
  return runs.size;
}

/**
 * Answers one call: joins the run of `key`, or starts one with `start` (which reports stages to
 * `stage`), and waits for it at most `waitMs`. A run's failure is thrown to the call that sees it.
 */
export async function verifyWithin<V>(
  key: string,
  start: (stage: (name: string) => void) => Promise<V>,
  options: {
    readonly waitMs?: number;
    readonly now?: () => number;
    /** Told each stage that starts while this call waits (a progress notification). */
    readonly onStage?: (stage: string) => void;
  } = {},
): Promise<VerifyAnswer<V>> {
  const now = options.now ?? Date.now;
  let run = runs.get(key) as Run<V> | undefined;
  let begin: (() => void) | undefined;
  if (run === undefined) {
    // The run exists, and this call waits on it, before it starts: a stage may be reported at
    // once, inside `start`.
    let settle!: (outcome: { ok: true; verdict: V } | { ok: false; error: unknown }) => void;
    const created: Run<V> = {
      started: now(),
      ended: new Promise((resolve) => {
        settle = resolve;
      }),
      waiting: 0,
      listeners: new Set(),
    };
    runs.set(key, created as Run<unknown>);
    run = created;
    const stage = (name: string): void => {
      created.stage = name;
      for (const listener of created.listeners) listener(name);
    };
    begin = () => {
      let started: Promise<V>;
      try {
        started = start(stage);
      } catch (error) {
        started = Promise.reject(error);
      }
      started.then(
        (verdict) => settle({ ok: true, verdict }),
        (error: unknown) => settle({ ok: false, error }),
      );
    };
  }
  const current = run;
  if (current.forget !== undefined) {
    clearTimeout(current.forget);
    delete current.forget;
  }
  current.waiting += 1;
  const listener = options.onStage;
  if (listener !== undefined) current.listeners.add(listener);
  begin?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"waiting">((resolve) => {
    timer = setTimeout(() => resolve("waiting"), options.waitMs ?? VERIFY_ANSWER_MS);
  });
  try {
    const outcome = await Promise.race([current.ended, timeout]);
    if (outcome === "waiting") {
      return {
        done: false,
        ...(current.stage !== undefined ? { stage: current.stage } : {}),
        elapsedSeconds: Math.round((now() - current.started) / 1000),
      };
    }
    // This call collects the run: the next call starts afresh.
    if (runs.get(key) === current) runs.delete(key);
    if (!outcome.ok) throw outcome.error;
    return { done: true, verdict: outcome.verdict };
  } finally {
    clearTimeout(timer);
    if (listener !== undefined) current.listeners.delete(listener);
    current.waiting -= 1;
    // The last waiter left a run no call collected: once it ends, it is kept for the call that
    // asks again, for a while. (Every run has a waiter at first, the call that started it.)
    if (current.waiting === 0 && runs.get(key) === current) {
      void current.ended.then(() => {
        if (current.waiting > 0 || runs.get(key) !== current || current.forget !== undefined) {
          return;
        }
        current.forget = setTimeout(() => {
          if (runs.get(key) === current) runs.delete(key);
        }, VERIFY_KEPT_MS);
        current.forget.unref?.();
      });
    }
  }
}
