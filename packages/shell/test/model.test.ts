import type { EventRecord, FrameTicket, StreamSnapshot } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  ARM_MS,
  allowedSubmitLabel,
  controlsArmed,
  initialState,
  submitRevision,
  withControlRequest,
  withEvents,
  withSnapshot,
  withSubmission,
} from "../src/model.ts";

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

describe("the receipt never goes back (Claude review finding 8)", () => {
  const delivery = {
    deliveryId: "dlv_01J00000000000000000000000",
    owner: "jcode",
    state: "pending" as const,
    attempts: 0,
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
  const summary = {
    id: "sub_01J00000000000000000000000",
    at: "2026-10-16T00:00:00.000Z",
    epoch: 1,
    channel: "shell" as const,
    versionId: "ver_00000000000000000000000001",
    version: 1,
    viewId: TICKET.viewId,
    staleView: false,
    draftRevision: "1",
    digest: "0".repeat(64),
    delivery: "pending" as const,
    deliveries: [delivery],
  };
  const event = (type: string, at: string): EventRecord => ({
    cursor: "30" as EventRecord["cursor"],
    artifactId: TICKET.artifactId,
    seq: 3,
    type,
    at,
    actor: { kind: "mostra" },
    payload: { submissionId: summary.id, deliveryId: delivery.deliveryId, owner: "jcode" },
  });

  it("applies a delivery event that came before the submit's answer", () => {
    let state = withEvents(initialState(TICKET), [
      event("submission.retrying", "2026-10-16T00:00:01.000Z"),
    ]);
    state = withSubmission(state, summary);
    expect(state.submission?.deliveries?.[0]?.waiting).toBe(true);
  });

  it("keeps a newer delivery state over an answer built before it", () => {
    let state = withSubmission(initialState(TICKET), summary);
    state = withEvents(state, [event("submission.delivered", "2026-10-16T00:00:02.000Z")]);
    state = withSubmission(state, summary);
    expect(state.submission?.delivery).toBe("delivered");
  });
});

describe("the artifact can't change a trusted control under the viewer's click (Claude review finding 6)", () => {
  it("re-arms a control whose target or words change, and keeps a fresh one disabled", () => {
    const at = 10_000;
    let state = withControlRequest(
      initialState(TICKET),
      {
        control: "choose",
        reviewSetId: "layout",
        candidates: [{ id: "airy" }, { id: "dense" }],
        current: "airy",
      },
      at,
    ).state;
    expect(controlsArmed(state, 0, at + ARM_MS - 1)).toBe(false);
    expect(controlsArmed(state, 0, at + ARM_MS)).toBe(true);
    // Swapped as the pointer heads for the rail: disabled again.
    state = withControlRequest(
      state,
      {
        control: "choose",
        reviewSetId: "layout",
        candidates: [{ id: "airy" }, { id: "dense" }],
        current: "dense",
      },
      at + 2_000,
    ).state;
    expect(controlsArmed(state, 0, at + 2_100)).toBe(false);
    // The same request again changes nothing and doesn't re-arm.
    const same = withControlRequest(
      state,
      {
        control: "choose",
        reviewSetId: "layout",
        candidates: [{ id: "airy" }, { id: "dense" }],
        current: "dense",
      },
      at + 5_000,
    ).state;
    expect(same.controlsChangedAt).toBe(at + 2_000);
  });

  it("keeps a page shown or focused a moment ago disabled (a popup of the shell under a second click)", () => {
    expect(controlsArmed(initialState(TICKET), 50_000, 50_100)).toBe(false);
    expect(controlsArmed(initialState(TICKET), 50_000, 50_000 + ARM_MS)).toBe(true);
  });

  it("never lets the Submit read as one of the shell's states", () => {
    for (const label of [
      "Submitted",
      "submitted ✓",
      "Saved",
      "Delivered",
      "Pending delivery",
      "  saving…",
    ]) {
      expect(allowedSubmitLabel(label)).toBe(false);
    }
    for (const label of ["Submit & Send", "Send answers", "Approve the plan", "Save draft"]) {
      expect(allowedSubmitLabel(label)).toBe(true);
    }
    const state = withControlRequest(
      initialState(TICKET),
      { control: "submit", label: "Submitted" },
      1,
    ).state;
    expect(state.submitLabel).toBeUndefined();
  });

  it("keeps a confirmation once asked for: a release gives the label back, never the question", () => {
    let state = withControlRequest(
      initialState(TICKET),
      { control: "submit", label: "Send", confirm: "Final answers?" },
      1,
    ).state;
    state = withControlRequest(state, { control: "release", submit: true }, 2).state;
    expect(state.submitLabel).toBeUndefined();
    expect(state.submitConfirm).toBe("Final answers?");
  });
});
