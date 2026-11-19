/**
 * The directory's sweep of what sign-in leaves behind (MT-06, DATA_MODEL §7.1): the API origin's
 * browser sessions once they expired, sign-ins in progress (`signin` records past their 15 minutes,
 * device codes past their 10), authorization codes once their replay window passed (a code shown a
 * second time revokes the grant its first showing made, D167 item 22, so a spent or expired code is
 * kept for an hour after its expiry), and access and refresh tokens past their expiry, which nothing
 * reads again. The directory then keeps only live ones.
 *
 * It runs on a timer of its own, never inside a request that reads these rows: every read checks a
 * row's expiry itself, so a row the sweep hasn't reached yet is already refused. A sweep that finds
 * nothing changes no page, so an idle server's directory takes no write from it (MT-05).
 */
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { CODE_KEPT_MS } from "./auth.ts";

/** How often the sweep runs: hourly, so an expired row lingers an hour at most. */
const SWEEP_MS: number = 60 * 60 * 1000;

/** What one sweep removed, by kind. */
export interface Swept {
  readonly sessions: number;
  readonly signins: number;
  readonly tokens: number;
}

/** Removes every expired sign-in session, sign-in in progress, spent code and expired token. */
export function sweepSignIns(directory: Ledger, now: number): Swept {
  const at = new Date(now).toISOString();
  const codesBefore = new Date(now - CODE_KEPT_MS).toISOString();
  return directory.write((db) => ({
    sessions: db.run("DELETE FROM browser_session WHERE expires_at <= ?", at).changes,
    signins: db.run("DELETE FROM signin WHERE expires_at <= ?", at).changes,
    tokens:
      db.run("DELETE FROM token WHERE kind = 'code' AND expires_at <= ?", codesBefore).changes +
      db.run(
        "DELETE FROM token WHERE kind IN ('device', 'access', 'refresh') AND expires_at <= ?",
        at,
      ).changes,
  }));
}

/** Runs the sweep at start and every `everyMs`; the timer never holds the process open. */
export function startSweep(options: {
  readonly directory: Ledger;
  readonly log: Log;
  readonly everyMs?: number;
  readonly now?: () => number;
}): { stop(): void } {
  const now = options.now ?? (() => Date.now());
  const run = (): void => {
    try {
      const swept = sweepSignIns(options.directory, now());
      if (swept.sessions + swept.signins + swept.tokens > 0) {
        options.log.info("server.swept", { ...swept });
      }
    } catch (error) {
      options.log.warn("server.sweep_failed", { error });
    }
  };
  run();
  const timer = setInterval(run, options.everyMs ?? SWEEP_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
