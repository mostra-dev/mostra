/**
 * Diagnostic codes of the HOST area: the host protocol between clients and an instance.
 */
import type { AreaCatalog } from "../spec.ts";
import { coreHostDiagnostics } from "./host-core.ts";

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
  "MOSTRA_HOST_REQUEST_ID_REUSED",
  "MOSTRA_HOST_CURSOR_COMPACTED",
  "MOSTRA_HOST_SUBSCRIPTION_UNKNOWN",
  "MOSTRA_HOST_NOTIFICATION_UNSUPPORTED",
  "MOSTRA_HOST_MESSAGE_TOO_LARGE",
  "MOSTRA_HOST_IDENTITY_UNAVAILABLE",
  // gen:codes
] as const;

/** The codes of the HOST area. */
export type HostDiagnosticCode = (typeof hostDiagnosticCodes)[number];

/**
 * The HOST area's catalog entries. The codes the JSON-RPC core raises live in `host-core.ts`, so
 * browser bundles carry only theirs (#17).
 */
export const hostDiagnostics: AreaCatalog<HostDiagnosticCode> = {
  ...coreHostDiagnostics,
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
  MOSTRA_HOST_REQUEST_ID_REUSED: {
    severity: "error",
    phase: "host",
    title: "A requestId was reused with other parameters",
    hint: "Send a new `requestId` for a new request; repeat the exact parameters only to retry one.",
    docs: {
      explanation:
        "A mutating method recorded its result under this `requestId` for different parameters. Replaying that result would answer a request nobody made (a link for another artifact or with other scopes, another source's publish), so the instance refuses (H-03). Retries with the same parameters still return the recorded result.",
      fix: "Generate a fresh `requestId` for every new request, and reuse one only to retry the same request after a timeout or a lost connection.",
    },
  },
  MOSTRA_HOST_CURSOR_COMPACTED: {
    severity: "error",
    phase: "host",
    title: "Events compacted",
    hint: "Read from the cursor in the message to receive the compaction summary, then continue from there.",
    docs: {
      explanation:
        "Events before a cursor were compacted on request (`mostra gc --compact-events`, DATA_MODEL §4): an artifact's old events were replaced by one `artifact.compacted` event that summarizes them. A reader asking for events after an earlier cursor would miss some, and Mostra never leaves a silent gap.",
      fix: "Read again with `after` set to the cursor the message names: the next event is the `artifact.compacted` summary. Rebuild what you track from it and continue as usual.",
    },
  },
  MOSTRA_HOST_SUBSCRIPTION_UNKNOWN: {
    severity: "error",
    phase: "host",
    title: "Unknown subscription",
    hint: "Subscribe again with `events/subscribe`, then use the ID it returns.",
    docs: {
      explanation:
        "The subscription ID belongs to no subscription on this connection: it was never created here, was ended with `events/unsubscribe`, or belonged to a connection that closed. Subscriptions live as long as their connection; a named subscriber's acknowledged cursor outlives it.",
      fix: "Call `events/subscribe` again on this connection. With the same `name`, delivery resumes after the last acknowledged cursor.",
    },
  },
  MOSTRA_HOST_NOTIFICATION_UNSUPPORTED: {
    severity: "error",
    phase: "host",
    title: "Notification not accepted",
    hint: "List the notification in `capabilities.notifications` when you initialize.",
    docs: {
      explanation:
        "Mostra sends a client only the notifications it listed in `mostra/initialize` (D84). This method would send one the client didn't list, such as `events/notify` for `events/subscribe`.",
      fix: 'Reconnect and initialize with `capabilities: { notifications: ["events/notify"] }`, or poll with `events/read` instead.',
    },
  },
  MOSTRA_HOST_MESSAGE_TOO_LARGE: {
    severity: "error",
    phase: "host",
    title: "Message too large for the protocol",
    hint: "Ask for less at once: a specific submission, fewer events, or smaller values.",
    docs: {
      explanation:
        "One host-protocol message is one line of JSON, and a line holds at most 64 Mi characters (`MAX_LINE_LENGTH`), so neither side buffers without bound. Mostra checks every message before it writes it: an answer that would be longer is replaced by this error, and a delivery whose envelope would be longer is recorded as undeliverable instead of being sent and retried forever.",
      fix: "Read less per request (`events/read` with a smaller `limit`, `results/get` for one submission), and keep artifacts' values within the field and document limits.",
    },
  },
  MOSTRA_HOST_IDENTITY_UNAVAILABLE: {
    severity: "error",
    phase: "host",
    title: "The host that identifies viewers didn't answer",
    hint: "Start the host that serves this home's identity port, then open the link again.",
    docs: {
      explanation:
        "A host registered the `identity` port, so it decides who opens this home's links. When a link minted without a viewer was opened, that host failed, didn't answer within 5 seconds, gave an answer its schema refuses, or is expected (it lists `identity` in `HomeConfig.ports`) but not connected. Mostra refuses the link rather than let the session act as someone else.",
      fix: "Start or reconnect the host, then open the link again. A link minted with `view/url`'s `viewer` names its person itself and never needs the port. To return the home to Mostra's own identity, have the host register without the port and clear its expected ports (`HomeConfig.ports: []`).",
    },
  },
  // gen:entries
};
