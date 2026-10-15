/**
 * The submission policy in force (D10, D39, D63, D102): the first of the publish's `policy`, the
 * home's `HomeConfig.submission` and the manifest's request, else `once` per-artifact. It is
 * resolved at publish and stored on the artifact; `once` always carries its scope.
 */
import type { SubmissionPolicy } from "@mostra/protocol";

/** The policy when nobody asked for one: exactly one submission per artifact (D39). */
export const DEFAULT_POLICY: SubmissionPolicy = { policy: "once", scope: "per-artifact" };

/** The policy in force, from the sources in D102's order, with `once`'s scope filled in. */
export function policyInForce(
  ...sources: readonly (SubmissionPolicy | undefined)[]
): SubmissionPolicy {
  const chosen = sources.find((source) => source !== undefined) ?? DEFAULT_POLICY;
  return chosen.policy === "once"
    ? { policy: "once", scope: chosen.scope ?? "per-artifact" }
    : { policy: chosen.policy };
}

/** The stored policy of an artifact row; artifacts published before WP-06 get the default. */
export function storedPolicy(policyJson: string | null): SubmissionPolicy {
  return policyInForce(
    policyJson === null ? undefined : (JSON.parse(policyJson) as SubmissionPolicy),
  );
}
