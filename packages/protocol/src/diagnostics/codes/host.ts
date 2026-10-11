/**
 * Diagnostic codes of the HOST area: the host protocol between clients and an instance.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the HOST area, in the order they were added. */
export const hostDiagnosticCodes = [
  "MOSTRA_HOST_REVISION_UNSUPPORTED",
  "MOSTRA_HOST_MALFORMED",
  "MOSTRA_HOST_METHOD_UNKNOWN",
  "MOSTRA_HOST_INVALID_PARAMS",
  "MOSTRA_HOST_INTERNAL_ERROR",
  "MOSTRA_HOST_INITIALIZE_ORDER",
  "MOSTRA_HOST_PORT_UNSUPPORTED",
  "MOSTRA_HOST_CONNECTION_CLOSED",
  "MOSTRA_HOST_TIMEOUT",
  "MOSTRA_HOST_SHUTDOWN_REFUSED",
  // gen:codes
] as const;

/** The codes of the HOST area. */
export type HostDiagnosticCode = (typeof hostDiagnosticCodes)[number];

/** The HOST area's catalog entries. */
export const hostDiagnostics: AreaCatalog<HostDiagnosticCode> = {
  MOSTRA_HOST_REVISION_UNSUPPORTED: {
    severity: "error",
    phase: "host",
    title: "No common host protocol revision",
    hint: "Run the client and the instance from the same Mostra release, for example with `mostra daemon restart`.",
    docs: {
      explanation:
        "A client and a Mostra instance agree on a host protocol revision when they connect (`mostra/initialize`). The client offers the revisions it speaks, and the instance picks the newest one it also supports. This code means the two lists have nothing in common, usually because the client and the running daemon come from Mostra releases far apart.",
      fix: "Restart the daemon so it runs the same release as the client: `mostra daemon restart`. Durable state survives the restart, and open views reconnect. A host that embeds Mostra updates its pinned Mostra runtime or its host library until both support a common revision.",
    },
  },
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
  MOSTRA_HOST_INITIALIZE_ORDER: {
    severity: "error",
    phase: "host",
    title: "Initialize first, and only once",
    hint: "Send `mostra/initialize` as the first request on the connection, and only once.",
    docs: {
      explanation:
        "Every connection starts with `mostra/initialize`, which agrees the protocol revision and registers the client's ports. The instance received another request before it, or a second `mostra/initialize` on the same connection.",
      fix: "Send `mostra/initialize` first and wait for its result before any other request. To renegotiate, open a new connection.",
    },
  },
  MOSTRA_HOST_PORT_UNSUPPORTED: {
    severity: "warning",
    phase: "host",
    title: "Port not supported by this instance",
    hint: "Leave the port out of `mostra/initialize`, or run a Mostra release that lists it in `capabilities.ports`.",
    docs: {
      explanation:
        "The client registered a port this instance doesn't call, so registering it has no effect. The port may be reserved for a later release (such as `ai`), or the client may be newer than the instance. The session continues without the port, and Mostra uses its standalone behavior instead.",
      fix: "Register only the ports listed in `capabilities.ports` of the `mostra/initialize` result. If the host needs the port, upgrade the instance to a release that supports it.",
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
  MOSTRA_HOST_SHUTDOWN_REFUSED: {
    severity: "error",
    phase: "host",
    title: "Only the spawning host can stop this instance",
    hint: "Ask the host that started this instance to stop it, or end the connection you opened instead.",
    docs: {
      explanation:
        "An instance started by a host over stdio (`mostra host`) lives as long as that host's connection, so only the host may stop it with `mostra/shutdown`. A client that attached through the home's socket asked it to stop. A daemon (`mostra daemon`) accepts `mostra/shutdown` from every attached client (D87).",
      fix: "Close your own connection when you are done. To stop the instance, stop the host that spawned it, or have the host send `mostra/shutdown` or close its stdio.",
    },
  },
  // gen:entries
};
