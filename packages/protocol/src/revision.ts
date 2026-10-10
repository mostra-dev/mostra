/**
 * Dated protocol revisions and their negotiation (INTERFACES §1, STANDARDS versioning, D59).
 *
 * The host protocol and the browser protocol each carry a revision named by a date
 * (`2026-10-10`). A revision only changes additively. A breaking change needs a new revision, and
 * the old one stays supported for at least 12 months.
 */
import * as z from "zod";
import { type CreateDiagnosticOptions, createDiagnostic } from "./diagnostics/codes/index.ts";
import type { Diagnostic } from "./diagnostics/diagnostic.ts";
import { wireRegistry } from "./wire-registry.ts";

/** A protocol revision: a calendar date in `YYYY-MM-DD` form. */
export type Revision = string & { readonly __mostraRevision: true };

const PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isRevision(value: unknown): value is Revision {
  if (typeof value !== "string" || !PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Protocol revisions. */
export const Revision: {
  /** The textual form. `is` and `parse` also reject impossible dates such as `2026-02-30`. */
  readonly pattern: RegExp;
  readonly schema: z.ZodType<Revision, string>;
  is(value: unknown): value is Revision;
  /** @throws TypeError when `value` is not a real calendar date in `YYYY-MM-DD` form. */
  parse(value: string): Revision;
  /** Orders revisions by date: negative when `a` is older than `b`. */
  compare(a: Revision, b: Revision): number;
} = {
  pattern: PATTERN,
  schema: z
    .string()
    .regex(PATTERN)
    .refine(isRevision, "Expected a real calendar date")
    .register(wireRegistry, {
      id: "Revision",
      description: "Protocol revision: a calendar date in YYYY-MM-DD form.",
    }) as unknown as z.ZodType<Revision, string>,
  is: isRevision,
  parse(value: string): Revision {
    if (isRevision(value)) return value;
    throw new TypeError("Expected a protocol revision: a calendar date in YYYY-MM-DD form.");
  },
  compare(a: Revision, b: Revision): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },
};

/**
 * The host protocol revisions this package's schemas describe, newest first. A runtime built on
 * this package supports exactly these.
 */
export const HOST_PROTOCOL_REVISIONS: readonly Revision[] = [Revision.parse("2026-10-10")];

/** The outcome of {@link negotiateRevision}. */
export type RevisionNegotiation =
  | { readonly ok: true; readonly revision: Revision }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

const LISTED = 8;

function list(revisions: readonly string[]): string {
  const shown = revisions.slice(0, LISTED).join(", ");
  return revisions.length > LISTED ? `${shown} and ${revisions.length - LISTED} more` : shown;
}

/**
 * Picks the newest host protocol revision that both sides support. When there is none, returns
 * the refusal diagnostic `MOSTRA_HOST_REVISION_UNSUPPORTED`, which the instance sends back as the
 * error of `mostra/initialize`.
 *
 * Offered entries that are not revisions never match, and the message lists only well-formed
 * ones, so a malformed offer can't inject text into the diagnostic.
 */
export function negotiateRevision(
  offered: readonly string[],
  supported: readonly Revision[] = HOST_PROTOCOL_REVISIONS,
  options: CreateDiagnosticOptions = {},
): RevisionNegotiation {
  const offeredRevisions = [...new Set(offered.filter(isRevision))].sort(Revision.compare);
  const common = offeredRevisions.filter((revision) => supported.includes(revision));
  const newest = common.at(-1);
  if (newest !== undefined) return { ok: true, revision: newest };

  const supportedList = [...supported].sort(Revision.compare).reverse();
  const offeredText =
    offeredRevisions.length > 0
      ? `The client offered host protocol revisions ${list(offeredRevisions.reverse())}`
      : "The client offered no valid host protocol revision";
  return {
    ok: false,
    diagnostic: createDiagnostic(
      "MOSTRA_HOST_REVISION_UNSUPPORTED",
      { message: `${offeredText}; this instance supports ${list(supportedList)}.` },
      options,
    ),
  };
}
