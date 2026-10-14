/**
 * `@mostra/react`: the client runtime artifact authors import. This release has the manifest
 * helper and the client side of server functions; fields, submissions, signals, actions and live
 * data join it in later releases (INTERFACES §2.3).
 *
 * ```tsx
 * import { defineArtifact } from "@mostra/react";
 *
 * export const artifact = defineArtifact({ title: "Sidebar options", family: "review" });
 *
 * export default function Page() {
 *   return <h1>Sidebar options</h1>;
 * }
 * ```
 *
 * @packageDocumentation
 */
import type { ArtifactManifest } from "@mostra/protocol";

export type { ArtifactManifest } from "@mostra/protocol";
export { createServerReference, type ServerReference } from "./server-reference.ts";
export { connectShell, openLink, reportReady, type ShellConnection } from "./shell-bridge.ts";

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
