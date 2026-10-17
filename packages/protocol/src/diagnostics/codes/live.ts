/**
 * Diagnostic codes of the LIVE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the LIVE area, in the order they were added. */
export const liveDiagnosticCodes = [
  "MOSTRA_LIVE_TOO_LARGE",
  "MOSTRA_LIVE_SOURCE_FAILED",
  // gen:codes
] as const;

/** The codes of the LIVE area. */
export type LiveDiagnosticCode = (typeof liveDiagnosticCodes)[number];

/** The LIVE area's catalog entries. */
export const liveDiagnostics: AreaCatalog<LiveDiagnosticCode> = {
  MOSTRA_LIVE_TOO_LARGE: {
    severity: "error",
    phase: "runtime",
    title: "Live value too large",
    hint: "Push or produce a smaller value: at most 4 MiB serialized.",
    docs: {
      explanation:
        "A live value, pushed or produced, is over 4 MiB once serialized (DATA_MODEL \u00a75). It is refused and the last good value stays.",
      fix: "Send a smaller window of the data, or split it across several live sources. For high-rate series, push single points in append mode and let the page keep the window.",
    },
  },
  MOSTRA_LIVE_SOURCE_FAILED: {
    severity: "error",
    phase: "runtime",
    title: "Live source failed",
    hint: "Read the message, fix the live source's loader or stream, and publish again; the last good value stays meanwhile.",
    docs: {
      explanation:
        "A live source's `load` or `stream` threw, or its value was outside the serializable types. Pages keep showing the last good value with `useLive`'s `error` set, and the producer tries again on its schedule (FAILURE_MODEL \u00a76).",
      fix: "Fix the producer in `live.ts`, or catch transient failures there and return the previous value.",
    },
  },
  // gen:entries
};
