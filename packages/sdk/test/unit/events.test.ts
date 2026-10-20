/**
 * The event stream's own rules (IN-08) against a fake session, so the orderings a real connection
 * produces only sometimes happen every time.
 */
import { ArtifactId, Cursor, type EventRecord, EventsNotifyParams } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { type EventPage, type EventSession, openEventStream } from "../../src/events.ts";

/** The next page within 2 s, or a failure naming the hang (a dropped page waits forever). */
async function nextPage(iterator: AsyncIterator<EventPage>): Promise<IteratorResult<EventPage>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("no page within 2 s: the stream dropped it")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const artifactId = ArtifactId.create();
const event = (cursor: number): EventRecord => ({
  cursor: Cursor.parse(String(cursor)),
  artifactId,
  seq: cursor,
  type: "state.changed",
  at: "2026-10-19T00:00:00.000Z",
  actor: { kind: "agent" },
  payload: {},
});

/** A session whose `events/subscribe` answer and first page reach the stream in one chunk. */
function sameChunkSession(pages: number[][]): { session: EventSession; calls: string[] } {
  let handler: ((params: unknown) => void) | undefined;
  const calls: string[] = [];
  const session: EventSession = {
    call: (method, params) => {
      calls.push(method.method);
      if (method.method !== "events/subscribe") return Promise.resolve({} as never);
      const id = `sub-${calls.length}`;
      const answer = Promise.resolve({ subscriptionId: id, cursor: "0" } as never);
      // As a line splitter does with one chunk holding both lines: the answer settles the call's
      // promise, and the next line, a page of that subscription, is dispatched at once, before
      // anything awaiting the answer has resumed.
      void answer.then(() => {
        for (const cursors of pages.splice(0))
          handler?.({
            subscriptionId: id,
            events: cursors.map(event),
            cursor: String(cursors.at(-1)),
          });
      });
      void params;
      return answer;
    },
    onNotification(next) {
      handler = next;
      return () => {
        handler = undefined;
      };
    },
    closed: new Promise(() => {}),
  };
  return { session, calls };
}

describe("the event stream (IN-08)", () => {
  it("builds pages the protocol accepts (so a dropped page here is the stream's doing)", () => {
    const page = { subscriptionId: "s", events: [event(1)], cursor: "1" };
    expect(EventsNotifyParams.safeParse(page).success).toBe(true);
  });

  it("keeps a page that arrives with its subscription's answer, before the answer is handled", async () => {
    const { session } = sameChunkSession([[1, 2], [3]]);
    const iterator = openEventStream(session, {})[Symbol.asyncIterator]();
    const first = await nextPage(iterator);
    expect(first.done).toBe(false);
    expect(first.value?.events.map((e: EventRecord) => e.cursor)).toEqual(["1", "2"]);
    const second = await nextPage(iterator);
    expect(second.value?.events.map((e: EventRecord) => e.cursor)).toEqual(["3"]);
    await iterator.return?.();
  });

  it("drops pages of another subscription on the same connection", async () => {
    let handler: ((params: unknown) => void) | undefined;
    const session: EventSession = {
      call: (method) => {
        if (method.method !== "events/subscribe") return Promise.resolve({} as never);
        const answer = Promise.resolve({ subscriptionId: "mine", cursor: "0" } as never);
        void answer.then(() => {
          handler?.({ subscriptionId: "theirs", events: [event(9)], cursor: "9" });
          handler?.({ subscriptionId: "mine", events: [event(1)], cursor: "1" });
        });
        return answer;
      },
      onNotification(next) {
        handler = next;
        return () => {};
      },
      closed: new Promise(() => {}),
    };
    const iterator = openEventStream(session, {})[Symbol.asyncIterator]();
    const page = await nextPage(iterator);
    expect(page.value?.events.map((e: EventRecord) => e.cursor)).toEqual(["1"]);
    await iterator.return?.();
  });
});

/**
 * A fake instance that behaves like the real one where the stream's rules matter: one page per
 * event, pumped faster than a slow consumer reads; `events/unsubscribe` ends a subscription at
 * once; `events/ack` for a subscription that no longer exists is refused; a named subscriber
 * resumes after its acknowledged cursor.
 */
function fakeInstance(total: number) {
  let handler: ((params: unknown) => void) | undefined;
  let next = 0;
  const subscriptions = new Map<string, { cursor: number; name?: string }>();
  const acked = new Map<string, number>();
  const refused: string[] = [];
  const pump = (id: string): void => {
    const sub = subscriptions.get(id);
    if (!sub || sub.cursor >= total) return;
    sub.cursor += 1;
    handler?.({ subscriptionId: id, events: [event(sub.cursor)], cursor: String(sub.cursor) });
    setImmediate(() => pump(id));
  };
  // Each request takes effect when it arrives, in order, as on the real instance; its answer
  // comes back a round trip later.
  const later = <T>(value: T): Promise<T> =>
    new Promise((done) => setTimeout(() => done(value), 2));
  const session: EventSession = {
    call: (method, params) => {
      const p = params as {
        after?: string;
        name?: string;
        subscriptionId?: string;
        cursor?: string;
      };
      if (method.method === "events/subscribe") {
        const id = `s${++next}`;
        const start =
          p.after !== undefined ? Number(p.after) : p.name ? (acked.get(p.name) ?? 0) : total;
        subscriptions.set(id, { cursor: start, ...(p.name ? { name: p.name } : {}) });
        const answer = later({ subscriptionId: id, cursor: String(start) } as never);
        // The backlog follows the answer.
        void answer.then(() => setImmediate(() => pump(id)));
        return answer;
      }
      if (method.method === "events/unsubscribe") {
        subscriptions.delete(p.subscriptionId as string);
        return later({} as never);
      }
      if (method.method === "events/ack") {
        const sub = subscriptions.get(p.subscriptionId as string);
        if (!sub?.name) {
          refused.push(p.subscriptionId as string);
          return Promise.reject(
            new Error(`No subscription ${p.subscriptionId} exists on this connection.`),
          );
        }
        acked.set(sub.name, Number(p.cursor));
        return later({} as never);
      }
      return Promise.reject(new Error(`unexpected ${method.method}`));
    },
    onNotification(nextHandler) {
      handler = nextHandler;
      return () => {
        handler = undefined;
      };
    },
    closed: new Promise(() => {}),
  };
  return { session, acked, refused };
}

describe("the event stream's pauses and acknowledgements (IN-08)", () => {
  // A consumer delay across the window in which a pause's unsubscribe is on its way.
  it.each([0, 1, 2, 3])(
    "never acknowledges under a subscription its pause is ending, and acknowledges every page handled but the last (consumer %i ms)",
    async (delay) => {
      const instance = fakeInstance(60);
      const seen: number[] = [];
      let last: string | undefined;
      for await (const page of openEventStream(instance.session, {
        highWaterMark: 2,
        name: "tasks",
        after: "0",
      })) {
        seen.push(...page.events.map((e: EventRecord) => Number(e.cursor)));
        last = page.cursor;
        await new Promise((done) => setTimeout(done, delay));
        if (seen.length >= 25) break;
      }
      expect(instance.refused).toEqual([]);
      expect(seen).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
      // Everything before the page the loop stopped in is acknowledged, and nothing after it.
      expect(instance.acked.get("tasks")).toBe(Number(last) - 1);
      // A later stream of the name resumes there: only that last page comes again.
      const again = openEventStream(instance.session, { name: "tasks" })[Symbol.asyncIterator]();
      const first = await nextPage(again);
      expect(first.value?.events.map((e: EventRecord) => Number(e.cursor))).toEqual([Number(last)]);
      await again.return?.();
    },
  );
});

describe("ending the stream (IN-08)", () => {
  it("ends a subscription whose answer arrives after the stream was aborted (GPT review finding 5)", async () => {
    const calls: { method: string; params: unknown }[] = [];
    let answer: ((value: unknown) => void) | undefined;
    const session: EventSession = {
      call: (method, params) => {
        calls.push({ method: method.method, params });
        if (method.method === "events/subscribe") {
          return new Promise((done) => {
            answer = done as (value: unknown) => void;
          }) as never;
        }
        return Promise.resolve({} as never);
      },
      onNotification: () => () => {},
      closed: new Promise(() => {}),
    };
    const controller = new AbortController();
    const iterator = openEventStream(session, { signal: controller.signal })[
      Symbol.asyncIterator
    ]();
    const pending = iterator.next();
    await new Promise((done) => setTimeout(done, 10));
    expect(calls.map((call) => call.method)).toEqual(["events/subscribe"]);
    // Aborted while the subscribe is on its way: the stream ends …
    controller.abort();
    await new Promise((done) => setTimeout(done, 10));
    // … and the subscription its answer names is ended too, not left running on the instance.
    answer?.({ subscriptionId: "sub-late", cursor: "0" });
    expect(await pending).toEqual({ done: true, value: undefined });
    await new Promise((done) => setTimeout(done, 10));
    expect(calls.map((call) => call.method)).toEqual(["events/subscribe", "events/unsubscribe"]);
    expect(calls[1]?.params).toEqual({ subscriptionId: "sub-late" });
  });

  it("ends the stream with a refused acknowledgement a pause sent, never an unhandled rejection (Opus review finding 7)", async () => {
    // Each subscription's answer arrives with two pages in the same chunk, so a stream with a
    // high-water mark of two pauses at once: the second pause, after a resume, acknowledges the
    // page the consumer handled meanwhile, and the instance refuses it.
    let handler: ((params: unknown) => void) | undefined;
    let subscriptions = 0;
    const batches = [
      [1, 2],
      [3, 4],
    ];
    const session: EventSession = {
      call: (method) => {
        if (method.method === "events/subscribe") {
          const id = `s${++subscriptions}`;
          const cursors = batches.shift() ?? [];
          const answer = Promise.resolve({ subscriptionId: id, cursor: "0" } as never);
          void answer.then(() => {
            for (const cursor of cursors)
              handler?.({ subscriptionId: id, events: [event(cursor)], cursor: String(cursor) });
          });
          return answer;
        }
        if (method.method === "events/ack")
          return Promise.reject(new Error("The instance refused the acknowledgement."));
        return Promise.resolve({} as never);
      },
      onNotification(next) {
        handler = next;
        return () => {
          handler = undefined;
        };
      },
      closed: new Promise(() => {}),
    };
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      const iterator = openEventStream(session, {
        highWaterMark: 2,
        name: "tasks",
        after: "0",
      })[Symbol.asyncIterator]();
      const seen: number[] = [];
      let failure: unknown;
      try {
        for (let i = 0; i < 6; i++) {
          const page = await nextPage(iterator);
          if (page.done) break;
          seen.push(...page.value.events.map((e: EventRecord) => Number(e.cursor)));
          // A consumer that takes time over each page, as real ones do: the pause's outcome
          // then settles while nobody awaits it.
          await new Promise((done) => setTimeout(done, 20));
        }
      } catch (error) {
        failure = error;
      }
      await new Promise((done) => setTimeout(done, 50));
      expect(unhandled).toEqual([]);
      expect(String(failure)).toContain("refused the acknowledgement");
      expect(seen[0]).toBe(1);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
