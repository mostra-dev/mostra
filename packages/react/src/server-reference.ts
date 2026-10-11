/**
 * The client side of `"use server"` functions (D19 seam 2, D54). The builder compiles every export
 * of a `"use server"` module in client code into a server reference: a function that carries the
 * server function's ID and sends the call to Mostra. A delivery target without a Mostra server,
 * such as a static export, rejects the call with `MOSTRA_TARGET_UNAVAILABLE`.
 */

/** A `"use server"` function as client code sees it. */
export interface ServerReference<A extends unknown[] = unknown[], R = unknown> {
  /** Calls the server function with `args`; resolves with its result. */
  (...args: A): Promise<R>;
  /** The server function's ID: its module path, `#` and its export name (`actions.ts#sendReply`). */
  readonly mostraServerFunctionId: string;
}

/**
 * Creates the client stub of one server function. The builder emits these calls; artifact code
 * imports the server module as usual and never calls this itself.
 */
export function createServerReference(id: string): ServerReference {
  const reference = async (): Promise<never> => {
    const error = new Error(
      `The server function ${id} can't run here: this delivery target has no Mostra server. Open the artifact through its Mostra link to use it.`,
    ) as Error & { code: string };
    error.code = "MOSTRA_TARGET_UNAVAILABLE";
    throw error;
  };
  Object.defineProperty(reference, "mostraServerFunctionId", { value: id, enumerable: true });
  return reference as unknown as ServerReference;
}
