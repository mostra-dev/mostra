/**
 * The client's team state (D168; CO-03, CO-04): the roster is read when a hook first shows it and
 * every 20 s while one does; presence posts once on joining, again every 10 s, leaves when the
 * last hook unmounts, waits out the gateway's rate, and a page that never asked hears nothing.
 * The pointer and selection tracking runs in a browser (the five-viewer e2e scenario).
 */
import type { PresenceRequest, PresenceState, RosterForPage } from "@mostra/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MostraError } from "../src/runtime/errors.ts";
import { TeamClient } from "../src/runtime/team.ts";
import type { Transport } from "../src/runtime/transport.ts";

const ROSTER: RosterForPage = { visibility: "names", owner: false, round: 1 };
const PRESENT: PresenceState = { visibility: "names", peers: [] };

function fake(options: { limitedFirst?: boolean } = {}) {
  const presence: { request: PresenceRequest; keepalive: boolean }[] = [];
  const respondents: string[] = [];
  let limited = options.limitedFirst === true;
  const transport = {
    respondents: async (request: { viewId: string }) => {
      respondents.push(request.viewId);
      return ROSTER;
    },
    presence: async (request: PresenceRequest, opts?: { keepalive?: boolean }) => {
      presence.push({ request, keepalive: opts?.keepalive === true });
      if (limited) {
        limited = false;
        throw new MostraError("MOSTRA_TEAM_PRESENCE_RATE_LIMITED", "too fast", { status: 429 });
      }
      return PRESENT;
    },
  } as unknown as Transport;
  return { transport, presence, respondents };
}

describe("TeamClient (CO-03, CO-04)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the roster when the first hook shows it, every 20 s while one does, and not after", async () => {
    const { transport, respondents } = fake();
    const team = new TeamClient({ transport, viewId: "vw_1" });
    const stopA = team.watchRespondents();
    const stopB = team.watchRespondents();
    await vi.advanceTimersByTimeAsync(0);
    expect(respondents).toHaveLength(1);
    expect(team.roster()).toEqual(ROSTER);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(respondents).toHaveLength(2);
    stopA();
    stopB();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(respondents).toHaveLength(2);
  });

  it("posts presence on joining, every 10 s, and leaves when the last hook unmounts", async () => {
    const { transport, presence } = fake();
    const team = new TeamClient({ transport, viewId: "vw_1" });
    const leaveA = team.joinPresence({ cursor: true, selection: false });
    const leaveB = team.joinPresence({ cursor: false, selection: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(presence.length).toBeGreaterThanOrEqual(1);
    expect(team.presence()).toEqual(PRESENT);
    const joined = presence.length;
    await vi.advanceTimersByTimeAsync(10_100);
    expect(presence.length).toBe(joined + 1);
    leaveA();
    await vi.advanceTimersByTimeAsync(0);
    expect(presence.at(-1)?.request.leave).toBeUndefined();
    leaveB();
    expect(presence.at(-1)?.request).toEqual({ viewId: "vw_1", leave: true });
    expect(team.presence()).toBeUndefined();
    const left = presence.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(presence.length).toBe(left);
  });

  it("waits out the gateway's rate and posts again", async () => {
    const { transport, presence } = fake({ limitedFirst: true });
    const team = new TeamClient({ transport, viewId: "vw_1" });
    team.joinPresence({ cursor: true, selection: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(presence).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(presence).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(700);
    expect(presence).toHaveLength(2);
    expect(team.presence()).toEqual(PRESENT);
  });

  it("ignores roster and presence messages a page never asked for", () => {
    const { transport } = fake();
    const team = new TeamClient({ transport, viewId: "vw_1" });
    const heard = vi.fn();
    team.subscribe(heard);
    team.receive({ kind: "respondents", respondents: ROSTER });
    team.receive({ kind: "presence", presence: PRESENT });
    expect(heard).not.toHaveBeenCalled();
    expect(team.roster()).toBeUndefined();
    expect(team.presence()).toBeUndefined();
  });

  it("is unavailable without a live page's transport", () => {
    expect(new TeamClient({}).available).toBe(false);
  });
});
