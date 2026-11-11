"use client";

/**
 * Team hooks (D121, D168; INTERFACES §2.3): who is expected to answer and where each stands, and
 * who is here now with the cursor and selection they share. Both are data for the page to show in
 * its own design: the shell draws nothing (D121). What a viewer sees of others is the artifact's
 * `team.visibility` (`private` unless the manifest opts in); the artifact's owner sees everyone.
 * Outside a live page (a static export) both say `unavailable`.
 */
import type {
  PresencePeer,
  RespondentForPage,
  RosterCounts,
  TeamVisibility,
} from "@mostra/protocol";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStore } from "./hooks.ts";

export type {
  Peer,
  PresenceCursor,
  PresencePeer,
  PresenceSelection,
  RespondentForPage,
  RespondentStatus,
  RosterCounts,
  TeamVisibility,
} from "@mostra/protocol";

/** What `useRespondents` returns (CO-03). */
export interface Respondents {
  /** `loading` until the roster first arrives; `unavailable` outside a live page. */
  readonly status: "loading" | "ready" | "unavailable";
  /** What viewers see of each other on this artifact (its manifest's `team.visibility`). */
  readonly visibility?: TeamVisibility;
  /** Whether this viewer is the artifact's owner, who sees everyone whatever the visibility. */
  readonly owner: boolean;
  /** The roster's round: 1 under `once`; under `epochs`, one more after each time everyone answered. */
  readonly round: number;
  /** This viewer's own entry, when they are an expected respondent. */
  readonly self?: RespondentForPage;
  /** How many stand where; under `counts` and `names` visibility, and for the owner. */
  readonly counts?: RosterCounts;
  /** Whether everyone expected answered in this round; under `counts` and `names`, and for the owner. */
  readonly complete?: boolean;
  /** Every expected respondent, in the order they joined; under `names`, and for the owner. */
  readonly respondents: readonly RespondentForPage[];
  /** Why the roster couldn't be read, when it couldn't. */
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * The people this artifact expects answers from, and where each stands in the round: not opened,
 * drafting or submitted (CO-03). It follows changes as they happen.
 *
 * ```tsx
 * const { counts, respondents } = useRespondents();
 * // "3 of 5 answered", and who is drafting, in the page's own design.
 * ```
 */
export function useRespondents(): Respondents {
  const store = useStore();
  const team = store.team;
  useSyncExternalStore(team.subscribe, team.version, team.version);
  useEffect(() => (team.available ? team.watchRespondents() : undefined), [team]);
  const roster = team.roster();
  const error = team.rosterError();
  return useMemo((): Respondents => {
    if (!team.available) return { status: "unavailable", owner: false, round: 1, respondents: [] };
    if (!roster) {
      return {
        status: "loading",
        owner: false,
        round: 1,
        respondents: [],
        ...(error ? { error: { code: error.code, message: error.message } } : {}),
      };
    }
    return {
      status: "ready",
      visibility: roster.visibility,
      owner: roster.owner,
      round: roster.round,
      ...(roster.self ? { self: roster.self } : {}),
      ...(roster.counts ? { counts: roster.counts } : {}),
      ...(roster.complete !== undefined ? { complete: roster.complete } : {}),
      respondents: roster.respondents ?? [],
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    };
  }, [team, roster, error]);
}

/** What `usePresence` shares of this viewer (CO-04): nothing unless the page asks. */
export interface PresenceOptions {
  /** Share this viewer's pointer, in the page's document coordinates. */
  readonly cursor?: boolean;
  /**
   * Share where this viewer is: the focused element's `data-presence-id`, `id` or `name`, and the
   * selected range in a text input.
   */
  readonly selection?: boolean;
}

/** What `usePresence` returns (CO-04). */
export interface Presence {
  /** `joining` until the first answer; `unavailable` outside a live page. */
  readonly status: "joining" | "present" | "unavailable";
  /** What viewers see of each other on this artifact (its manifest's `team.visibility`). */
  readonly visibility?: TeamVisibility;
  /** This viewer, as others see them. */
  readonly self?: PresencePeer;
  /** Everyone else here now, most recently active first; under `names`, and for the owner. */
  readonly others: readonly PresencePeer[];
  /** How many others are here now; under `counts` and `names`, and for the owner. */
  readonly count?: number;
}

/**
 * Who is viewing this artifact now (CO-04), as data for the page to draw. With `cursor` and
 * `selection`, this viewer shares their pointer and where they are, ephemerally: never stored,
 * at most 10 updates a second, gone when they leave. Without the hook, nothing is shared.
 *
 * ```tsx
 * const { others } = usePresence({ cursor: true });
 * return others.map((peer) => peer.cursor && <Cursor key={peer.key} name={peer.name} at={peer.cursor} />);
 * ```
 */
export function usePresence(options: PresenceOptions = {}): Presence {
  const store = useStore();
  const team = store.team;
  useSyncExternalStore(team.subscribe, team.version, team.version);
  const cursor = options.cursor === true;
  const selection = options.selection === true;
  useEffect(
    () => (team.available ? team.joinPresence({ cursor, selection }) : undefined),
    [team, cursor, selection],
  );
  const state = team.presence();
  return useMemo((): Presence => {
    if (!team.available) return { status: "unavailable", others: [] };
    if (!state) return { status: "joining", others: [] };
    const self = state.peers.find((peer) => peer.self);
    return {
      status: "present",
      visibility: state.visibility,
      ...(self ? { self } : {}),
      others: state.peers.filter((peer) => !peer.self),
      ...(state.others !== undefined ? { count: state.others } : {}),
    };
  }, [team, state]);
}
