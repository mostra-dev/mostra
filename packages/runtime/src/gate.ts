import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One gate per instance between `gc` and the work whose files it would remove (D140 item 14):
 * publishes, verify runs, dependency additions and layout installs hold it shared, so they run
 * side by side as before; a gc run holds it alone. Writers are preferred: once a gc waits, new
 * shared work waits behind it, so a busy home can't keep gc out forever. Shared work started
 * inside shared work (a verify run starting a worker whose layout installs) joins its caller's
 * hold rather than waiting, so a waiting gc never deadlocks it.
 */
export class Gate {
  readonly #holding = new AsyncLocalStorage<true>();
  #shared = 0;
  #exclusive = false;
  #waitingExclusive = 0;
  readonly #wakers: (() => void)[] = [];

  /** Runs `fn` beside other shared work, never during a gc run. */
  async shared<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#holding.getStore() === true) return fn();
    while (this.#exclusive || this.#waitingExclusive > 0) await this.#wait();
    this.#shared += 1;
    try {
      return await this.#holding.run(true, fn);
    } finally {
      this.#shared -= 1;
      this.#wake();
    }
  }

  /** Runs `fn` alone: after shared work in flight ends, and before any that arrives meanwhile. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.#waitingExclusive += 1;
    try {
      while (this.#exclusive || this.#shared > 0) await this.#wait();
    } finally {
      this.#waitingExclusive -= 1;
    }
    this.#exclusive = true;
    try {
      return await this.#holding.run(true, fn);
    } finally {
      this.#exclusive = false;
      this.#wake();
    }
  }

  #wait(): Promise<void> {
    return new Promise((resolve) => this.#wakers.push(resolve));
  }

  #wake(): void {
    for (const wake of this.#wakers.splice(0)) wake();
  }
}
