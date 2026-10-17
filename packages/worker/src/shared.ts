/**
 * The memory the worker's main thread and its channel thread share: the event loop's heartbeat,
 * the heap in use, and one slot for a synchronous secret read.
 */

/** Where a secret read stands, in `control`. */
export const SECRET_SLOT = {
  /** 0 idle, 1 the main thread waits, 2 the answer is in `secretBytes`. */
  state: 0,
  /** The answer's length in bytes. */
  length: 1,
  /** 0 the value, 1 a JSON `{ code, message }` error. */
  status: 2,
} as const;

/** The largest secret answer the slot holds: a 64 KiB value, or an error. */
const SECRET_BYTES = 256 * 1024;

/** The shared buffers, as they cross to the channel thread. */
export interface SharedState {
  readonly control: SharedArrayBuffer;
  readonly beat: SharedArrayBuffer;
  readonly secret: SharedArrayBuffer;
}

/** Typed views of the shared buffers. */
export interface SharedViews {
  readonly control: Int32Array;
  /** `[0]`: the last heartbeat, in ms since the epoch; `[1]`: the heap in use, in bytes. */
  readonly beat: BigInt64Array;
  readonly secretBytes: Uint8Array;
}

/** Allocates the shared buffers. */
export function createSharedState(): SharedState {
  return {
    control: new SharedArrayBuffer(4 * 4),
    beat: new SharedArrayBuffer(8 * 2),
    secret: new SharedArrayBuffer(SECRET_BYTES),
  };
}

/** The typed views of `state`. */
export function sharedViews(state: SharedState): SharedViews {
  return {
    control: new Int32Array(state.control),
    beat: new BigInt64Array(state.beat),
    secretBytes: new Uint8Array(state.secret),
  };
}
