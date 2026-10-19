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
  /** The cursor of the last page handed out, acknowledged when the next is asked for. */
  #toAck: string | undefined;
  #paused = false;
  /** The unsubscribe of a pause; its answer means no page of that subscription follows. */
  #pausing: Promise<void> | undefined;
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
    if (!parsed.success || parsed.data.subscriptionId !== this.#subscription) return;
    const { events, cursor, compacted } = parsed.data;
    this.#queue.push({ events, cursor, ...(compacted ? { compacted } : {}) });
    this.#received = cursor;
    if (this.#queue.length >= this.#high && !this.#paused) this.#pausing = this.#pause();
    this.#wake?.();
  }

  async #subscribe(after: string | undefined): Promise<void> {
    const { subscriptionId, cursor } = await this.#session.call(eventsSubscribeMethod, {
      ...(this.#options.filter ? { filter: this.#options.filter } : {}),
      ...(after !== undefined ? { after } : {}),
      ...(this.#options.name ? { name: this.#options.name } : {}),
    });
    this.#subscription = subscriptionId;
    this.#received ??= cursor;
  }

  async #pause(): Promise<void> {
    this.#paused = true;
    const id = this.#subscription;
    if (id === undefined) return;
    // Pages already on their way still arrive under this ID and are kept. The answer comes after
    // them on the connection, so once it is here the subscription is over.
    await this.#session
      .call(eventsUnsubscribeMethod, { subscriptionId: id })
      .catch(() => undefined);
    // An acknowledgement waiting meanwhile goes out under the next subscription of the name.
    if (this.#subscription === id) this.#subscription = undefined;
  }

  async #resume(): Promise<void> {
    await this.#pausing;
    this.#pausing = undefined;
    this.#paused = false;
    await this.#subscribe(this.#received);
  }

  async #ack(): Promise<void> {
    const cursor = this.#toAck;
    const id = this.#subscription;
    if (!this.#options.name || cursor === undefined || id === undefined) return;
    this.#toAck = undefined;
    await this.#session.call(eventsAckMethod, { subscriptionId: id, cursor });
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
    if (this.#paused && !this.#ended && this.#queue.length <= this.#high / 2) await this.#resume();
    await this.#ack();
    for (;;) {
      const page = this.#queue.shift();
      if (page !== undefined) {
        this.#toAck = page.cursor;
        return { done: false, value: page };
      }
      if (this.#ended) {
        if (this.#ended.error !== undefined) throw this.#ended.error;
        return { done: true, value: undefined };
      }
      if (this.#paused) await this.#resume();
      await new Promise<void>((done) => {
        this.#wake = done;
      });
      this.#wake = undefined;
    }
  }

  async return(): Promise<IteratorResult<EventPage>> {
    const id = this.#subscription;
    this.#end();
    this.#queue.length = 0;
    await this.#pausing;
    if (id !== undefined && this.#subscription === id) {
      await this.#session
        .call(eventsUnsubscribeMethod, { subscriptionId: id })
        .catch(() => undefined);
    }
    return { done: true, value: undefined };
  }
}
