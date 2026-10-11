/**
 * Errors on a JSON-RPC connection. Every error carries a diagnostic (INTERFACES §1, §6): the
 * JSON-RPC `error.code` says which kind of failure it is, and `error.data` is the diagnostic.
 */
import { type HostDiagnosticCode, hostDiagnostics } from "../diagnostics/codes/host.ts";
import { Diagnostic } from "../diagnostics/diagnostic.ts";
import { buildDiagnostic, type DiagnosticDetails } from "../diagnostics/spec.ts";
import type { JsonRpcErrorObject } from "./messages.ts";

/** The JSON-RPC 2.0 error codes Mostra uses (INTERFACES §6). */
export const JSON_RPC_ERROR_CODES: {
  /** The line wasn't valid JSON. */
  readonly parseError: -32700;
  /** The message wasn't a valid request, or was a batch. */
  readonly invalidRequest: -32600;
  /** The method doesn't exist on this side. */
  readonly methodNotFound: -32601;
  /** The params failed the method's schema. */
  readonly invalidParams: -32602;
  /** An unexpected failure. */
  readonly internalError: -32603;
  /** Every other diagnostic. */
  readonly diagnostic: -32000;
} = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  diagnostic: -32000,
};

function codeFor(diagnostic: Diagnostic): number {
  switch (diagnostic.code) {
    case "MOSTRA_HOST_MALFORMED":
      return JSON_RPC_ERROR_CODES.invalidRequest;
    case "MOSTRA_HOST_METHOD_UNKNOWN":
      return JSON_RPC_ERROR_CODES.methodNotFound;
    case "MOSTRA_HOST_INVALID_PARAMS":
      return JSON_RPC_ERROR_CODES.invalidParams;
    case "MOSTRA_HOST_INTERNAL_ERROR":
      return JSON_RPC_ERROR_CODES.internalError;
    default:
      return JSON_RPC_ERROR_CODES.diagnostic;
  }
}

/**
 * An error that crosses a connection as a JSON-RPC error. Throw it from a request handler to
 * answer with this diagnostic; a request's promise rejects with it when the other side answers
 * with an error, the connection closes or the request times out.
 *
 * ```ts
 * throw new RpcError(
 *   createDiagnostic("MOSTRA_HOME_MISMATCH", { message: "This instance serves /a, not /b." }),
 * );
 * ```
 */
export class RpcError extends Error {
  /** The JSON-RPC error code. */
  readonly code: number;
  /** The diagnostic: what happened and what to do. */
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic, code: number = codeFor(diagnostic)) {
    super(diagnostic.message);
    this.name = "RpcError";
    this.code = code;
    this.diagnostic = diagnostic;
  }

  /** The JSON-RPC error object for a response. */
  toErrorObject(): JsonRpcErrorObject {
    return { code: this.code, message: this.diagnostic.message, data: this.diagnostic };
  }

  /**
   * Reads a received error object. When its `data` isn't a diagnostic (a peer that isn't Mostra),
   * the result is a `MOSTRA_HOST_MALFORMED` diagnostic that keeps the peer's message.
   */
  static fromErrorObject(error: JsonRpcErrorObject, docsBase?: string): RpcError {
    const parsed = Diagnostic.safeParse(error.data);
    if (parsed.success) return new RpcError(parsed.data, error.code);
    return new RpcError(
      hostDiagnostic(
        "MOSTRA_HOST_MALFORMED",
        {
          message: `The other side answered with error ${error.code} without a diagnostic: ${error.message.slice(0, 200)}`,
        },
        docsBase,
      ),
      error.code,
    );
  }
}

/**
 * Builds a HOST-area diagnostic from that area's catalog alone, so the JSON-RPC core doesn't pull
 * every area's text into browser bundles (D83).
 */
export function hostDiagnostic(
  code: HostDiagnosticCode,
  details: DiagnosticDetails,
  docsBase?: string,
): Diagnostic {
  return buildDiagnostic(code, hostDiagnostics[code], details, docsBase);
}
