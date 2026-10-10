/**
 * The diagnostic catalog: one entry per code, declared in one source file per area under
 * `codes/`. The catalog feeds `createDiagnostic`, the generated catalog JSON and one docs
 * page per code (AX-03).
 */
import type {
  Diagnostic,
  DiagnosticArea,
  DiagnosticFix,
  DiagnosticLocation,
  DiagnosticPhase,
  DiagnosticSeverity,
} from "./diagnostic.ts";

/** Everything Mostra knows about one code, besides the code itself. */
export interface DiagnosticSpec {
  /** The severity of every occurrence. */
  readonly severity: DiagnosticSeverity;
  /** The stage of work that reports it. */
  readonly phase: DiagnosticPhase;
  /** One line naming the condition. It is the docs page's title. */
  readonly title: string;
  /** The default hint: one imperative sentence. An occurrence may give a more specific one. */
  readonly hint: string;
  /** The docs page body. */
  readonly docs: {
    /** What the code means and when Mostra reports it. */
    readonly explanation: string;
    /** The minimal fix. */
    readonly fix: string;
  };
  /**
   * Set when Mostra no longer reports the code, saying what replaced it. Codes are never
   * removed (AX-03).
   */
  readonly deprecated?: string;
}

/** The catalog of one area: exactly the codes `C`, each with its spec. */
export type AreaCatalog<C extends `MOSTRA_${DiagnosticArea}_${string}`> = {
  readonly [K in C]: DiagnosticSpec;
};

/**
 * Where diagnostics link by default: the GitHub Pages docs site (D37). Hosts and the runtime pass
 * their own base when the docs move.
 */
export const DEFAULT_DOCS_BASE: string = "https://mostra-dev.github.io/mostra";

/** The docs page for `code` under `docsBase`: `${docsBase}/errors/${code}`. */
export function docsUrl(code: string, docsBase: string = DEFAULT_DOCS_BASE): string {
  return `${docsBase.replace(/\/+$/, "")}/errors/${code}`;
}

/** The parts of a diagnostic that belong to one occurrence rather than to its code. */
export interface DiagnosticDetails {
  /** What is wrong, for this occurrence. Never include secrets or capability tokens. */
  readonly message: string;
  /** Replaces the catalog's default hint when the occurrence allows a more specific one. */
  readonly hint?: string;
  /** A machine-applicable fix. */
  readonly fix?: DiagnosticFix;
  /** Where the problem is. */
  readonly location?: DiagnosticLocation;
  /** How many identical occurrences this one stands for. */
  readonly count?: number;
}

/**
 * Builds a diagnostic for a cataloged code: severity, phase, hint and docs link come from `spec`,
 * the rest from `details`.
 */
export function buildDiagnostic(
  code: Diagnostic["code"],
  spec: DiagnosticSpec,
  details: DiagnosticDetails,
  docsBase: string = DEFAULT_DOCS_BASE,
): Diagnostic {
  const { hint = spec.hint, ...rest } = details;
  return {
    code,
    severity: spec.severity,
    phase: spec.phase,
    docs: docsUrl(code, docsBase),
    hint,
    ...rest,
  };
}
