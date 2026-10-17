/**
 * The authoring methods of the host protocol (INTERFACES §6): `artifact/create`,
 * `artifact/publish`, `artifact/list`, `artifact/get` and `deps/add`.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  ARTIFACT_PROGRESS,
  type ArtifactRef,
  artifactCreateMethod,
  artifactGetMethod,
  artifactListMethod,
  artifactPublishMethod,
  artifactVerifyMethod,
  depsAddMethod,
} from "@mostra/protocol";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import type { Registry } from "../registry/index.ts";
import type { Publisher } from "./publisher.ts";

/**
 * A path as bindings store it (D51): its real path, or, for a path that no longer exists, the real
 * path of its nearest existing ancestor joined with the rest.
 */
function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    // The native realpath(3), as `resolveSource` uses: on a case- or normalization-insensitive
    // file system it returns the on-disk spelling the binding was stored with.
    return realpathSync.native(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonical(parent), basename(absolute));
  }
}

/**
 * A path as an `ArtifactRef` names it: canonical, so a moved or deleted source still names its
 * artifact (INTERFACES §6).
 */
export function canonicalRef(ref: ArtifactRef): ArtifactRef {
  return "path" in ref ? { path: canonical(ref.path) } : ref;
}

/**
 * The handlers of the authoring methods. `publisher` is called on first use, so an instance
 * whose runtime lacks the warm set still starts and reports `MOSTRA_ENV_WARM_MISSING` per call.
 */
export function artifactMethods(options: {
  readonly registry: Registry;
  readonly publisher: () => Publisher;
  /**
   * The artifact's default capability link (D90, D97 item 3), added to every receipt, replays
   * included. Recorded receipts never hold it: the ledger keeps no link's secret.
   */
  readonly link?: (artifactId: string) => { readonly url: string; readonly tokenId: string };
  /**
   * Hears every publish that succeeded, a reused version too: a publish clears the artifact's
   * parked workers (FAILURE_MODEL §2).
   */
  readonly published?: (artifactId: string) => void;
  /** Sends a notification on a session's connection (`artifact/progress`). */
  readonly notify?: (session: number, method: string, params: Record<string, unknown>) => void;
}): MethodHandler[] {
  const { registry } = options;
  return [
    handler(artifactCreateMethod, (params) => options.publisher().create(params)),
    handler(artifactPublishMethod, async (params) => {
      const receipt = await options.publisher().publish(params);
      options.published?.(receipt.artifactId);
      return options.link ? { ...receipt, ...options.link(receipt.artifactId) } : receipt;
    }),
    handler(depsAddMethod, (params) => options.publisher().addDependencies(params)),
    handler(artifactVerifyMethod, (params, session) => {
      const token = params.progressToken;
      // Progress only to a client that asked for it and accepts the notification (D84).
      const progress =
        token !== undefined && session.notifications.has(ARTIFACT_PROGRESS) && options.notify
          ? (stage: string) =>
              options.notify?.(session.id, ARTIFACT_PROGRESS, { progressToken: token, stage })
          : undefined;
      return options.publisher().verify(params, progress);
    }),
    handler(artifactListMethod, (params) => ({ artifacts: registry.list(params.filter ?? {}) })),
    handler(artifactGetMethod, (params) => {
      return registry.get(canonicalRef(params.artifact));
    }),
  ];
}
