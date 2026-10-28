/**
 * Who may replace the artifact's frame (D157 item 1, D115, VR-04). Three things enter the frame
 * with a new ticket: the shell's recovery of a frame that never greeted, the re-entry of a frame
 * that loaded another version, and the viewer's switch to a newer version. A ticket asked for is
 * used only if nothing happened to the frame since: no other entry was asked for, and no frame
 * greeted the shell. So a page that greets is never replaced by a ticket asked for before it did,
 * and of two entries asked for, only the later one is used (the second GPT review of MT-02b).
 *
 * ```ts
 * const entries = frameEntries();
 * entries.greeted(); // from the bridge, as soon as `ui/initialize` arrives
 * const next = await entries.enter((signal) => frameTicket(apiBase, csrf, version, signal));
 * if (next) setTicket(next);
 * ```
 */

/** The frame's entries: every greeting and every entry goes through one. */
export interface FrameEntries {
  /** A frame greeted the shell: every entry asked for before this one is dropped. */
  greeted(): void;
  /**
   * Asks for an entry with `request`, which gets a signal that aborts when the entry is dropped.
   * Resolves the ticket when it may be used, `undefined` when something happened to the frame
   * meanwhile (the request was aborted then too), and rejects when the request failed.
   */
  enter<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
  /** Drops every entry asked for (the page closes, the recovery's wait ends). */
  cancel(): void;
}

/** One frame's entries. */
export function frameEntries(): FrameEntries {
  let generation = 0;
  let asking: AbortController | undefined;
  const drop = (): void => {
    generation += 1;
    asking?.abort();
    asking = undefined;
  };
  return {
    greeted: drop,
    cancel: drop,
    async enter<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
      drop();
      const mine = generation;
      const controller = new AbortController();
      asking = controller;
      try {
        const value = await request(controller.signal);
        return generation === mine ? value : undefined;
      } catch (error) {
        if (generation !== mine) return undefined;
        throw error;
      } finally {
        if (asking === controller) asking = undefined;
      }
    },
  };
}
