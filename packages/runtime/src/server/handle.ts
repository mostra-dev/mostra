/**
 * The server handle an operator module receives (INTERFACES §18.6, D165 item 9): quarantine,
 * pause, suspension, link revocation, moving and restoring homes, and deletion. Every target names
 * a hosted route (`rte_…`), never a bare artifact or version ID, since those repeat across homes
 * when a project is copied: acting on one route never touches another home hosting the same
 * artifact ID or an identical version. Each call is durable when it resolves.
 */
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { OPERATOR_REVISION, type ServerHandle } from "@mostra/protocol/operator";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { DataDirectory } from "./data.ts";
import type { HostedHome } from "./hosted.ts";

/** Options for {@link createHandle}. */
export interface HandleOptions {
  readonly apiOrigin: string;
  /** The data directory; set once it is open (the handle is made before the operator loads). */
  readonly data: () => DataDirectory<HostedHome>;
  readonly directory: () => Ledger;
  /** Closes the bindings of a suspended home at once (the API origin's). */
  readonly suspended: (homeId: string) => void;
  readonly log: Log;
}

function unknownTarget(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message }));
}

/** Builds the handle. */
export function createHandle(options: HandleOptions): ServerHandle {
  const { log } = options;

  /** A route's home and artifact; an unknown route is refused, never guessed. */
  const route = (routeId: string): { readonly home: string; readonly artifactId: string } => {
    const row = options
      .directory()
      .read((db) =>
        db.get<{ home_id: string; artifact_id: string }>(
          "SELECT home_id, artifact_id FROM artifact_route WHERE id = ?",
          routeId,
        ),
      );
    if (!row) throw unknownTarget(`No hosted route ${routeId}.`);
    return { home: row.home_id, artifactId: row.artifact_id };
  };

  const homeOf = async (homeId: string): Promise<HostedHome> =>
    (await options.data().home(homeId)).assembled;

  const knownHome = (homeId: string): void => {
    const found = options
      .directory()
      .read((db) => db.get("SELECT 1 FROM home WHERE id = ?", homeId));
    if (!found) throw unknownTarget(`No hosted home ${homeId}.`);
  };

  return {
    revision: OPERATOR_REVISION,
    apiOrigin: options.apiOrigin,

    async quarantine(target, reason) {
      const found = route(target.routeId);
      const home = await homeOf(found.home);
      home.quarantine(
        found.artifactId,
        "versionId" in target ? target.versionId : undefined,
        reason,
      );
      log.info("operator.quarantine", { routeId: target.routeId });
    },

    async release(target) {
      const found = route(target.routeId);
      const home = await homeOf(found.home);
      home.release(found.artifactId, "versionId" in target ? target.versionId : undefined);
      log.info("operator.release", { routeId: target.routeId });
    },

    async pause(routeId, reason) {
      const found = route(routeId);
      (await homeOf(found.home)).pause(found.artifactId, { paused: true, by: "operator", reason });
      log.info("operator.pause", { routeId });
    },

    async resume(routeId) {
      const found = route(routeId);
      (await homeOf(found.home)).pause(found.artifactId, { paused: false, by: "operator" });
      log.info("operator.resume", { routeId });
    },

    async suspendHome(homeId, reason) {
      knownHome(homeId);
      options
        .directory()
        .write((db) =>
          db.run(
            "UPDATE home SET suspended_at = COALESCE(suspended_at, ?), suspend_reason = ? WHERE id = ?",
            new Date().toISOString(),
            reason.slice(0, 1_000),
            homeId,
          ),
        );
      options.suspended(homeId);
      await options.data().closeHome(homeId);
      log.info("operator.suspend_home", { home: homeId });
    },

    async resumeHome(homeId) {
      knownHome(homeId);
      options
        .directory()
        .write((db) =>
          db.run("UPDATE home SET suspended_at = NULL, suspend_reason = NULL WHERE id = ?", homeId),
        );
      log.info("operator.resume_home", { home: homeId });
    },

    async revokeLinks(routeId) {
      const found = route(routeId);
      const count = (await homeOf(found.home)).revokeLinks(found.artifactId);
      log.info("operator.revoke_links", { routeId, count });
      return count;
    },

    async revokeLink(tokenId) {
      const row = options
        .directory()
        .read((db) =>
          db.get<{ home_id: string }>(
            "SELECT home_id FROM hosted_token WHERE token_id = ?",
            tokenId,
          ),
        );
      if (!row) throw unknownTarget(`No hosted link ${tokenId}.`);
      if (!(await homeOf(row.home_id)).revokeLink(tokenId)) {
        throw unknownTarget(`No hosted link ${tokenId}.`);
      }
      log.info("operator.revoke_link", { tokenId });
    },

    async drainHome(homeId) {
      knownHome(homeId);
      options.suspended(homeId);
      await options.data().drain(homeId);
    },

    async releaseHome(homeId) {
      knownHome(homeId);
      options.data().undrain(homeId);
    },

    async restored(homeId) {
      knownHome(homeId);
      await options.data().restored(homeId);
      log.info("operator.restored", { home: homeId });
    },

    async remove(routeId) {
      const found = route(routeId);
      const home = await homeOf(found.home);
      try {
        await home.remove(found.artifactId);
      } finally {
        // The home reopens from its ledger on its next request, holding nothing of the artifact,
        // and nothing a removal cut off part-way left open in it (second Fable review, 8).
        await options.data().closeHome(found.home);
      }
      log.info("operator.remove", { routeId });
    },
  };
}
