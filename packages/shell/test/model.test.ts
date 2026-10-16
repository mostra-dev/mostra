import type { EventRecord, FrameTicket, StreamSnapshot } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { initialState, submitRevision, withEvents, withSnapshot } from "../src/model.ts";

const TICKET: FrameTicket = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  src: "http://127.0.0.1:2/_mostra/enter?ticket=x",
  artifactOrigin: "http://127.0.0.1:2",
  version: { id: "ver_00000000000000000000000001", number: 1 },
  latest: { id: "ver_00000000000000000000000001", number: 1 },
  policy: { policy: "once", scope: "per-artifact" },
  submitChannels: ["shell", "artifact"],
  controls: ["submit", "choose"],
  target: "live",
  follow: false,
  pinned: false,
};

const snapshot = (revision: number, fields: Record<string, unknown>): StreamSnapshot => ({
  cursor: String(revision * 10) as StreamSnapshot["cursor"],
  viewer: { id: "vwr_01J00000000000000000000000", kind: "local" },
  draft: {
    revision: String(revision),
    epoch: 1,
    fields: Object.fromEntries(
      Object.entries(fields).map(([id, value]) => [
        id,
        { value, revision: String(revision), updatedAt: "2026-10-16T00:00:00.000Z" },
      ]),
    ),
  },
  state: { revision: "0", epoch: 1, fields: {} },
});

describe("the shell's view of the stream", () => {
  it("learns a version it missed from the snapshot (GPT review finding 13)", () => {
    const state = withSnapshot(initialState(TICKET), {
      ...snapshot(1, {}),
      latest: { id: "ver_00000000000000000000000002", number: 2 },
    });
    expect(state.latest).toEqual({ id: "ver_00000000000000000000000002", number: 2 });
  });

  it("keeps a newer draft over a snapshot that answered late", () => {
    let state = withSnapshot(initialState(TICKET), snapshot(1, { name: "old" }));
    state = withEvents(state, [
      {
        cursor: "20" as EventRecord["cursor"],
        artifactId: TICKET.artifactId,
        seq: 2,
        type: "draft.changed",
        at: "2026-10-16T00:00:00.000Z",
        actor: { kind: "viewer" },
        payload: { revision: "2", changes: [{ id: "name", value: "new" }] },
      },
    ]);
    expect(state.revision).toBe(2);
    state = withSnapshot(state, snapshot(1, { name: "old" }));
    expect(state.revision).toBe(2);
    expect(state.draft.get("name")?.value).toBe("new");
  });
});

describe("the revision the trusted Submit names (GPT review findings 2 and 3)", () => {
  it("is the one the page confirmed, never a newer one only the shell's stream has met", () => {
    expect(submitRevision("runtime", { revision: "3" }, 5)).toEqual({ revision: 3 });
  });

  it("isn't there while the page loads, or when a runtime page doesn't answer", () => {
    expect(submitRevision("loading", undefined, 5)).toEqual({ problem: "NOT_READY" });
    expect(submitRevision("runtime", undefined, 5)).toEqual({ problem: "NO_ANSWER" });
  });

  it("is the stream's for a version built before the flush message, which answers nothing", () => {
    expect(submitRevision("legacy", undefined, 5)).toEqual({ revision: 5 });
  });
});
