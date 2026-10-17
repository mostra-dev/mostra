/**
 * Diagnostic codes of the TYPE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the TYPE area, in the order they were added. */
export const typeDiagnosticCodes = [
  "MOSTRA_TYPE_ERROR",
  "MOSTRA_TYPE_UNTYPED_PACKAGE",
  // gen:codes
] as const;

/** The codes of the TYPE area. */
export type TypeDiagnosticCode = (typeof typeDiagnosticCodes)[number];

/** The TYPE area's catalog entries. */
export const typeDiagnostics: AreaCatalog<TypeDiagnosticCode> = {
  MOSTRA_TYPE_ERROR: {
    severity: "error",
    phase: "compile",
    title: "Type error",
    hint: "Fix the type error at the reported location; the message carries TypeScript's code and text.",
    docs: {
      explanation:
        "TypeScript's checker (`tsc --noEmit`, TypeScript 7) found an error in the artifact's code. Verify checks with the artifact's own `tsconfig.json` when it has one, else in strict mode without the unused-variable rules, and resolves imports exactly as the build does. MDX isn't checked.",
      fix: "Open the file at the reported line and fix the code, for example a missing property, a wrong argument type or a misspelled import.",
    },
  },
  MOSTRA_TYPE_UNTYPED_PACKAGE: {
    severity: "warning",
    phase: "compile",
    title: "Package without type declarations",
    hint: "Nothing breaks: the package works without types; declare a module for it if you want them checked.",
    docs: {
      explanation:
        "The artifact imports a package that ships no type declarations (TypeScript's TS7016). The package still builds and runs, so this is a warning: its values are typed `any`.",
      fix: 'Optionally add a declaration file such as `declare module "<package>";`, or a typed wrapper, to the artifact.',
    },
  },
  // gen:entries
};
