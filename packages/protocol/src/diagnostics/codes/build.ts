/**
 * Diagnostic codes of the BUILD area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the BUILD area, in the order they were added. */
export const buildDiagnosticCodes = [
  "MOSTRA_BUILD_FAILED",
  "MOSTRA_BUILD_UNRESOLVED",
  "MOSTRA_BUILD_CRASHED",
  "MOSTRA_BUILD_TIMEOUT",
  // gen:codes
] as const;

/** The codes of the BUILD area. */
export type BuildDiagnosticCode = (typeof buildDiagnosticCodes)[number];

/** The BUILD area's catalog entries. */
export const buildDiagnostics: AreaCatalog<BuildDiagnosticCode> = {
  MOSTRA_BUILD_FAILED: {
    severity: "error",
    phase: "compile",
    title: "Build failed",
    hint: "Fix the error at the reported location, then publish again.",
    docs: {
      explanation:
        "The builder couldn't bundle the artifact: a syntax error, an invalid JSX or MDX construct, a CSS error or another bundler error. The message carries the bundler's own explanation, and the location points at the file, line and column when the bundler reports one. Nothing was published.",
      fix: "Open the reported file at the reported line and fix the code there. For MDX, check that JSX in the document is closed and that `{` and `<` in prose are escaped. Run `mostra verify` to see the same error with the type checker's findings.",
    },
  },
  MOSTRA_BUILD_UNRESOLVED: {
    severity: "error",
    phase: "compile",
    title: "Import can't be resolved",
    hint: "Correct the import path, or import the package from the warm set or add it with `mostra add`.",
    docs: {
      explanation:
        "An import in the artifact names a file or package the builder can't find. Relative imports resolve inside the artifact's own files, `@/...` resolves from the artifact's root, and package imports resolve from Mostra's warm set and the artifact's installed packages. The message names the import and the file that contains it.",
      fix: "For a file, check the path and its extension against the artifact's files. For a package, check its name; packages outside the warm set install with `mostra add <package>`.",
    },
  },
  MOSTRA_BUILD_CRASHED: {
    severity: "error",
    phase: "compile",
    title: "Builder crashed",
    hint: "Publish again; if it crashes again, report the builder's last output from the message.",
    docs: {
      explanation:
        "The builder child process exited before it finished, for example after running out of memory or on a signal. The supervisor and everything else in the instance keep working, and nothing was published. The message carries the builder's last lines of error output.",
      fix: "Run the publish again, which starts a fresh builder. A crash that repeats points at the artifact's size or at a defect in Mostra: very large inline data is better kept in `public/` or loaded through a live source.",
    },
  },
  MOSTRA_BUILD_TIMEOUT: {
    severity: "error",
    phase: "compile",
    title: "Build timed out",
    hint: "Make the build smaller, for example by moving large data into `public/`, then publish again.",
    docs: {
      explanation:
        "The build took longer than its limit (180 seconds) and was stopped. Nothing was published.",
      fix: "Move large data files that are imported into code into `public/` and fetch them at run time, split very large modules, and remove unused imports of heavy libraries. Then publish again.",
    },
  },
  // gen:entries
};
