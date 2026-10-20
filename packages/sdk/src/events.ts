/**
 * Events as an async iterator (IN-08, D101): pages from `events/subscribe`, in cursor order. A
 * consumer that falls behind pauses the subscription instead of buffering without bound or
 * stalling the connection's other calls: past `highWaterMark` pages it unsubscribes, and once it
 * has caught up it subscribes again after the last cursor it received, so nothing is missed or
 * repeated. With a `name`, a page is acknowledged (`events/ack`) when the next one is asked for,
 * which is when the consumer has handled it; a stream of the same name later resumes there.
 */
import {
  createDiagnostic,
  type Diagnostic,
  type EventFilter,
  type EventRecord,
  EventsNotifyParams,
  eventsAckMethod,
  eventsSubscribeMethod,
  eventsUnsubscribeMethod,
  type MethodDefinition,
  RpcError,
} from "@mostra/protocol";

/** One page of events. */
export interface EventPage {
  /** The events, in cursor order. */
  readonly events: readonly EventRecord[];
  /** Everything up to this cursor was examined: the cursor to resume after. */
  readonly cursor: string;
  /** Set when compaction removed events in this range (`MOSTRA_HOST_CURSOR_COMPACTED`). */
  readonly compacted?: Diagnostic;
}

/** Options of a stream. */
export interface EventStreamOptions {
  /** Which events: artifacts and type patterns. Default: every event. */
  readonly filter?: EventFilter;
  /** Start after this cursor. Default: a named stream's acknowledged cursor, else now. */
  readonly after?: string;
  /** A durable subscriber name: pages are acknowledged under it as they are handled. */
  readonly name?: string;
  /** Pages held before the subscription pauses. Default 16. */
  readonly highWaterMark?: number;
  /** Ends the stream. */
  readonly signal?: AbortSignal;
}

/** What a stream needs of the session. */
export interface EventSession {
  call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R>;
  /** Registers a handler for `events/notify`; returns its removal. */
  onNotification(handler: (params: unknown) => void): () => void;
  /** Resolves when the session ends. */
  readonly closed: Promise<void>;
}

/** Opens a stream; nothing is subscribed until the first page is asked for. */
export function openEventStream(
  session: EventSession,
  options: EventStreamOptions,
): AsyncIterable<EventPage> {
  return {
    [Symbol.asyncIterator]: () => new EventStream(session, options),
  };
}

class EventStream implements AsyncIterator<EventPage> {
  readonly #session: EventSession;
  readonly #options: EventStreamOptions;
  readonly #high: number;
  readonly #queue: EventPage[] = [];
  #subscription: string | undefined;
  /** The cursor of the last page received, where a resumed subscription starts. */
  #received: string | undefined;
  /** The cursor of the last page handed out; handled once the next page is asked for. */
  #handedOut: string | undefined;
  /** The cursor of the last page the consumer handled, and of the last acknowledged. */
  #handled: string | undefined;
  #acked: string | undefined;
  #paused = false;
  /**
   * Pages that arrived while a subscribe was in flight, for a subscription not known yet: the
   * answer and its first page can reach the session in one chunk, and the page is dispatched
   * before the code awaiting the answer resumes. Kept until the answer names its ID.
   */
  #early: EventsNotifyParams[] | undefined;
  /** The unsubscribe of a pause; its answer means no page of that subscription follows. */
  #pausing: Promise<void> | undefined;
  /** A subscribe whose answer is on its way (`#subscribe`). */
  #subscribing: Promise<void> | undefined;
  #started = false;
  #ended: { error?: unknown } | undefined;
  #wake: (() => void) | undefined;
  readonly #removeHandler: () => void;

  constructor(session: EventSession, options: EventStreamOptions) {
    this.#session = session;
    this.#options = options;
    this.#high = Math.max(1, options.highWaterMark ?? 16);
    this.#removeHandler = session.onNotification((params) => this.#receive(params));
    void session.closed.then(() =>
      this.#end(
        new RpcError(
          createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
            message: "The Mostra instance exited while its events were being read.",
          }),
        ),
      ),
    );
    options.signal?.addEventListener("abort", () => void this.return(), { once: true });
  }

  #receive(params: unknown): void {
    const parsed = EventsNotifyParams.safeParse(params);
    if (!parsed.success) return;
    if (parsed.data.subscriptionId !== this.#subscription) {
      this.#early?.push(parsed.data);
      return;
    }
    this.#accept(parsed.data);
  }

  #accept({ events, cursor, compacted }: EventsNotifyParams): void {
    this.#queue.push({ events, cursor, ...(compacted ? { compacted } : {}) });
    this.#received = cursor;
    if (this.#queue.length >= this.#high && !this.#paused) this.#pausing = this.#pause();
    this.#wake?.();
  }

  /**
   * Subscribes after `after`. While the answer is on its way the call is `#subscribing`, so
   * `return()` can wait for it and end the subscription it names (GPT review finding 5).
   */
  #subscribe(after: string | undefined): Promise<void> {
    const opening = this.#open(after);
    this.#subscribing = opening;
    return opening.finally(() => {
      if (this.#subscribing === opening) this.#subscribing = undefined;
    });
  }

  async #open(after: string | undefined): Promise<void> {
    this.#early = [];
    let answer: { subscriptionId: string; cursor: string };
    let early: EventsNotifyParams[];
    try {
      answer = await this.#session.call(eventsSubscribeMethod, {
        ...(this.#options.filter ? { filter: this.#options.filter } : {}),
        ...(after !== undefined ? { after } : {}),
        ...(this.#options.name ? { name: this.#options.name } : {}),
      });
    } finally {
      early = this.#early;
      this.#early = undefined;
    }
    // Synchronous from here: no page can be dispatched before the ID is known.
    this.#subscription = answer.subscriptionId;
    this.#received ??= answer.cursor;
    // The pages of this subscription that came before its answer was handled, in order.
    for (const page of early) if (page.subscriptionId === answer.subscriptionId) this.#accept(page);
  }

  async #pause(): Promise<void> {
    this.#paused = true;
    const id = this.#subscription;
    if (id === undefined) return;
    // What the consumer handled is acknowledged while the subscription still exists: the ack goes
    // out before the unsubscribe on the connection, which keeps their order.
    const acked = this.#sendAck(id);
    // Pages already on their way still arrive under this ID and are kept. The answer comes after
    // them on the connection, so once it is here the subscription is over.
    await this.#session
      .call(eventsUnsubscribeMethod, { subscriptionId: id })
      .catch(() => undefined);
    await acked;
    if (this.#subscription === id) this.#subscription = undefined;
  }

  async #resume(): Promise<void> {
    await this.#pausing;
    this.#pausing = undefined;
    this.#paused = false;
    await this.#subscribe(this.#received);
  }

  /**
   * Acknowledges what the consumer handled under subscription `id`, if a named stream has handled
   * more than it acknowledged. The line is written when this is called (the session writes each
   * call at once), so it is ordered before anything sent after it.
   */
  #sendAck(id: string): Promise<void> {
    const cursor = this.#handled;
    if (!this.#options.name || cursor === undefined || cursor === this.#acked)
      return Promise.resolve();
    this.#acked = cursor;
    return this.#session
      .call(eventsAckMethod, { subscriptionId: id, cursor })
      .then(() => undefined);
  }

  #end(error?: unknown): void {
    if (this.#ended) return;
    this.#ended = error === undefined ? {} : { error };
    this.#removeHandler();
    this.#wake?.();
  }

  async next(): Promise<IteratorResult<EventPage>> {
    if (!this.#started) {
      this.#started = true;
      await this.#subscribe(this.#options.after);
    }
    // Asking for the next page means the consumer handled the one before it.
    if (this.#handedOut !== undefined) this.#handled = this.#handedOut;
    if (this.#paused && !this.#ended && this.#queue.length <= this.#high / 2) await this.#resume();
    // Never under a subscription being paused: its unsubscribe may already be on its way, and
    // the pause acknowledges what was handled before it.
    if (!this.#paused && this.#subscription !== undefined) await this.#sendAck(this.#subscription);
    for (;;) {
      const page = this.#queue.shift();
      if (page !== undefined) {
        this.#handedOut = page.cursor;
        return { done: false, value: page };
      }
      if (this.#ended) {
        if (this.#ended.error !== undefined) throw this.#ended.error;
        return { done: true, value: undefined };
      }
      if (this.#paused) {
        await this.#resume();
        await this.#sendAck(this.#subscription as string);
      }
      await new Promise<void>((done) => {
        this.#wake = done;
      });
      this.#wake = undefined;
    }
  }

  /**
   * Ends the stream: the subscription ends, and a named stream acknowledges every page the
   * consumer handled, never the last one handed out (the loop may have stopped inside it).
   */
  async return(): Promise<IteratorResult<EventPage>> {
    this.#end();
    this.#queue.length = 0;
    await this.#pausing;
    // A subscribe on its way names a subscription that exists on the instance once it is
    // answered: wait for it, so it is ended below like any other.
    await this.#subscribing?.catch(() => undefined);
    const id = this.#subscription;
    if (id !== undefined) {
      this.#subscription = undefined;
      const acked = this.#sendAck(id);
      await this.#session
        .call(eventsUnsubscribeMethod, { subscriptionId: id })
        .catch(() => undefined);
      await acked.catch(() => undefined);
    } else if (this.#options.name && this.#handled !== undefined && this.#handled !== this.#acked) {
      // Paused when it ended, with pages handled since: a subscription of the name, just long
      // enough to acknowledge them (its pages are ignored; the handler is gone).
      await this.#subscribe(this.#received).catch(() => undefined);
      const again = this.#subscription;
      if (again !== undefined) {
        this.#subscription = undefined;
        const acked = this.#sendAck(again);
        await this.#session
          .call(eventsUnsubscribeMethod, { subscriptionId: again })
          .catch(() => undefined);
        await acked.catch(() => undefined);
      }
    }
    return { done: true, value: undefined };
  }
}
