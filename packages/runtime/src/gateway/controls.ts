/**
 * The submit channels and trusted controls in force for a view (D40, D108). A host that
 * registered the `trustedControls` port answers per artifact; otherwise the home's
 * `HomeConfig.submitChannels` holds; otherwise both channels, as D40's standalone default.
 */
import {
  type ArtifactDetail,
  type ControlsPolicy,
  portTrustedControlsPolicyMethod,
  type SubmitChannel,
} from "@mostra/protocol";
import type { Log } from "../log.ts";

/** How long a host has to answer `port/trustedControls.policy`: a page waits for it (D108). */
export const CONTROLS_POLICY_TIMEOUT_MS = 5_000;

/** Both channels, every control. */
const STANDALONE: ControlsPolicy = { submitChannels: ["shell", "artifact"] };

/** The shell channel only: what a host's failed answer narrows a view to. */
const SHELL_ONLY: ControlsPolicy = { submitChannels: ["shell"] };

/** What {@link controlsPolicy} reads. */
export interface ControlsPolicyInput {
  /** The artifact a frame is about to show. */
  readonly artifact: ArtifactDetail;
  readonly log: Log;
  /** The home's `submitChannels`, if a host set them. */
  readonly home: () => readonly SubmitChannel[] | undefined;
  /**
   * Hosts that always provide `trustedControls` (`HomeConfig.ports`, D105), by client name: one
   * that is away decides nothing, so its views get the shell channel only.
   */
  readonly expected: () => readonly string[];
  /** The newest connection that registered `trustedControls`, if any. */
  readonly registrant: () => { readonly session: number; readonly owner: string } | undefined;
  /** Calls the port on that connection; rejects on a transport failure or the timeout. */
  readonly call: (session: number, params: unknown) => Promise<unknown>;
}

/**
 * The policy for a new view (D108). A host's answer wins; a host that registered the port but
 * fails to answer, or that always provides it (`HomeConfig.ports`) and isn't connected, narrows
 * the view to the shell channel, so its outage never widens what it allows.
 */
export async function controlsPolicy(input: ControlsPolicyInput): Promise<ControlsPolicy> {
  const registrant = input.registrant();
  if (registrant) {
    const { versions: _versions, manifest: _manifest, ...summary } = input.artifact;
    try {
      const answer = await input.call(registrant.session, { artifact: summary });
      const parsed = portTrustedControlsPolicyMethod.result.safeParse(answer);
      if (parsed.success) return normalize(parsed.data);
      input.log.warn("gateway.controls_policy_invalid", {
        owner: registrant.owner,
        artifactId: input.artifact.id,
      });
    } catch (error) {
      input.log.warn("gateway.controls_policy_failed", {
        owner: registrant.owner,
        artifactId: input.artifact.id,
        error: (error as Error).message,
      });
    }
    return SHELL_ONLY;
  }
  // A host that takes the policy over but is away right now (restarting, or the link opened
  // first) never has it widened by its absence: the view lives on after it returns (Claude
  // review finding 10).
  const away = input.expected();
  if (away.length > 0) {
    input.log.warn("gateway.controls_policy_host_away", {
      owners: away,
      artifactId: input.artifact.id,
    });
    return SHELL_ONLY;
  }
  const channels = input.home();
  return channels === undefined ? STANDALONE : normalize({ submitChannels: channels });
}

/** Channels deduplicated and in a stable order. */
function normalize(policy: ControlsPolicy): ControlsPolicy {
  const submitChannels = (["shell", "artifact"] as const).filter((channel) =>
    policy.submitChannels.includes(channel),
  );
  return {
    submitChannels: submitChannels.length > 0 ? submitChannels : ["shell"],
    ...(policy.controls !== undefined ? { controls: [...new Set(policy.controls)] } : {}),
  };
}
