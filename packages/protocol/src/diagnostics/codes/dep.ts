/**
 * Diagnostic codes of the DEP area: the packages an artifact imports (D20, D43, D95).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the DEP area, in the order they were added. */
export const depDiagnosticCodes = [
  "MOSTRA_DEP_MISSING",
  "MOSTRA_DEP_NOT_FOUND",
  "MOSTRA_DEP_OFFLINE",
  "MOSTRA_DEP_TIMEOUT",
  "MOSTRA_DEP_INSTALL_FAILED",
  "MOSTRA_DEP_WARM_CONFLICT",
  "MOSTRA_DEP_SPEC_INVALID",
  // gen:codes
] as const;

/** The codes of the DEP area. */
export type DepDiagnosticCode = (typeof depDiagnosticCodes)[number];

/** The DEP area's catalog entries. */
export const depDiagnostics: AreaCatalog<DepDiagnosticCode> = {
  MOSTRA_DEP_MISSING: {
    severity: "error",
    phase: "compile",
    title: "Package not added",
    hint: "Run the `mostra add` command in this diagnostic's fix, then publish again.",
    docs: {
      explanation:
        "The artifact imports a package that is neither in Mostra's warm set nor in the artifact's lockfile, and the host has set the dependency policy to `explicit`. Under that policy a package enters an artifact's lockfile only when it is added on purpose, so Mostra installs nothing on its own. The location points at the first import of the package, and the fix carries the exact command that adds every missing package.",
      fix: "Run the command from the fix (`mostra add <package…> --artifact <path>`, or the host protocol method `deps/add`), then publish again. To use a package from the warm set instead, change the import.",
    },
  },
  MOSTRA_DEP_NOT_FOUND: {
    severity: "error",
    phase: "compile",
    title: "Package not found",
    hint: "Check the package name and version against the npm registry, then fix the import or the spec.",
    docs: {
      explanation:
        "The registry has no package by that name, or no version that matches the requested one. A spec without an exact version only matches releases at least a day old, so a package whose every release is newer than that isn't found either. The message names the package and what the registry answered.",
      fix: "Correct the package name in the import or in the `mostra add` spec. To use a release less than a day old, add it at its exact version: `mostra add <package>@<version>`.",
    },
  },
  MOSTRA_DEP_OFFLINE: {
    severity: "error",
    phase: "compile",
    title: "Package unavailable offline",
    hint: "Connect to the network and publish again, or import a package the home already holds.",
    docs: {
      explanation:
        "Mostra is offline (`MOSTRA_OFFLINE` is set, no network interface is up, or the registry can't be reached), and the artifact needs a package that the home's package store doesn't hold yet. Everything the store holds keeps working offline, including rebuilds of published versions. The message names the missing package.",
      fix: "Publish again once the registry is reachable; the package then stays in the store for later offline use. Otherwise remove the import, or use a package from the warm set.",
    },
  },
  MOSTRA_DEP_TIMEOUT: {
    severity: "error",
    phase: "compile",
    title: "Package install timed out",
    hint: "Check the network and the registry, then publish again.",
    docs: {
      explanation:
        "Installing the artifact's packages took longer than 300 seconds and was stopped. A slow registry, a stalled download or a lifecycle script that never ends are the usual causes. Nothing was published, and packages already in the store stay there.",
      fix: "Publish again; packages that finished downloading aren't fetched twice. When a package's install script hangs, use another version of the package or another package.",
    },
  },
  MOSTRA_DEP_INSTALL_FAILED: {
    severity: "error",
    phase: "compile",
    title: "Package install failed",
    hint: "Read the installer's output in the message, then fix the package spec or choose another version.",
    docs: {
      explanation:
        "The package installer failed for a reason other than a missing package or the network: most often a package's lifecycle script (`preinstall`, `install`, `postinstall`) exited with an error, or a downloaded package didn't match its integrity hash. Lifecycle scripts run in an install child in the artifact's directory with the artifact's environment. The message carries the end of the installer's output.",
      fix: "Fix what the output names. For a failing install script, check what it needs (a compiler, a system library) or use another version of the package.",
    },
  },
  MOSTRA_DEP_WARM_CONFLICT: {
    severity: "error",
    phase: "compile",
    title: "Warm package version requested",
    hint: "Add the package without a version, or with one the warm set's version satisfies.",
    docs: {
      explanation:
        "The package is part of Mostra's warm set, which every artifact resolves at one fixed version so that React and the other shared packages exist exactly once. The requested version doesn't match the warm one, and an artifact can't replace a warm package.",
      fix: "Drop the version from the spec (`mostra add react`), or request a range the warm version satisfies. The message names the warm version.",
    },
  },
  MOSTRA_DEP_SPEC_INVALID: {
    severity: "error",
    phase: "host",
    title: "Invalid package spec",
    hint: "Write the spec as `name`, `name@version`, `name@range` or `name@tag`.",
    docs: {
      explanation:
        "A package spec given to `mostra add` (`deps/add`) isn't an npm registry spec. Mostra adds packages from the registry by name, optionally with a version, a semver range or a dist-tag; scoped names such as `@scope/name@1.2.3` work too. Git URLs, local paths and tarball URLs aren't registry specs.",
      fix: "Correct the spec, for example `mostra add three@0.186.1` or `mostra add @xyflow/react`.",
    },
  },
  // gen:entries
};
