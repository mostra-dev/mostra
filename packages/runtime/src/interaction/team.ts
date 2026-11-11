/**
 * Team traffic to pages (D168; CO-03, CO-04, CO-07): each view's roster as it may see it, and who
 * is present with the cursors and selections they share. Nothing here is stored (D47): presence
 * lives in this process's memory under short leases, and both reach pages only as ephemeral
 * messages on their streams and polls, each view's under the artifact's visibility policy.
 *
 * - **Respondents.** A view that reads its roster (`respondents`) follows it for a minute; when the
 *   interaction core says an artifact's respondents may have changed, every following view is sent
 *   its roster again, at most every {@link RESPONDENTS_SETTLE_MS} per artifact, and only when it
 *   differs from what that view last got.
 * - **Presence.** A view that posts presence is present for {@link PRESENCE_LEASE_MS}; what it
 *   shares replaces what it shared before. Each view may post {@link PRESENCE_RATE} updates a second
 *   (more is refused, `MOSTRA_TEAM_PRESENCE_RATE_LIMITED`), and an artifact's present views are sent
 *   who is present at most every {@link PRESENCE_FANOUT_MS}, so many fast cursors cost each reader a
 *   bounded rate of messages.
 */
import type {
  PresencePeer,
  PresenceRequest,
  PresenceState,
  RosterForPage,
  TeamVisibility,
} from "@mostra/protocol";
import type { EphemeralBus } from "./ephemeral.ts";
import type { RosterViewer } from "./roster.ts";

/** How long a page stays present without posting again; pages post every 10 s. */
export const PRESENCE_LEASE_MS = 30_000;

/** The most presence updates one view may post in a second (a burst of as many). */
export const PRESENCE_RATE = 20;

/** The shortest time between two presence messages to one artifact's pages. */
export const PRESENCE_FANOUT_MS = 50;

/** How long a view follows its roster after it read it; pages read again every 20 s. */
export const RESPONDENTS_LEASE_MS = 60_000;

/** The shortest time between two roster messages to one artifact's pages. */
export const RESPONDENTS_SETTLE_MS = 100;

/** The most present viewers a page is told of by name; more are counted. */
export const PRESENCE_PEERS_MAX = 200;

/** What team traffic reads of the interaction core. */
export interface TeamSource {
  visibility(artifactId: string): TeamVisibility;
  isOwner(viewerId: string): boolean;
  peer(artifactId: string, viewerId: string): { readonly key: string } & RosterViewer;
  rosterForPage(page: { readonly artifactId: string; readonly viewerId: string }): RosterForPage;
  onTeam(listener: (artifactId: string) => void): () => void;
}

/** One view's presence. */
interface Present {
  readonly artifactId: string;
  readonly viewId: string;
  readonly viewerId: string;
  cursor?: { readonly x: number; readonly y: number };
  selection?: { readonly element?: string; readonly start?: number; readonly end?: number };
  at: number;
  until: number;
  /** The view's token bucket: updates it may still post now. */
  tokens: number;
  refilled: number;
}

/** A view that follows its roster. */
interface Following {
  readonly artifactId: string;
  readonly viewerId: string;
  until: number;
  last?: string;
}

/** The answer to a presence post: the state, or how long to wait. */
export type PresenceAnswer =
  | { readonly state: PresenceState }
  | { readonly limited: true; readonly retryAfterMs: number };

/** Team traffic for one gateway. */
export interface TeamTraffic {
  /** A view's presence post (CO-04): joins, shares, or leaves. */
  presence(
    page: { readonly artifactId: string; readonly viewerId: string },
    request: PresenceRequest,
  ): PresenceAnswer;
  /** A view reads its roster (CO-03) and follows it for a minute. */
  respondents(
    page: { readonly artifactId: string; readonly viewerId: string },
    viewId: string,
  ): RosterForPage;
  /** How many views are present now, across artifacts. */
  presentCount(): number;
  /** Stops the timers. */
  close(): void;
}

/** Creates team traffic over a bus. */
export function createTeamTraffic(options: {
  readonly bus: EphemeralBus;
  readonly source: TeamSource;
  readonly now?: () => number;
  readonly log?: { error(event: string, fields: Record<string, unknown>): void };
}): TeamTraffic {
  const { bus, source } = options;
  const now = options.now ?? Date.now;
  const present = new Map<string, Present>();
  const following = new Map<string, Following>();
  const fanout = new Map<string, ReturnType<typeof setTimeout>>();
  const settle = new Map<string, ReturnType<typeof setTimeout>>();

  /** Lookups for one fan-out: each viewer's peer, the owner check and the visibility, read once. */
  const memo = (artifactId: string) => {
    const peers = new Map<string, { readonly key: string } & RosterViewer>();
    const owners = new Map<string, boolean>();
    let visibility: TeamVisibility | undefined;
    return {
      visibility: () => (visibility ??= source.visibility(artifactId)),
      isOwner: (viewerId: string) => {
        let owner = owners.get(viewerId);
        if (owner === undefined) {
          owner = source.isOwner(viewerId);
          owners.set(viewerId, owner);
        }
        return owner;
      },
      peer: (viewerId: string) => {
        let peer = peers.get(viewerId);
        if (!peer) {
          peer = source.peer(artifactId, viewerId);
          peers.set(viewerId, peer);
        }
        return peer;
      },
    };
  };

  /** Who is present on an artifact, as one viewer may see it. */
  const stateFor = (
    artifactId: string,
    viewerId: string,
    lookups: ReturnType<typeof memo> = memo(artifactId),
  ): PresenceState => {
    const visibility = lookups.visibility();
    const sees: TeamVisibility = lookups.isOwner(viewerId) ? "names" : visibility;
    const at = now();
    // One entry per viewer: their most recent view's cursor and selection.
    const byViewer = new Map<string, Present>();
    for (const entry of present.values()) {
      if (entry.artifactId !== artifactId || entry.until <= at) continue;
      const kept = byViewer.get(entry.viewerId);
      if (!kept || kept.at < entry.at) byViewer.set(entry.viewerId, entry);
    }
    const peerOf = (entry: Present): PresencePeer => {
      const peer = lookups.peer(entry.viewerId);
      return {
        key: peer.key,
        self: entry.viewerId === viewerId,
        kind: peer.kind,
        ...(peer.name !== undefined ? { name: peer.name } : {}),
        ...(peer.verified !== undefined ? { verified: peer.verified } : {}),
        ...(entry.cursor ? { cursor: entry.cursor } : {}),
        ...(entry.selection ? { selection: entry.selection } : {}),
        at: new Date(entry.at).toISOString(),
      };
    };
    const own = byViewer.get(viewerId);
    const others = [...byViewer.values()].filter((entry) => entry.viewerId !== viewerId);
    const peers: PresencePeer[] = own ? [peerOf(own)] : [];
    if (sees === "names") {
      others.sort((a, b) => b.at - a.at);
      for (const entry of others.slice(0, PRESENCE_PEERS_MAX)) peers.push(peerOf(entry));
    }
    return {
      visibility,
      peers,
      ...(sees !== "private" ? { others: others.length } : {}),
    };
  };

  const fanOut = (artifactId: string): void => {
    fanout.delete(artifactId);
    const at = now();
    const lookups = memo(artifactId);
    for (const entry of present.values()) {
      if (entry.artifactId !== artifactId || entry.until <= at) continue;
      try {
        bus.send(artifactId, entry.viewId, {
          kind: "presence",
          presence: stateFor(artifactId, entry.viewerId, lookups),
        });
      } catch (error) {
        options.log?.error("team.presence_failed", { error });
      }
    }
  };

  /** Schedules the artifact's next presence message, at most every {@link PRESENCE_FANOUT_MS}. */
  const changedPresence = (artifactId: string): void => {
    if (fanout.has(artifactId)) return;
    const timer = setTimeout(() => fanOut(artifactId), PRESENCE_FANOUT_MS);
    timer.unref?.();
    fanout.set(artifactId, timer);
  };

  const sendRosters = (artifactId: string): void => {
    settle.delete(artifactId);
    const at = now();
    for (const [viewId, entry] of following) {
      if (entry.artifactId !== artifactId) continue;
      if (entry.until <= at) {
        following.delete(viewId);
        continue;
      }
      try {
        const roster = source.rosterForPage({ artifactId, viewerId: entry.viewerId });
        const text = JSON.stringify(roster);
        if (text === entry.last) continue;
        entry.last = text;
        bus.send(artifactId, viewId, { kind: "respondents", respondents: roster });
      } catch (error) {
        options.log?.error("team.respondents_failed", { error });
      }
    }
  };

  const stopTeam = source.onTeam((artifactId) => {
    let any = false;
    for (const entry of following.values()) {
      if (entry.artifactId === artifactId) {
        any = true;
        break;
      }
    }
    if (!any || settle.has(artifactId)) return;
    const timer = setTimeout(() => sendRosters(artifactId), RESPONDENTS_SETTLE_MS);
    timer.unref?.();
    settle.set(artifactId, timer);
  });

  // Expired presence ends, and the artifact's pages hear who left.
  const sweep = setInterval(() => {
    const at = now();
    const left = new Set<string>();
    for (const [viewId, entry] of present) {
      if (entry.until <= at) {
        present.delete(viewId);
        left.add(entry.artifactId);
      }
    }
    for (const [viewId, entry] of following) if (entry.until <= at) following.delete(viewId);
    for (const artifactId of left) changedPresence(artifactId);
  }, 1_000);
  sweep.unref?.();

  return {
    presence(page, request) {
      const at = now();
      const viewId = request.viewId;
      let entry = present.get(viewId);
      if (entry && (entry.artifactId !== page.artifactId || entry.viewerId !== page.viewerId)) {
        present.delete(viewId);
        entry = undefined;
      }
      if (request.leave === true) {
        if (entry) {
          present.delete(viewId);
          changedPresence(page.artifactId);
        }
        return { state: stateFor(page.artifactId, page.viewerId) };
      }
      if (!entry) {
        entry = {
          artifactId: page.artifactId,
          viewId,
          viewerId: page.viewerId,
          at,
          until: at + PRESENCE_LEASE_MS,
          tokens: PRESENCE_RATE,
          refilled: at,
        };
        present.set(viewId, entry);
      }
      // A token bucket per view: PRESENCE_RATE a second, in bursts of as many.
      entry.tokens = Math.min(
        PRESENCE_RATE,
        entry.tokens + ((at - entry.refilled) / 1000) * PRESENCE_RATE,
      );
      entry.refilled = at;
      if (entry.tokens < 1) {
        return {
          limited: true,
          retryAfterMs: Math.ceil(((1 - entry.tokens) / PRESENCE_RATE) * 1000),
        };
      }
      entry.tokens -= 1;
      if (request.cursor !== undefined) {
        if (request.cursor === null) delete entry.cursor;
        else entry.cursor = { x: request.cursor.x, y: request.cursor.y };
      }
      if (request.selection !== undefined) {
        if (request.selection === null) delete entry.selection;
        else
          entry.selection = {
            ...(request.selection.element !== undefined
              ? { element: request.selection.element }
              : {}),
            ...(request.selection.start !== undefined ? { start: request.selection.start } : {}),
            ...(request.selection.end !== undefined ? { end: request.selection.end } : {}),
          };
      }
      entry.at = at;
      entry.until = at + PRESENCE_LEASE_MS;
      changedPresence(page.artifactId);
      return { state: stateFor(page.artifactId, page.viewerId) };
    },
    respondents(page, viewId) {
      const roster = source.rosterForPage(page);
      following.set(viewId, {
        artifactId: page.artifactId,
        viewerId: page.viewerId,
        until: now() + RESPONDENTS_LEASE_MS,
        last: JSON.stringify(roster),
      });
      return roster;
    },
    presentCount() {
      const at = now();
      let count = 0;
      for (const entry of present.values()) if (entry.until > at) count += 1;
      return count;
    },
    close() {
      clearInterval(sweep);
      stopTeam();
      for (const timer of fanout.values()) clearTimeout(timer);
      for (const timer of settle.values()) clearTimeout(timer);
      fanout.clear();
      settle.clear();
    },
  };
}
