/**
 * The IDs a post carries (WP-20's review, finding 6): a thread's and a comment's IDs are made by the
 * shell, so the gateway answers a retried post with what the first one made. They stay the same
 * while what is posted stays the same, so a post sent again after its answer was lost (a dropped
 * connection, a closed lid) repeats the first instead of making a second thread with its own
 * mentions and crop; they are made anew once a post went through, or what is posted changed.
 */
export class Attempts {
  readonly #open = new Map<string, { readonly content: string; readonly ids: unknown }>();

  /** The IDs of `slot`'s post of `content`: the ones its last attempt used, if it posted the same. */
  ids<T>(slot: string, content: string, make: () => T): T {
    const open = this.#open.get(slot);
    if (open !== undefined && open.content === content) return open.ids as T;
    const ids = make();
    this.#open.set(slot, { content, ids });
    return ids;
  }

  /** `slot`'s post went through: its next post gets new IDs. */
  done(slot: string): void {
    this.#open.delete(slot);
  }
}
