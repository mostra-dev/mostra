/**
 * `@mostra/react`: the client runtime artifact authors import (INTERFACES §2.3). Fields that behave
 * like `useState` with a stable ID and persist as the viewer works, the artifact channel's
 * submit, the shell's trusted Submit label, signals, review-set choices, the viewer and the
 * artifact, a Claude-compatible `window.storage`, and the manifest helper. `@mostra/react/form`
 * adapts react-hook-form; `@mostra/react/router` mounts `pages/` artifacts.
 *
 * ```tsx
 * import { defineArtifact, useField, useSubmitControl } from "@mostra/react";
 *
 * export const artifact = defineArtifact({ title: "Sidebar options", family: "review" });
 *
 * export default function Page() {
 *   const [layout, setLayout] = useField("layout", "left", { label: "Layout", required: true });
 *   useSubmitControl({ label: "Send my choice" });
 *   return <select value={layout} onChange={(e) => setLayout(e.target.value)}>…</select>;
 * }
 * ```
 *
 * @packageDocumentation
 */
import type { ArtifactManifest } from "@mostra/protocol";

export type { ArtifactManifest, SubmissionSummary, SubmitBlocker } from "@mostra/protocol";
export {
  type ArtifactMode,
  type ChoiceCandidate,
  type FieldMeta,
  type FieldOptions,
  type StandardSchema,
  type SubmitHandle,
  useArtifact,
  useChoice,
  useField,
  useSignal,
  useSubmit,
  useSubmitControl,
  useViewer,
} from "./hooks.ts";
export { mountArtifact } from "./mount.ts";
export { type DiagnosticLike, MostraError } from "./runtime/errors.ts";
export type { SubmitState } from "./runtime/store.ts";
export { createServerReference, type ServerReference } from "./server-reference.ts";
export { connectShell, openLink, reportReady, type ShellConnection } from "./shell-bridge.ts";
export type { ClaudeCompatibleStorage, StorageEntry } from "./storage.ts";

/**
 * Declares an artifact's manifest (INTERFACES §2.2, D51). Mostra reads the object statically
 * without running the page, so write every value as a literal: strings, numbers, booleans, arrays
 * and objects. At run time it returns its argument unchanged.
 *
 * ```ts
 * export const artifact = defineArtifact({ title: "Q3 plan", family: "proposal" });
 * ```
 */
export function defineArtifact<const M extends ArtifactManifest>(manifest: M): M {
  return manifest;
}
