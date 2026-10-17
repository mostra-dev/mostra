/**
 * Diagnostic codes of the FIELD area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the FIELD area, in the order they were added. */
export const fieldDiagnosticCodes = [
  "MOSTRA_FIELD_TOO_LARGE",
  "MOSTRA_FIELD_ID_INVALID",
  "MOSTRA_FIELD_MUTATION_ID_REUSED",
  "MOSTRA_FIELD_CONFLICT",
  "MOSTRA_FIELD_DUPLICATE_ID",
  "MOSTRA_FIELD_ID_UNSTABLE",
  "MOSTRA_FIELD_SHARED",
  "MOSTRA_FIELD_UNBOUND",
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
    hint: "Split large data across fields, keeping each value under 1 MiB and the whole document under 16 MiB.",
    docs: {
      explanation:
        "A field value is at most 1 MiB of JSON and a draft or artifact state at most 16 MiB in all (DATA_MODEL §5). This write would pass one of those limits, so Mostra refused it whole: nothing was truncated, and the page keeps the value locally.",
      fix: "Split the value across several fields under one dotted prefix (`report.part1`, `report.part2`); they nest again in results.",
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
  MOSTRA_FIELD_CONFLICT: {
    severity: "error",
    phase: "runtime",
    title: "Field changed by another writer",
    hint: "Read the value again, then write it; for a value several writers change often, give each writer a field of its own.",
    docs: {
      explanation:
        "Every write names the revision it was based on, and a field changed after it is a conflict, never overwritten silently (D22). `window.storage` writes end with the last write: on a conflict it writes again over the newer value, a few times. When another writer kept changing the field each time, the write is refused with this code, and the field keeps the other writer's value.",
      fix: "Read the key again and write the new value. For a counter or a list that many viewers change at once, store each viewer's part under its own key (`votes.<viewer>`) and combine them when reading.",
    },
  },
  MOSTRA_FIELD_DUPLICATE_ID: {
    severity: "error",
    phase: "lint",
    title: "Field ID used for two different fields",
    hint: "Give each of these fields its own ID.",
    docs: {
      explanation:
        "One field ID is used for two different fields: with two hook kinds (`useField` and `useChoice`, say), two scopes (`viewer` and `artifact`), or initial values of two types. The two would overwrite each other's saved value. The same ID used the same way twice is a deliberately shared value and isn't reported here.",
      fix: "Rename one of them, for example `notes` and `notes.summary`, so each persisted value has its own ID.",
    },
  },
  MOSTRA_FIELD_ID_UNSTABLE: {
    severity: "error",
    phase: "lint",
    title: "Field ID changes between renders",
    hint: "Build the field's ID from stable data, such as a record's ID, never from random numbers or the time.",
    docs: {
      explanation:
        "Verify loaded the page twice with identical inputs and a fixed clock, and a field ID differed between the two loads. A viewer's saved answer would then be lost on every reload. IDs an interaction creates, such as a new list row's, are new fields and aren't reported.",
      fix: "Derive the ID from something stable, for example a template with the record's ID instead of one with `Math.random()`.",
    },
  },
  MOSTRA_FIELD_SHARED: {
    severity: "hint",
    phase: "lint",
    title: "Field ID shared by several controls",
    hint: "Nothing to fix if these controls are meant to edit one value; give each its own ID if not.",
    docs: {
      explanation:
        "Several mounted components use one field ID in the same way, so they all edit one saved value. That is how a value is shared deliberately; in a list, it can also mean every row edits the same answer.",
      fix: "If each row should keep its own answer, include the row's identity in the ID, such as a template that adds the task's ID after `done.`.",
    },
  },
  MOSTRA_FIELD_UNBOUND: {
    severity: "hint",
    phase: "smoke",
    title: "Input not bound to a field",
    hint: "Bind the input with `useField` (or a kit input with an `id`) if its value should be saved and submitted.",
    docs: {
      explanation:
        "Verify's smoke test typed into an input and the page saved nothing: the input isn't bound to a field, so what a viewer types there is lost on reload and isn't part of a submission. A search box or a filter may be meant that way.",
      fix: 'Use `const [value, setValue] = useField("<id>", "")` for the input\'s value, or leave it if it isn\'t meant to persist.',
    },
  },
  // gen:entries
};
