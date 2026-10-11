/**
 * The one diagnostic object every Mostra interface uses for errors, warnings and hints
 * (INTERFACES §1 and §13, AX-03).
 */
import * as z from "zod";
import { wireRegistry } from "../wire-registry.ts";

/**
 * Diagnostic areas. A code is `MOSTRA_<AREA>_<NAME>`. INTERFACES §13 holds the authoritative list,
 * which only grows.
 */
export type DiagnosticArea =
  | "MANIFEST"
  | "BUILD"
  | "TYPE"
  | "LINT"
  | "DEP"
  | "KIT"
  | "FIELD"
  | "ACTION"
  | "LIVE"
  | "RUNTIME"
  | "CONSOLE"
  | "NETWORK"
  | "A11Y"
  | "VISUAL"
  | "SMOKE"
  | "REGRESSION"
  | "TERM"
  | "PUBLISH"
  | "SUBMIT"
  | "HOST"
  | "HOME"
  | "HYGIENE"
  | "SECRET"
  | "SHARE"
  | "VERIFY"
  | "TARGET"
  | "ENV"
  | "PLATFORM"
  | "ARTIFACT";

/** Every diagnostic area, in INTERFACES §13 order. */
export const DIAGNOSTIC_AREAS: readonly DiagnosticArea[] = [
  "MANIFEST",
  "BUILD",
  "TYPE",
  "LINT",
  "DEP",
  "KIT",
  "FIELD",
  "ACTION",
  "LIVE",
  "RUNTIME",
  "CONSOLE",
  "NETWORK",
  "A11Y",
  "VISUAL",
  "SMOKE",
  "REGRESSION",
  "TERM",
  "PUBLISH",
  "SUBMIT",
  "HOST",
  "HOME",
  "HYGIENE",
  "SECRET",
  "SHARE",
  "VERIFY",
  "TARGET",
  "ENV",
  "PLATFORM",
  "ARTIFACT",
];

/**
 * A diagnostic code. Codes are semver surface: once released, a code keeps its meaning and is
 * never removed (AX-03).
 */
export type DiagnosticCode = `MOSTRA_${DiagnosticArea}_${string}`;

/**
 * How bad it is. `error` is only for definite failures; observations that might be fine are
 * warnings (D72).
 */
export type DiagnosticSeverity = "error" | "warning" | "hint";

/** The stage of work that produced the diagnostic. */
export type DiagnosticPhase =
  | "manifest"
  | "compile"
  | "lint"
  | "runtime"
  | "console"
  | "network"
  | "a11y"
  | "visual"
  | "smoke"
  | "regression"
  | "contract"
  | "publish"
  | "host"
  | "hygiene"
  | "platform";

/**
 * A machine-applicable fix. `range` is `[startLine, startColumn, endLine, endColumn]`, 1-based,
 * with the end exclusive.
 */
export interface DiagnosticFix {
  /** Replace, insert or delete text in `file`, or run `command`. */
  readonly kind: "replace" | "insert" | "delete" | "command";
  /** The file to edit, relative to the artifact or project root. */
  readonly file?: string;
  /** The span to edit. */
  readonly range?: readonly [number, number, number, number];
  /** The replacement or inserted text. */
  readonly text?: string;
  /** The command to run, for `kind: "command"`. */
  readonly command?: string;
}

/** Where the problem is: a source position (1-based) or a place in a rendered viewport. */
export type DiagnosticLocation =
  | { readonly file: string; readonly line: number; readonly column: number }
  | { readonly viewport: string; readonly selector?: string };

/** One diagnostic (INTERFACES §13). */
export interface Diagnostic {
  /** The stable code, `MOSTRA_<AREA>_<NAME>`. */
  readonly code: DiagnosticCode;
  /** How bad it is. */
  readonly severity: DiagnosticSeverity;
  /** What is wrong, for this occurrence. */
  readonly message: string;
  /** What to do: one imperative sentence. */
  readonly hint?: string;
  /** A machine-applicable fix, when one exists. */
  readonly fix?: DiagnosticFix;
  /** Where the problem is, when it has a place. */
  readonly location?: DiagnosticLocation;
  /** The stage of work that produced it. */
  readonly phase: DiagnosticPhase;
  /** The code's documentation page: `${docsBase}/errors/${code}` (D37). */
  readonly docs: string;
  /** How many identical occurrences this one stands for, when deduplicated. */
  readonly count?: number;
}

const positiveInt = z.int().min(1);

/**
 * Codes on the wire accept any area, so a client keeps working when a newer Mostra reports a code
 * from an area it doesn't know yet. Producers are typed against {@link DiagnosticArea}.
 */
const codeSchema = z
  .string()
  .regex(/^MOSTRA_[A-Z0-9]+_[A-Z0-9_]+$/)
  .register(wireRegistry, {
    id: "DiagnosticCode",
    description: "Stable diagnostic code: MOSTRA_<AREA>_<NAME>.",
  }) as unknown as z.ZodType<DiagnosticCode, string>;

/** The Zod schema of the `DiagnosticSeverity` type. */
export const DiagnosticSeverity: z.ZodType<DiagnosticSeverity, string> = z
  .enum(["error", "warning", "hint"])
  .register(wireRegistry, {
    id: "DiagnosticSeverity",
    description: "How bad it is: error only for definite failures.",
  });

/** The Zod schema of the `DiagnosticPhase` type. */
export const DiagnosticPhase: z.ZodType<DiagnosticPhase, string> = z
  .enum([
    "manifest",
    "compile",
    "lint",
    "runtime",
    "console",
    "network",
    "a11y",
    "visual",
    "smoke",
    "regression",
    "contract",
    "publish",
    "host",
    "hygiene",
    "platform",
  ])
  .register(wireRegistry, {
    id: "DiagnosticPhase",
    description: "The stage of work that produced the diagnostic.",
  });

/** The Zod schema of the `DiagnosticFix` type. */
export const DiagnosticFix: z.ZodType<DiagnosticFix> = z
  .object({
    kind: z.enum(["replace", "insert", "delete", "command"]),
    file: z.string().exactOptional(),
    range: z.tuple([positiveInt, positiveInt, positiveInt, positiveInt]).readonly().exactOptional(),
    text: z.string().exactOptional(),
    command: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "DiagnosticFix",
    description:
      "A machine-applicable fix; range is [startLine, startColumn, endLine, endColumn], 1-based, end exclusive.",
  });

/** The Zod schema of the `DiagnosticLocation` type. */
export const DiagnosticLocation: z.ZodType<DiagnosticLocation> = z
  .union([
    z.object({ file: z.string(), line: positiveInt, column: positiveInt }),
    z.object({ viewport: z.string(), selector: z.string().exactOptional() }),
  ])
  .register(wireRegistry, {
    id: "DiagnosticLocation",
    description: "A 1-based source position, or a place in a rendered viewport.",
  });

/** The Zod schema of the `Diagnostic` type. */
export const Diagnostic: z.ZodType<Diagnostic> = z
  .object({
    code: codeSchema,
    severity: DiagnosticSeverity,
    message: z.string(),
    hint: z.string().exactOptional(),
    fix: DiagnosticFix.exactOptional(),
    location: DiagnosticLocation.exactOptional(),
    phase: DiagnosticPhase,
    docs: z.url(),
    count: positiveInt.exactOptional(),
  })
  .register(wireRegistry, {
    id: "Diagnostic",
    description: "One diagnostic: a stable code, severity, message, hint, fix and docs link.",
  });
