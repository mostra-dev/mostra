/**
 * Errors the client runtime throws: each carries the stable diagnostic code an artifact can switch
 * on (INTERFACES §13), and the diagnostic itself when the gateway sent one.
 */

/** A diagnostic as the gateway sends it; only the fields the runtime reads. */
export interface DiagnosticLike {
  /** The stable diagnostic code, such as `MOSTRA_FIELD_TOO_LARGE`. */
  readonly code: string;
  /** What is wrong. */
  readonly message: string;
  /** What to do about it. */
  readonly hint?: string;
  /** The code's documentation page. */
  readonly docs?: string;
}

/** An error with a Mostra diagnostic code, such as `MOSTRA_SUBMIT_CHANNEL_DENIED`. */
export class MostraError extends Error {
  /** The stable diagnostic code. */
  readonly code: string;
  /** The HTTP status the gateway answered with, when the error came from it. */
  readonly status: number | undefined;
  /** The diagnostic, when the gateway sent one. */
  readonly diagnostic: DiagnosticLike | undefined;
  /** Extra data the refusal carried, such as the existing submission of `MOSTRA_SUBMIT_ALREADY`. */
  readonly body: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      readonly status?: number;
      readonly diagnostic?: DiagnosticLike;
      readonly body?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = "MostraError";
    this.code = code;
    this.status = options.status;
    this.diagnostic = options.diagnostic;
    this.body = options.body;
  }
}

/** `MOSTRA_TARGET_UNAVAILABLE`: what the delivery target can't do (a static export, D111). */
export function targetUnavailable(what: string): MostraError {
  return new MostraError(
    "MOSTRA_TARGET_UNAVAILABLE",
    `${what} needs the artifact's Mostra link; this copy of the page has no Mostra server.`,
  );
}
