/**
 * Diagnostic codes of the FIELD area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the FIELD area, in the order they were added. */
export const fieldDiagnosticCodes = [
  "MOSTRA_FIELD_TOO_LARGE",
  "MOSTRA_FIELD_ID_INVALID",
  "MOSTRA_FIELD_MUTATION_ID_REUSED",
  // gen:codes
] as const;

/** The codes of the FIELD area. */
export type FieldDiagnosticCode = (typeof fieldDiagnosticCodes)[number];

/** The FIELD area's catalog entries. */
export const fieldDiagnostics: AreaCatalog<FieldDiagnosticCode> = {
  MOSTRA_FIELD_TOO_LARGE: {
    severity: "error",
    phase: "runtime",
    title: "Field value too large",
    hint: "Store large data as a blob or split it across fields; keep each value under 1 MiB.",
    docs: {
      explanation:
        "A field value is at most 1 MiB of JSON and a draft or artifact state at most 16 MiB in all (DATA_MODEL §5). This write would pass one of those limits, so Mostra refused it whole: nothing was truncated, and the page keeps the value locally.",
      fix: "Split the value across several fields, or store binary data as a blob and keep its reference in the field.",
    },
  },
  MOSTRA_FIELD_ID_INVALID: {
    severity: "error",
    phase: "runtime",
    title: "Invalid field ID",
    hint: "Use a stable field ID of 1 to 256 characters: dot-separated parts, none empty.",
    docs: {
      explanation:
        "Every persisted value has an explicit, stable field ID (D52). An ID is 1 to 256 characters with no control characters; dots separate the parts that nest in results (`reply.m1`), so it can't start or end with a dot or hold two in a row.",
      fix: "Give the field a fixed ID such as `layout` or `reply.m1` (one per message, from its ID), and keep it the same across renders and versions so drafts carry over.",
    },
  },
  MOSTRA_FIELD_MUTATION_ID_REUSED: {
    severity: "error",
    phase: "runtime",
    title: "Mutation ID reused",
    hint: "Generate a new mutation ID for every new change.",
    docs: {
      explanation:
        "A mutation ID identifies one change, so a retry after a timeout replays its recorded result (IN-01). This ID was already used for a change with other contents or another target. Mostra refuses it rather than answer with the result of a change nobody sent now.",
      fix: "Create a fresh `mut_` ID for each change and reuse an ID only to retry exactly the same change.",
    },
  },
  // gen:entries
};
