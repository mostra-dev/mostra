/**
 * Diagnostic codes of the PUBLISH area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the PUBLISH area, in the order they were added. */
export const publishDiagnosticCodes = [
  "MOSTRA_PUBLISH_ID_CONFLICT",
  "MOSTRA_PUBLISH_SOURCE_CHANGED",
  // gen:codes
] as const;

/** The codes of the PUBLISH area. */
export type PublishDiagnosticCode = (typeof publishDiagnosticCodes)[number];

/** The PUBLISH area's catalog entries. */
export const publishDiagnostics: AreaCatalog<PublishDiagnosticCode> = {
  MOSTRA_PUBLISH_ID_CONFLICT: {
    severity: "error",
    phase: "publish",
    title: "Artifact ID claimed by two sources",
    hint: "Give one of the two sources a different `id`, or delete the `id` line from the copy so it becomes a new artifact.",
    docs: {
      explanation:
        "An artifact's `id` names exactly one source. Mostra reports this code when a manifest claims an `id` that is already bound to another source path whose entry still claims it, which usually means a directory was copied. A source that moved, so that the old path no longer claims the `id`, is rebound instead. The message names both paths.",
      fix: "Decide which source is the artifact. In the other one, remove the `id` from the manifest (it is then bound to its own path at its first publish) or replace it with a new ID from `mostra new`.",
    },
  },
  MOSTRA_PUBLISH_SOURCE_CHANGED: {
    severity: "error",
    phase: "publish",
    title: "Source changed during the publish",
    hint: "Publish again once the artifact's files have stopped changing.",
    docs: {
      explanation:
        "Publishing reads the entry's manifest twice: once to find the artifact, and again from the snapshot it builds. Mostra reports this code when the two disagree about which artifact the source is, because the manifest `id` or the source's binding changed while the publish ran, for example when an editor saved the entry mid-publish or another publish rebound the path. Nothing was published.",
      fix: "Wait until the files are saved and nothing else is publishing the same source, then publish again. If the manifest `id` was changed on purpose, the next publish uses the new one.",
    },
  },
  // gen:entries
};
