/**
 * The client side of team features (D168; CO-03, CO-04): the roster as this page may see it, and
 * who is present with the cursors and selections they share. Both are ephemeral: read on demand,
 * followed through the page's stream, and never journaled or kept. A page that never calls the
 * hooks never asks for either, so it is never sent one.
 *
 * - The roster is read when the first `useRespondents` mounts and every 20 s while one is mounted
 *   (the gateway follows it for a minute), and the stream brings each change between.
 * - Presence starts when the first `usePresence` mounts: the page posts at most 10 updates a second
 *   (the latest wins), every 10 s even when nothing changed, and leaves when the last one unmounts
 *   or the page goes away. Cursor and selection are shared only while a mounted hook asks for them.
 */
import type {
  PresenceCursor,
  PresenceRequest,
  PresenceSelection,
  PresenceState,
  RosterForPage,
} from "@mostra/protocol";
import { MostraError } from "./errors.ts";
import type { Transport } from "./transport.ts";

/** How often the roster is read again while a hook shows it (the gateway follows it a minute). */
export const RESPONDENTS_RENEW_MS = 20_000;

/** How often a present page posts though nothing changed (the gateway keeps it 30 s). */
export const PRESENCE_HEARTBEAT_MS = 10_000;

/** The shortest time between two presence posts: at most 10 a second (the gateway allows 20). */
export const PRESENCE_THROTTLE_MS = 100;

/** Timers, injectable for tests. */
interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What a mounted `usePresence` shares. */
interface Sharing {
  readonly cursor: boolean;
  readonly selection: boolean;
}

/** The page's team state: its roster and its presence. */
export class TeamClient {
  readonly #transport: Transport | undefined;
  readonly #viewId: string | undefined;
  readonly #timers: Timers;
  readonly #listeners = new Set<() => void>();
  #version = 0;

  #roster: RosterForPage | undefined;
  #rosterError: MostraError | undefined;
  #rosterWatchers = 0;
  #rosterTimer: unknown;

  #presence: PresenceState | undefined;
  readonly #sharing = new Map<symbol, Sharing>();
  #cursor: PresenceCursor | null = null;
  #selection: PresenceSelection | null = null;
  /** What the gateway was last told, so an unchanged state is sent only as a heartbeat. */
  #sent: { cursor: string; selection: string } = { cursor: "null", selection: "null" };
  #sendTimer: unknown;
  #heartbeat: unknown;
  #lastSend = 0;
  #inFlight = false;
  #again = false;
  #blockedUntil = 0;
  #stopTracking: (() => void) | undefined;

  constructor(options: {
    readonly transport?: Transport;
    readonly viewId?: string;
    readonly timers?: Timers;
  }) {
    this.#transport = options.transport;
    this.#viewId = options.viewId;
    this.#timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  /** Whether this page can reach the gateway's team routes (a live page; not a static export). */
  get available(): boolean {
    return this.#transport?.respondents !== undefined && this.#viewId !== undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  version = (): number => this.#version;

  #changed(): void {
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }

  // ── The roster ─────────────────────────────────────────────────────────────────────────

  roster(): RosterForPage | undefined {
    return this.#roster;
  }

  rosterError(): MostraError | undefined {
    return this.#rosterError;
  }

  /** A `useRespondents` mounted: reads the roster now and keeps it followed; returns the stop. */
  watchRespondents(): () => void {
    this.#rosterWatchers += 1;
    if (this.#rosterWatchers === 1) void this.#readRoster();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#rosterWatchers -= 1;
      if (this.#rosterWatchers === 0 && this.#rosterTimer !== undefined) {
        this.#timers.clearTimeout(this.#rosterTimer);
        this.#rosterTimer = undefined;
      }
    };
  }

  async #readRoster(): Promise<void> {
    if (this.#rosterTimer !== undefined) this.#timers.clearTimeout(this.#rosterTimer);
    this.#rosterTimer = undefined;
    const transport = this.#transport;
    if (!transport?.respondents || this.#viewId === undefined || this.#rosterWatchers === 0) return;
    try {
      this.#roster = await transport.respondents({ viewId: this.#viewId });
      this.#rosterError = undefined;
    } catch (error) {
      if (error instanceof MostraError) this.#rosterError = error;
    }
    this.#changed();
    if (this.#rosterWatchers > 0) {
      this.#rosterTimer = this.#timers.setTimeout(
        () => void this.#readRoster(),
        RESPONDENTS_RENEW_MS,
      );
    }
  }

  // ── Presence ───────────────────────────────────────────────────────────────────────────

  presence(): PresenceState | undefined {
    return this.#presence;
  }

  /** A `usePresence` mounted with what it shares: joins presence; returns the leave. */
  joinPresence(sharing: Sharing): () => void {
    const id = Symbol("presence");
    this.#sharing.set(id, sharing);
    this.#retrack();
    this.#schedule(0);
    return () => {
      if (!this.#sharing.delete(id)) return;
      this.#retrack();
      if (this.#sharing.size === 0) this.#leave(false);
      else this.#schedule(0);
    };
  }

  #shares(): Sharing {
    let cursor = false;
    let selection = false;
    for (const entry of this.#sharing.values()) {
      cursor ||= entry.cursor;
      selection ||= entry.selection;
    }
    return { cursor, selection };
  }

  /** Follows the pointer and the selection as far as a mounted hook shares them. */
  #retrack(): void {
    this.#stopTracking?.();
    this.#stopTracking = undefined;
    const { cursor, selection } = this.#shares();
    if (!cursor) this.#cursor = null;
    if (!selection) this.#selection = null;
    if (typeof document === "undefined" || this.#sharing.size === 0) return;
    const stops: (() => void)[] = [];
    if (cursor) {
      const move = (event: PointerEvent): void => {
        this.#cursor = { x: Math.round(event.pageX), y: Math.round(event.pageY) };
        this.#schedule();
      };
      const away = (): void => {
        this.#cursor = null;
        this.#schedule();
      };
      document.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", away);
      stops.push(() => {
        document.removeEventListener("pointermove", move);
        document.documentElement.removeEventListener("pointerleave", away);
      });
    }
    if (selection) {
      const read = (): void => {
        this.#selection = selectionNow();
        this.#schedule();
      };
      document.addEventListener("focusin", read);
      document.addEventListener("focusout", read);
      document.addEventListener("selectionchange", read);
      stops.push(() => {
        document.removeEventListener("focusin", read);
        document.removeEventListener("focusout", read);
        document.removeEventListener("selectionchange", read);
      });
    }
    // Leaving with the page: a closed tab is gone at once, not when its lease ends.
    const gone = (): void => this.#leave(true);
    window.addEventListener("pagehide", gone);
    stops.push(() => window.removeEventListener("pagehide", gone));
    this.#stopTracking = () => {
      for (const stop of stops) stop();
    };
  }

  /** Posts soon: at once when the throttle allows, else when it does; the latest state wins. */
  #schedule(delay?: number): void {
    if (!this.#transport?.presence || this.#viewId === undefined || this.#sharing.size === 0)
      return;
    if (this.#sendTimer !== undefined) return;
    const now = Date.now();
    const wait = Math.max(
      delay ?? 0,
      this.#lastSend + PRESENCE_THROTTLE_MS - now,
      this.#blockedUntil - now,
      0,
    );
    this.#sendTimer = this.#timers.setTimeout(() => {
      this.#sendTimer = undefined;
      void this.#send();
    }, wait);
  }

  async #send(): Promise<void> {
    const transport = this.#transport;
    if (!transport?.presence || this.#viewId === undefined || this.#sharing.size === 0) return;
    if (this.#inFlight) {
      this.#again = true;
      return;
    }
    this.#inFlight = true;
    this.#lastSend = Date.now();
    const cursor = JSON.stringify(this.#cursor);
    const selection = JSON.stringify(this.#selection);
    const request: PresenceRequest = {
      viewId: this.#viewId,
      ...(cursor !== this.#sent.cursor ? { cursor: this.#cursor } : {}),
      ...(selection !== this.#sent.selection ? { selection: this.#selection } : {}),
    };
    try {
      this.#presence = await transport.presence(request);
      this.#sent = { cursor, selection };
      this.#changed();
    } catch (error) {
      // Past the rate, wait as the gateway says; a network failure tries again at the heartbeat.
      if (error instanceof MostraError && error.code === "MOSTRA_TEAM_PRESENCE_RATE_LIMITED") {
        this.#blockedUntil = Date.now() + 1_000;
        this.#again = true;
      }
    } finally {
      this.#inFlight = false;
    }
    if (this.#heartbeat !== undefined) this.#timers.clearTimeout(this.#heartbeat);
    this.#heartbeat =
      this.#sharing.size > 0
        ? this.#timers.setTimeout(() => this.#schedule(0), PRESENCE_HEARTBEAT_MS)
        : undefined;
    if (
      this.#again ||
      JSON.stringify(this.#cursor) !== this.#sent.cursor ||
      JSON.stringify(this.#selection) !== this.#sent.selection
    ) {
      this.#again = false;
      this.#schedule();
    }
  }

  #leave(closing: boolean): void {
    for (const timer of [this.#sendTimer, this.#heartbeat]) {
      if (timer !== undefined) this.#timers.clearTimeout(timer);
    }
    this.#sendTimer = undefined;
    this.#heartbeat = undefined;
    this.#sent = { cursor: "null", selection: "null" };
    const transport = this.#transport;
    if (!transport?.presence || this.#viewId === undefined) return;
    void transport
      .presence({ viewId: this.#viewId, leave: true }, { keepalive: closing })
      .catch(() => undefined);
    if (!closing) {
      this.#presence = undefined;
      this.#changed();
    }
  }

  /** The stream reconnected: read the roster again and post presence, since messages were lost. */
  resync(): void {
    if (this.#rosterWatchers > 0) void this.#readRoster();
    if (this.#sharing.size > 0) this.#schedule(0);
  }

  /** One ephemeral message of the page's stream. */
  receive(
    message:
      | { readonly kind: "respondents"; readonly respondents: RosterForPage }
      | {
          readonly kind: "presence";
          readonly presence: PresenceState;
        },
  ): void {
    if (message.kind === "respondents") {
      if (this.#rosterWatchers === 0) return;
      this.#roster = message.respondents;
    } else {
      if (this.#sharing.size === 0) return;
      this.#presence = message.presence;
    }
    this.#changed();
  }

  stop(): void {
    this.#stopTracking?.();
    for (const timer of [this.#sendTimer, this.#heartbeat, this.#rosterTimer]) {
      if (timer !== undefined) this.#timers.clearTimeout(timer);
    }
  }
}

/**
 * The viewer's selection as presence shares it: the focused element's `data-presence-id`, `id` or
 * `name` (the nearest one that has one), and in a text input its selected range.
 */
function selectionNow(): PresenceSelection | null {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  const named = active.closest("[data-presence-id]");
  const element =
    named?.getAttribute("data-presence-id") ??
    (active.id !== "" ? active.id : undefined) ??
    active.getAttribute("name") ??
    undefined;
  if (element === undefined || element === "") return null;
  const input = active as HTMLInputElement | HTMLTextAreaElement;
  const range =
    typeof input.selectionStart === "number" && typeof input.selectionEnd === "number"
      ? { start: input.selectionStart, end: input.selectionEnd }
      : {};
  return { element: element.slice(0, 256), ...range };
}
