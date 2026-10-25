/**
 * The HOST-area codes the JSON-RPC core raises itself (D83): malformed messages, unknown methods,
 * invalid params, internal errors, closed connections and timeouts. They are defined here once
 * and spread into the HOST catalog, so a browser bundle that imports the core (the bridge,
 * `@mostra/react`, the shell) carries these six entries, not the whole area's text: a new HOST
 * code no longer grows them (#17).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes the JSON-RPC core raises. */
export type CoreHostDiagnosticCode =
  | "MOSTRA_HOST_MALFORMED"
  | "MOSTRA_HOST_METHOD_UNKNOWN"
  | "MOSTRA_HOST_INVALID_PARAMS"
  | "MOSTRA_HOST_INTERNAL_ERROR"
  | "MOSTRA_HOST_CONNECTION_CLOSED"
  | "MOSTRA_HOST_TIMEOUT";

/** Their catalog entries. */
export const coreHostDiagnostics: AreaCatalog<CoreHostDiagnosticCode> = {
  MOSTRA_HOST_MALFORMED: {
    severity: "error",
    phase: "host",
    title: "Malformed protocol message",
    hint: "Send each message as one line of JSON holding a single JSON-RPC 2.0 request or notification.",
    docs: {
      explanation:
        "Every message on a Mostra connection is one line of JSON with one JSON-RPC 2.0 object. This code means a line wasn't valid JSON, wasn't a JSON-RPC 2.0 request or response, or was a batch (a JSON array), which revision `2026-10-10` doesn't accept. A client also reports it when a response doesn't match the method's result schema.",
      fix: 'Encode one request per line with `"jsonrpc": "2.0"`, a `method`, an `id` for requests, and `params` as an object. Send several requests as separate lines instead of a batch.',
    },
  },
  MOSTRA_HOST_METHOD_UNKNOWN: {
    severity: "error",
    phase: "host",
    title: "Unknown protocol method",
    hint: "Call only the methods listed in `capabilities.methods` of the `mostra/initialize` result.",
    docs: {
      explanation:
        "The instance doesn't serve the method that was called. Either the name is misspelled, or the client is newer than the instance and calls a method the instance's release doesn't have.",
      fix: "Check the method name against INTERFACES \u00a76, and against `capabilities.methods` in the `mostra/initialize` result, which lists every method this instance serves. Upgrade the instance if the client needs a newer method.",
    },
  },
  MOSTRA_HOST_INVALID_PARAMS: {
    severity: "error",
    phase: "host",
    title: "Invalid method params",
    hint: "Fix the params named in the message so they match the method's schema.",
    docs: {
      explanation:
        "The request's `params` don't match the method's published schema: a required field is missing, a value has the wrong type, or a value is outside its allowed range. The message names the first problem found.",
      fix: "Compare the request with the method's schema in `@mostra/protocol` (or the published JSON Schema) and correct the field named in the message.",
    },
  },
  MOSTRA_HOST_INTERNAL_ERROR: {
    severity: "error",
    phase: "host",
    title: "Unexpected failure in the instance",
    hint: "Retry the request with the same request ID; if it fails again, report it with the instance's log.",
    docs: {
      explanation:
        "The instance failed while handling the request, for a reason that isn't one of its known conditions. Durable state is unaffected: a request is acknowledged only after its ledger transaction commits. The details are in the instance's log (`logs/supervisor.log` in the home), not in the response.",
      fix: "Retry the request with the same request ID; retries are idempotent. If the failure repeats, report it with the relevant lines of `logs/supervisor.log`.",
    },
  },
  MOSTRA_HOST_CONNECTION_CLOSED: {
    severity: "error",
    phase: "host",
    title: "Connection closed",
    hint: "Reconnect, then retry the request with the same request ID.",
    docs: {
      explanation:
        "The connection to the other side closed before a response arrived, for example because the instance exited or restarted. The request may or may not have taken effect.",
      fix: "Reconnect and send `mostra/initialize` again, then retry the request with the same request ID. Mutating methods are idempotent by request ID, so a retry never applies twice.",
    },
  },
  MOSTRA_HOST_TIMEOUT: {
    severity: "error",
    phase: "host",
    title: "Request timed out",
    hint: "Retry the request with the same request ID, or allow it more time.",
    docs: {
      explanation:
        "No response arrived within the time the caller allowed. The other side may still be working on the request, and it may still take effect.",
      fix: "Retry with the same request ID, which returns the recorded result if the first attempt completed. Allow a longer timeout for slow operations.",
    },
  },
};
