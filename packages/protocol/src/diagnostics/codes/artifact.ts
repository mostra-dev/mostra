/**
 * Diagnostic codes of the ARTIFACT area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ARTIFACT area, in the order they were added. */
export const artifactDiagnosticCodes = [
  "MOSTRA_ARTIFACT_NOT_FOUND",
  "MOSTRA_ARTIFACT_SOURCE_MISSING",
  "MOSTRA_ARTIFACT_SOURCE_UNREADABLE",
  "MOSTRA_ARTIFACT_NO_ENTRY",
  "MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS",
  "MOSTRA_ARTIFACT_NO_PAGE",
  "MOSTRA_ARTIFACT_DIR_NOT_EMPTY",
  "MOSTRA_ARTIFACT_TEMPLATE_UNKNOWN",
  "MOSTRA_ARTIFACT_VERSION_NOT_FOUND",
  // gen:codes
] as const;

/** The codes of the ARTIFACT area. */
export type ArtifactDiagnosticCode = (typeof artifactDiagnosticCodes)[number];

/** The ARTIFACT area's catalog entries. */
export const artifactDiagnostics: AreaCatalog<ArtifactDiagnosticCode> = {
  MOSTRA_ARTIFACT_NOT_FOUND: {
    severity: "error",
    phase: "host",
    title: "Artifact not found",
    hint: "Check the artifact ID or source path, or list the home's artifacts with `mostra list`.",
    docs: {
      explanation:
        "The artifact named by an ID or a source path doesn't exist in this home: the ID was never published here, or the path was never published.",
      fix: "Use an ID or path from `mostra list`. A source that was never published becomes an artifact at its first `mostra publish`. A host that uses its own home sees only the artifacts published there.",
    },
  },
  MOSTRA_ARTIFACT_SOURCE_MISSING: {
    severity: "error",
    phase: "publish",
    title: "Artifact source missing",
    hint: "Publish from the artifact's source path, or restore the directory the message names.",
    docs: {
      explanation:
        "Publishing needs the artifact's source files. The path given, or the path the artifact was last published from, doesn't exist. Versions already published stay readable, because Mostra keeps a snapshot of their source in the home.",
      fix: "Pass the path where the source lives now. Its manifest `id`, if it has one, keeps the artifact identity at the new path.",
    },
  },
  MOSTRA_ARTIFACT_SOURCE_UNREADABLE: {
    severity: "error",
    phase: "publish",
    title: "Artifact source can't be read",
    hint: "Fix the file or directory the message names so your user can read it, then publish again.",
    docs: {
      explanation:
        "Mostra couldn't read a file of the artifact's source: permissions, a file that disappeared while it was copied, or two names that are the same after Unicode normalization. Nothing was published.",
      fix: "Make the named file readable, rename one of two clashing names, or exclude the file with `.mostraignore` in the artifact's root.",
    },
  },
  MOSTRA_ARTIFACT_NO_ENTRY: {
    severity: "error",
    phase: "manifest",
    title: "No entry file",
    hint: "Add `index.tsx` or `index.mdx` to the directory, or publish a single `.tsx` or `.mdx` file.",
    docs: {
      explanation:
        "An artifact is a single `.tsx`, `.jsx` or `.mdx` file, or a directory whose entry is `index.tsx`, `index.jsx` or `index.mdx`. The source given is neither.",
      fix: 'Create the entry: its default export is the page, and its manifest is `export const artifact = defineArtifact({ title: "..." })` (or frontmatter in MDX). For a single page, publish the file itself.',
    },
  },
  MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS: {
    severity: "error",
    phase: "manifest",
    title: "More than one entry file",
    hint: "Keep one entry file in the directory and rename or remove the others.",
    docs: {
      explanation:
        "A directory artifact has exactly one entry, and this directory has more than one of `index.tsx`, `index.jsx` and `index.mdx`, so Mostra can't tell which one is the page.",
      fix: "Keep the entry you mean and rename the others, for example into `components/`.",
    },
  },
  MOSTRA_ARTIFACT_NO_PAGE: {
    severity: "error",
    phase: "manifest",
    title: "Entry has no page",
    hint: "Export the page component as the entry's default export, or add a `pages/` folder.",
    docs: {
      explanation:
        "The entry has no default export and the artifact has no `pages/` folder, so there is nothing to render. With `pages/`, each file there is a route and the entry's default export, when present, is the layout around them.",
      fix: "Add `export default function Page() { ... }` to the entry, or move pages into `pages/index.tsx`, `pages/settings.tsx` and so on.",
    },
  },
  MOSTRA_ARTIFACT_DIR_NOT_EMPTY: {
    severity: "error",
    phase: "host",
    title: "Directory isn't empty",
    hint: "Choose a new or empty directory for the artifact.",
    docs: {
      explanation:
        "Creating an artifact writes its entry into a directory, and the directory given already has files. Mostra never overwrites them.",
      fix: "Pass a path that doesn't exist yet or an empty directory. To make existing files an artifact, add the entry yourself and publish.",
    },
  },
  MOSTRA_ARTIFACT_TEMPLATE_UNKNOWN: {
    severity: "error",
    phase: "host",
    title: "Unknown template",
    hint: "Create the artifact without a template, or use a template this Mostra release provides.",
    docs: {
      explanation:
        "The template named isn't one this runtime provides. Without a template, Mostra writes a minimal entry with a generated artifact ID.",
      fix: "Leave out the template, or use one of the templates of this release.",
    },
  },
  MOSTRA_ARTIFACT_VERSION_NOT_FOUND: {
    severity: "error",
    phase: "host",
    title: "No such version",
    hint: "Name a version the artifact has (`artifact/get` lists them), or leave the version out for the latest.",
    docs: {
      explanation:
        "The request named a version number or version ID that this artifact never published in this home. Viewers only ever open published versions (D09), so there is nothing to show.",
      fix: "List the artifact's versions with `artifact/get` and pick one, or omit the version to open the latest. A link to `/a/<artifactId>/v/<number>` needs a number from that list.",
    },
  },
  // gen:entries
};
