/**
 * The daemon's idle exit (D62, RT-08): a daemon keeps running while it has open views, pending
 * deliveries, running action runs, live producers, host subscriptions or attached clients, and
 * otherwise exits after 30 idle minutes. A host-spawned instance lives exactly as long as its
 * stdio, and a daemon started `--always-on` (the login service) never exits for lack of work.
 */

/** What keeps a daemon running, as counts; any non-zero one is work. */
export type Busy = () => Readonly<Record<string, number>>;

/** The default idle time before a daemon exits. */
export const IDLE_EXIT_MS: number = 30 * 60_000;

/** The idle watch. */
export interface IdleWatch {
  /** When the daemon exits if nothing happens, or `undefined` while it's busy or never exits. */
  exitAt(): string | undefined;
  stop(): void;
}

/** Options for {@link watchIdle}. */
export interface IdleOptions {
  readonly busy: Busy;
  /** Called once, when the daemon has been idle for `idleMs`. */
  readonly onIdle: () => void;
  readonly idleMs?: number;
  /** How often the counts are read; default 5 s, or a tenth of `idleMs` when that is shorter. */
  readonly checkMs?: number;
  readonly now?: () => number;
}

/** Starts watching; the daemon exits through `onIdle` once nothing has kept it for `idleMs`. */
export function watchIdle(options: IdleOptions): IdleWatch {
  const idleMs = options.idleMs ?? IDLE_EXIT_MS;
  const now = options.now ?? Date.now;
  let idleSince: number | undefined = now();
  let fired = false;
  const check = (): void => {
    const counts = options.busy();
    const busy = Object.values(counts).some((count) => count > 0);
    if (busy) {
      idleSince = undefined;
      return;
    }
    idleSince ??= now();
    if (!fired && now() - idleSince >= idleMs) {
      fired = true;
      options.onIdle();
    }
  };
  const timer = setInterval(check, options.checkMs ?? Math.min(5_000, Math.max(50, idleMs / 10)));
  timer.unref?.();
  return {
    exitAt() {
      check();
      return idleSince === undefined || fired
        ? undefined
        : new Date(idleSince + idleMs).toISOString();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
