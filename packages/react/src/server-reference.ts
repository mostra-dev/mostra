"use client";

/**
 * The client side of `"use server"` functions (D19 seam 2, D54). The builder compiles every export
 * of a `"use server"` module in client code into a server reference: a function that carries the
 * server function's ID and hands the call to the page's runtime, as React's own server references
 * hand theirs to the callback `setServerCallback` installs. The runtime calls Mostra (a plain
 * call: no record, the result streamed back); where there is no Mostra server, such as a static
 * export, the call rejects with `MOSTRA_TARGET_UNAVAILABLE`.
 */

/** A `"use server"` function as client code sees it. */
export interface ServerReference<A extends unknown[] = unknown[], R = unknown> {
  /** Calls the server function with `args`; resolves with its result. */
  (...args: A): Promise<R>;
  /** The server function's ID: its module path, `#` and its export name (`actions.ts#sendReply`). */
  readonly mostraServerFunctionId: string;
}

/** How the page's runtime calls a server function. */
export type CallServer = (id: string, args: unknown[]) => Promise<unknown>;

const unavailable: CallServer = async (id) => {
  const error = new Error(
    `The server function ${id} can't run here: this delivery target has no Mostra server. Open the artifact through its Mostra link to use it.`,
  ) as Error & { code: string };
  error.code = "MOSTRA_TARGET_UNAVAILABLE";
  throw error;
};

let callServer: CallServer = unavailable;

/**
 * Installs how server references call the server: the runtime does it when the page starts (a
 * live page calls Mostra; a static export keeps the default, which rejects). Returns the function
 * that restores the previous one.
 */
export function setServerCallback(callback: CallServer): () => void {
  const previous = callServer;
  callServer = callback;
  return () => {
    callServer = previous;
  };
}

/**
 * Creates the client stub of one server function. The builder emits these calls; artifact code
 * imports the server module as usual and never calls this itself.
 */
export function createServerReference(id: string): ServerReference {
  const reference = (...args: unknown[]): Promise<unknown> => callServer(id, args);
  Object.defineProperty(reference, "mostraServerFunctionId", { value: id, enumerable: true });
  return reference as unknown as ServerReference;
}
