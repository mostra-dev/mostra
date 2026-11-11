/**
 * The roster's host methods (D121, D168; CO-01, CO-03, CO-07): `roster/add` names expected
 * respondents and gives each a personal link, `roster/remove` stops expecting them, `roster/get`
 * reads everyone's status. They live with the gateway because a personal link is a capability
 * link (D97): minted here, with the respondent's viewer (D104), in the same transaction as the
 * roster's change. The roster itself, its rounds and its completion are the interaction core's.
 */
import {
  type Actor,
  type ArtifactDetail,
  type ArtifactRef,
  type CapabilityLink,
  createDiagnostic,
  durationMs,
  type Roster,
  RpcError,
  rosterAddMethod,
  rosterGetMethod,
  rosterRemoveMethod,
} from "@mostra/protocol";
import type { Interaction } from "../interaction/index.ts";
import { type Ledger, recordedResult, recordResult, requestKey } from "../ledger/index.ts";
import { handler, type MethodHandler, type Session } from "../protocol-server/index.ts";
import type { Capabilities, MintedToken } from "./capabilities.ts";

/** What the roster methods need of the gateway. */
export interface RosterMethodsOptions {
  readonly ledger: Ledger;
  readonly interaction: Interaction;
  readonly capabilities: Capabilities;
  readonly artifacts: { get(ref: ArtifactRef): ArtifactDetail };
  /** The version a request names, or the latest. */
  readonly versionOf: (
    detail: ArtifactDetail,
    wanted: number | string | undefined,
  ) => { readonly id: string; readonly number: number; readonly collected?: string } | undefined;
  /** Where the artifact's links point now (D97 item 10). */
  readonly linkBase: (artifactId: string) => Promise<string>;
  /** A minted token as a capability link. */
  readonly link: (token: MintedToken) => CapabilityLink;
  /** What a link refused for its collected version says. */
  readonly collected: (number: number) => RpcError;
}

/** Who changed the roster: the client that called. */
function actorOf(session: Session): Actor {
  return { kind: "agent", ...(session.client ? { id: session.client.name } : {}) };
}

/** The roster's host methods. */
export function rosterMethods(options: RosterMethodsOptions): MethodHandler[] {
  const { ledger, interaction, capabilities } = options;

  /** Whether a token still works at an address: the capabilities' own rule (D97 items 5, 10). */
  const usable = (tokenId: string, base: string): boolean => {
    const grant = capabilities.grant(tokenId);
    return grant?.live === true && grant.shellOrigin === base;
  };

  const live = (tokenId: string): boolean => capabilities.grant(tokenId)?.live === true;
  const roster = (artifactId: string): Roster => interaction.roster(artifactId, live);

  return [
    handler(rosterAddMethod, async (params, session) => {
      const detail = options.artifacts.get(params.artifact);
      const version = options.versionOf(detail, params.version);
      if (!version) {
        throw new RpcError(
          createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
            message:
              params.version === undefined
                ? `The artifact ${detail.id} has no published version.`
                : `The artifact ${detail.id} has no version ${params.version}.`,
          }),
        );
      }
      if (version.collected !== undefined) throw options.collected(version.number);
      const base = await options.linkBase(detail.id);
      const key = requestKey("roster/add", params);
      const minted = new Map<string, MintedToken>();
      const tokens = ledger.write((db) => {
        if (key !== undefined) {
          const row = recordedResult<{ tokens: { ref: string; tokenId: string }[] }>(db, key);
          if (row) return row.tokens;
        }
        const added = interaction.addRespondents(db, {
          artifactId: detail.id,
          respondents: params.respondents,
          actor: actorOf(session),
          // A respondent keeps the personal link they have while it works here; a revoked, expired
          // or moved one is replaced by a new one for the same viewer.
          link: (viewerId, current) => {
            if (current !== undefined && usable(current, base)) return current;
            const token = capabilities.mint(
              {
                artifactId: detail.id,
                scopes: params.scopes,
                ttlMs: params.ttl === undefined ? undefined : durationMs(params.ttl),
                pinnedVersion: params.version === undefined ? undefined : version.number,
                viewerId,
                shellOrigin: base,
              },
              db,
            );
            minted.set(token.tokenId, token);
            return token.tokenId;
          },
        });
        const recorded = added.tokens.map((token) => ({ ref: token.ref, tokenId: token.tokenId }));
        // Only token IDs are recorded: the ledger never holds a link's secret (D97 item 2).
        if (key !== undefined) recordResult(db, key, { tokens: recorded });
        return recorded;
      });
      const links = tokens.map(({ ref, tokenId }) => {
        const token = minted.get(tokenId) ?? capabilities.reveal(tokenId);
        if (!token) {
          throw new RpcError(
            createDiagnostic("MOSTRA_HYGIENE_TOKEN_REVOKED", {
              message: `The personal link of ${ref} can't be shown again: the home's capability key changed. Add them again to give them a new one.`,
            }),
          );
        }
        return { ref, link: options.link(token) };
      });
      return { roster: roster(detail.id), links };
    }),
    handler(rosterRemoveMethod, (params, session) => {
      const detail = options.artifacts.get(params.artifact);
      const key = requestKey("roster/remove", params);
      const removed = ledger.write((db) => {
        if (key !== undefined) {
          const row = recordedResult<{ removed: string[] }>(db, key);
          if (row) return row.removed;
        }
        const outcome = interaction.removeRespondents(db, {
          artifactId: detail.id,
          refs: params.refs,
          actor: actorOf(session),
        });
        if (key !== undefined) recordResult(db, key, { removed: outcome.removed });
        return [...outcome.removed];
      });
      return { roster: roster(detail.id), removed };
    }),
    handler(rosterGetMethod, (params) => roster(options.artifacts.get(params.artifact).id)),
  ];
}
