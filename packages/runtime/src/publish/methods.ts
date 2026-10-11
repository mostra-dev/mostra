/**
 * The authoring methods of the host protocol (INTERFACES §6): `artifact/create`,
 * `artifact/publish`, `artifact/list` and `artifact/get`.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  type ArtifactRef,
  artifactCreateMethod,
  artifactGetMethod,
  artifactListMethod,
  artifactPublishMethod,
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
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonical(parent), basename(absolute));
  }
}

/**
 * The handlers of the authoring methods. `publisher` is called on first use, so an instance
 * whose runtime lacks the warm set still starts and reports `MOSTRA_ENV_WARM_MISSING` per call.
 */
export function artifactMethods(options: {
  readonly registry: Registry;
  readonly publisher: () => Publisher;
}): MethodHandler[] {
  const { registry } = options;
  return [
    handler(artifactCreateMethod, (params) => options.publisher().create(params)),
    handler(artifactPublishMethod, (params) => options.publisher().publish(params)),
    handler(artifactListMethod, (params) => ({ artifacts: registry.list(params.filter ?? {}) })),
    handler(artifactGetMethod, (params) => {
      const ref: ArtifactRef =
        "path" in params.artifact ? { path: canonical(params.artifact.path) } : params.artifact;
      return registry.get(ref);
    }),
  ];
}
