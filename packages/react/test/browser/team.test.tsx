/**
 * The team client in a real browser (D168, CO-04): a page the browser keeps in its back/forward
 * cache leaves as it goes and joins again when it is brought back, with its hooks still mounted
 * (Opus review 8).
 */
import type { PresenceRequest, PresenceState } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { TeamClient } from "../../src/runtime/team.ts";
import type { Transport } from "../../src/runtime/transport.ts";

const PRESENT: PresenceState = { visibility: "names", peers: [] };

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("TeamClient in a browser (CO-04)", () => {
  it("leaves with a page the browser caches, and joins again when the page comes back", async () => {
    const sent: { request: PresenceRequest; keepalive: boolean }[] = [];
    const transport = {
      presence: async (request: PresenceRequest, options?: { keepalive?: boolean }) => {
        sent.push({ request, keepalive: options?.keepalive === true });
        return PRESENT;
      },
      respondents: async () => ({ visibility: "names", owner: false, round: 1 }),
    } as unknown as Transport;
    const team = new TeamClient({ transport, viewId: "vw_1" });
    const leave = team.joinPresence({ cursor: false, selection: false });
    await settle();
    expect(sent).toHaveLength(1);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(sent.at(-1)).toMatchObject({ request: { leave: true }, keepalive: true });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await settle();
    const back = sent.at(-1);
    expect(back?.request.leave).toBeUndefined();
    expect((back?.request.seq ?? 0) > (sent[1]?.request.seq ?? Number.POSITIVE_INFINITY)).toBe(
      true,
    );
    expect(team.presence()).toEqual(PRESENT);
    // A first load's pageshow (not from the cache) posts nothing more.
    const count = sent.length;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    await settle();
    expect(sent).toHaveLength(count);
    leave();
    team.stop();
  });
});
