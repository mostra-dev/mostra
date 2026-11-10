/**
 * A hosted artifact's shared state and live values live on its hosted home (D165 item 1;
 * INTERFACES §18.2): the owner's own `state/get`, `state/patch` and `live/push`, and its server
 * code's `state`, act there through the link, refused with `MOSTRA_REMOTE_UNREACHABLE` when it
 * can't be reached, and are never applied here alone.
 */
import {
  type ArtifactPauseResult,
  type ArtifactRef,
  artifactPauseMethod,
  livePushMethod,
  MutationId,
  stateGetMethod,
  statePatchMethod,
} from "@mostra/protocol";
import type { HostedState } from "../actions/index.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import type { Link } from "./manager.ts";

const FORWARDED = new Set([stateGetMethod.method, statePatchMethod.method, livePushMethod.method]);

/** Server code's `state` for an artifact hosted somewhere, else `undefined`. */
export function hostedState(link: Link, artifactId: string): HostedState | undefined {
  const server = link.hostedOn(artifactId);
  if (server === undefined) return undefined;
  const artifact = { artifactId };
  return {
    get: (ids) =>
      link.forward(server, stateGetMethod, {
        artifact,
        ...(ids !== undefined ? { ids: [...ids] } : {}),
      }),
    patch: (input) =>
      link.forward(server, statePatchMethod, {
        artifact,
        ops: input.ops as never,
        mutationId: input.mutationId ?? MutationId.create(),
        ...(input.baseRevision !== undefined ? { baseRevision: input.baseRevision } : {}),
        as: "agent",
        ...(input.runId !== undefined ? { causation: { runId: input.runId } } : {}),
      }),
  };
}

/**
 * Wraps the instance's `state/get`, `state/patch` and `live/push` so that, for a hosted artifact,
 * they act on its hosted home: the same params, the artifact named by its ID there.
 */
export function forwardHosted(
  link: Link,
  resolve: (ref: ArtifactRef) => string,
  handlers: readonly MethodHandler[],
): MethodHandler[] {
  return handlers.map((entry) => {
    if (!FORWARDED.has(entry.definition.method)) return entry;
    return {
      definition: entry.definition,
      handle: (params, session) => {
        const input = params as { readonly artifact: ArtifactRef };
        const artifactId = resolve(input.artifact);
        const server = link.hostedOn(artifactId);
        if (server === undefined) return entry.handle(params, session);
        return link.forward(server, entry.definition, { ...input, artifact: { artifactId } });
      },
    };
  });
}

/**
 * The owner's `artifact/pause` (D165 item 14): pauses or resumes the artifact here and on every
 * server it is hosted on, each as its owner. A server where the operator paused it answers that
 * only the operator resumes it (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`); one that can't be reached is
 * `MOSTRA_REMOTE_UNREACHABLE`, and the call can be made again, since a pause is idempotent.
 */
export function pauseHandler(
  link: Link,
  resolve: (ref: ArtifactRef) => string,
  pause: (
    artifactId: string,
    change: { readonly paused: boolean; readonly by: "owner"; readonly reason?: string },
  ) => ArtifactPauseResult,
): MethodHandler {
  return handler(artifactPauseMethod, async (params) => {
    const artifactId = resolve(params.artifact);
    let byOperator = false;
    for (const server of link.hostedServers(artifactId)) {
      const answer = await link.forward(server, artifactPauseMethod, {
        artifact: { artifactId },
        paused: params.paused,
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
      });
      if (answer.by === "operator") byOperator = true;
    }
    const local = pause(artifactId, {
      paused: params.paused,
      by: "owner",
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    });
    return byOperator ? { paused: true, by: "operator" } : local;
  });
}
