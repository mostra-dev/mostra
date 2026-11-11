/**
 * Team traffic on its own (D168; CO-04, CO-07): the presence rate per view, which neither leaving
 * nor joining again refills; leases that lapse; one coalesced presence message per artifact
 * however many cursors move, and none to a view whose own view of who is here didn't change; each
 * view told only what its visibility allows; and roster pushes only to views that asked for them,
 * from one roster read however many follow.
 */
import type { EphemeralMessage, PresenceState, TeamVisibility } from "@mostra/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EphemeralBus } from "../../src/interaction/ephemeral.ts";
import {
  createTeamTraffic,
  PRESENCE_FANOUT_MS,
  PRESENCE_LEASE_MS,
  PRESENCE_RATE,
  type TeamSource,
} from "../../src/interaction/team.ts";

const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XA";

function setup(visibility: TeamVisibility = "names", owner = "") {
  let clock = 1_000_000;
  const sent: { viewId: string; message: EphemeralMessage }[] = [];
  const bus = {
    send: (_artifactId: string, viewId: string, message: EphemeralMessage) => {
      sent.push({ viewId, message });
    },
  } as unknown as EphemeralBus;
  let team: ((artifactId: string) => void) | undefined;
  const reads = { rosters: 0 };
  let round = 1;
  const roster = (viewerId: string) => ({ visibility, owner: viewerId === owner, round });
  const source: TeamSource = {
    visibility: () => visibility,
    isOwner: (viewerId) => viewerId === owner,
    peer: (_artifactId, viewerId) => ({
      key: `vk_${viewerId}`,
      id: viewerId,
      kind: "token",
      name: viewerId,
    }),
    rosterForPage: (page) => roster(page.viewerId),
    rostersForPages: (_artifactId, viewerIds) => {
      reads.rosters += 1;
      return viewerIds.map(roster);
    },
    onTeam: (listener) => {
      team = listener;
      return () => {
        team = undefined;
      };
    },
  };
  const traffic = createTeamTraffic({ bus, source, now: () => clock });
  return {
    traffic,
    sent,
    reads,
    nextRound: () => {
      round += 1;
    },
    tick: (ms: number) => {
      clock += ms;
    },
    changed: () => team?.(ARTIFACT),
    page: (viewerId: string) => ({ artifactId: ARTIFACT, viewerId }),
  };
}

const state = (
  answer: ReturnType<ReturnType<typeof setup>["traffic"]["presence"]>,
): PresenceState => {
  if ("limited" in answer) throw new Error("limited");
  return answer.state;
};

describe("team traffic (CO-04, CO-07)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes PRESENCE_RATE joins a second per view, and leaving and joining again never refills it (a leave included)", () => {
    const { traffic, page } = setup();
    let joined = 0;
    for (let index = 0; index < PRESENCE_RATE * 3; index++) {
      const answer = traffic.presence(page("ada"), {
        viewId: "vw_ada",
        cursor: { x: index, y: 0 },
      });
      if ("limited" in answer) continue;
      joined += 1;
      // A present view's leave is honored at once, however fast it went before.
      expect("limited" in traffic.presence(page("ada"), { viewId: "vw_ada", leave: true })).toBe(
        false,
      );
    }
    expect(joined).toBe(PRESENCE_RATE);
    // A leave of a view that isn't present takes a token like any post.
    expect("limited" in traffic.presence(page("ada"), { viewId: "vw_ada", leave: true })).toBe(
      true,
    );
    traffic.close();
  });

  it("takes no post older than the newest a view sent, so an update that overtook a leave never brings it back (Opus review 7)", () => {
    const { traffic, page } = setup();
    traffic.presence(page("ada"), { viewId: "vw_ada", seq: 1, cursor: { x: 1, y: 1 } });
    expect(traffic.presentCount()).toBe(1);
    // The page left (seq 3) while an update (seq 2) was on its way, which arrives after it.
    traffic.presence(page("ada"), { viewId: "vw_ada", seq: 3, leave: true });
    expect(
      state(traffic.presence(page("ada"), { viewId: "vw_ada", seq: 2, cursor: { x: 9, y: 9 } }))
        .peers,
    ).toEqual([]);
    expect(traffic.presentCount()).toBe(0);
    // A stale post costs a token like any, so old counts never escape the rate.
    let limited = false;
    for (let index = 0; index < PRESENCE_RATE * 2; index++) {
      if ("limited" in traffic.presence(page("ada"), { viewId: "vw_ada", seq: 2 })) limited = true;
    }
    expect(limited).toBe(true);
    expect(traffic.presentCount()).toBe(0);
    traffic.close();
  });

  it("lets presence lapse after its lease, and tells the others", async () => {
    const { traffic, page, tick, sent } = setup();
    state(traffic.presence(page("ada"), { viewId: "vw_ada", cursor: { x: 1, y: 2 } }));
    expect(state(traffic.presence(page("grace"), { viewId: "vw_grace" })).others).toBe(1);
    // Grace renews; Ada doesn't, and lapses.
    tick(PRESENCE_LEASE_MS - 1_000);
    traffic.presence(page("grace"), { viewId: "vw_grace" });
    tick(1_001);
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(traffic.presentCount()).toBe(1);
    const told = sent.filter((one) => one.viewId === "vw_grace" && one.message.kind === "presence");
    const last = told.at(-1)?.message as { presence: PresenceState } | undefined;
    expect(last?.presence.others).toBe(0);
    expect(last?.presence.peers.map((peer) => peer.key)).toEqual(["vk_grace"]);
    traffic.close();
  });

  it("sends one presence message per artifact and view however many cursors move within the fan-out", async () => {
    const { traffic, page, sent } = setup();
    for (const name of ["ada", "grace", "edsger"]) {
      traffic.presence(page(name), { viewId: `vw_${name}`, cursor: { x: 0, y: 0 } });
    }
    for (let index = 0; index < 10; index++) {
      traffic.presence(page("grace"), { viewId: "vw_grace", cursor: { x: index, y: index } });
    }
    await vi.advanceTimersByTimeAsync(PRESENCE_FANOUT_MS + 5);
    const presence = sent.filter((one) => one.message.kind === "presence");
    // Grace's own answer already said all she may see; the others hear once each.
    expect(presence.map((one) => one.viewId).sort()).toEqual(["vw_ada", "vw_edsger"]);
    const toAda = presence.find((one) => one.viewId === "vw_ada")?.message as {
      presence: PresenceState;
    };
    expect(toAda.presence.peers.find((peer) => peer.key === "vk_grace")?.cursor).toEqual({
      x: 9,
      y: 9,
    });
    traffic.close();
  });

  it("tells each view only what its visibility allows, and the owner everything", () => {
    for (const visibility of ["private", "counts", "names"] as const) {
      const { traffic, page } = setup(visibility, "owner");
      traffic.presence(page("grace"), { viewId: "vw_grace", cursor: { x: 5, y: 5 } });
      const ada = state(traffic.presence(page("ada"), { viewId: "vw_ada" }));
      expect(ada.peers.filter((peer) => !peer.self)).toHaveLength(visibility === "names" ? 1 : 0);
      expect(ada.others).toBe(visibility === "private" ? undefined : 1);
      const owner = state(traffic.presence(page("owner"), { viewId: "vw_owner" }));
      expect(owner.peers.filter((peer) => !peer.self)).toHaveLength(2);
      traffic.close();
    }
  });

  it("sends a private view nothing while others come, move and go, and a counts view only a new count (Opus review 2)", async () => {
    for (const visibility of ["private", "counts"] as const) {
      const { traffic, page, sent, tick } = setup(visibility);
      traffic.presence(page("ada"), { viewId: "vw_ada" });
      await vi.advanceTimersByTimeAsync(PRESENCE_FANOUT_MS + 5);
      sent.length = 0;
      traffic.presence(page("grace"), { viewId: "vw_grace", cursor: { x: 0, y: 0 } });
      await vi.advanceTimersByTimeAsync(PRESENCE_FANOUT_MS + 5);
      const toAda = () =>
        sent.filter((one) => one.viewId === "vw_ada" && one.message.kind === "presence").length;
      // Grace arriving changes the count, which only counts shows.
      expect(toAda()).toBe(visibility === "counts" ? 1 : 0);
      for (let index = 1; index <= 10; index++) {
        tick(100);
        traffic.presence(page("grace"), { viewId: "vw_grace", cursor: { x: index, y: index } });
        await vi.advanceTimersByTimeAsync(PRESENCE_FANOUT_MS + 5);
      }
      expect(toAda()).toBe(visibility === "counts" ? 1 : 0);
      traffic.presence(page("grace"), { viewId: "vw_grace", leave: true });
      await vi.advanceTimersByTimeAsync(PRESENCE_FANOUT_MS + 5);
      expect(toAda()).toBe(visibility === "counts" ? 2 : 0);
      traffic.close();
    }
  });

  it("reads the roster once per change for every view that follows it (Opus review 9)", async () => {
    const { traffic, page, sent, changed, reads, nextRound } = setup();
    for (const name of ["ada", "grace", "edsger", "barbara"]) {
      traffic.respondents(page(name), `vw_${name}`);
    }
    nextRound();
    changed();
    await vi.advanceTimersByTimeAsync(200);
    expect(reads.rosters).toBe(1);
    expect(sent.filter((one) => one.message.kind === "respondents")).toHaveLength(4);
    traffic.close();
  });

  it("pushes the roster only to views that read it, only when it changed for them", async () => {
    const { traffic, page, sent, changed } = setup();
    traffic.respondents(page("ada"), "vw_ada");
    traffic.presence(page("grace"), { viewId: "vw_grace" });
    changed();
    await vi.advanceTimersByTimeAsync(200);
    // Nothing changed for Ada since her read, and Grace never asked.
    expect(sent.filter((one) => one.message.kind === "respondents")).toHaveLength(0);
    traffic.close();
  });
});
