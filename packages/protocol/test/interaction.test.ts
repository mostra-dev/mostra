import {
  BROWSER_PROTOCOL_REVISION,
  BROWSER_PROTOCOL_REVISIONS,
  canonicalJson,
  EventFilter,
  eventsAckMethod,
  eventsReadMethod,
  eventsSubscribeMethod,
  FieldsRequest,
  HomeConfig,
  hostMethods,
  isFieldId,
  MutationId,
  portDraftsMirrorMethod,
  portSubmissionsDeliverMethod,
  Results,
  resultsGetMethod,
  StreamSnapshot,
  SubmitRequest,
  stateGetMethod,
  statePatchMethod,
  ViewerId,
  ViewId,
  viewUrlMethod,
  WaitCondition,
  waitMethod,
} from "@mostra/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** Reads an IEEE 754 double from its 16 hex digits, as RFC 8785 Appendix B writes them. */
function double(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("canonicalJson (RFC 8785)", () => {
  it("serializes the RFC's §3.2.2 sample exactly as §3.2.3 prints it", () => {
    const parsed = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalJson(parsed)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts properties by UTF-16 code units, as §3.2.3's test data expects", () => {
    const parsed = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    const order = Object.values(JSON.parse(canonicalJson(parsed)) as Record<string, string>);
    // JSON.parse reorders integer-like keys first; the text itself is what RFC 8785 fixes.
    const text = canonicalJson(parsed);
    const positions = [
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ].map((name) => text.indexOf(name));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(order).toHaveLength(7);
  });

  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555554", "333333333.33333325"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
  ])("writes the number %s as %s (Appendix B)", (hex, text) => {
    expect(canonicalJson(double(hex))).toBe(text);
  });

  it("refuses what I-JSON can't hold", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson("\ud800")).toThrow(TypeError);
    expect(() => canonicalJson({ ["\udead"]: 1 })).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
  });

  it("is a fixed point of parsing, whatever the property order (property)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value);
        expect(canonicalJson(JSON.parse(text))).toBe(text);
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });
});

describe("field IDs", () => {
  it.each(["layout", "reply.m1", "q.1.answer", "a b", "review.set-1.choice", "x".repeat(256)])(
    "accepts %s",
    (id) => expect(isFieldId(id)).toBe(true),
  );
  it.each(["", ".a", "a.", "a..b", "x".repeat(257), "a\nb", "\u0000", 3])("refuses %j", (id) =>
    expect(isFieldId(id)).toBe(false),
  );
});

describe("interaction methods", () => {
  it("are registered with the right direction and mutability", () => {
    const names = hostMethods.map((method) => method.method);
    for (const method of [
      stateGetMethod,
      statePatchMethod,
      resultsGetMethod,
      waitMethod,
      eventsReadMethod,
      eventsSubscribeMethod,
      eventsAckMethod,
      portSubmissionsDeliverMethod,
      portDraftsMirrorMethod,
    ]) {
      expect(names).toContain(method.method);
    }
    expect(statePatchMethod.mutating).toBe(true);
    expect(stateGetMethod.mutating).toBe(false);
    expect(portSubmissionsDeliverMethod.direction).toBe("instance-to-host");
    expect(portDraftsMirrorMethod.direction).toBe("instance-to-host");
  });

  it("validate wait conditions", () => {
    for (const ok of [
      "submitted",
      "signal:ping-agent",
      "state:tasks.today",
      "event:submission.created",
      "event:submission.*",
      "event:host.mail-sent",
    ]) {
      expect(WaitCondition.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["submit", "signal:", "signal:-x", "state:", "event:Bad", "event:*", "x:y"]) {
      expect(WaitCondition.safeParse(bad).success, bad).toBe(false);
    }
    const artifact = { artifactId: "art_01JB0000000000000000000000" };
    expect(
      waitMethod.params.safeParse({ artifact, until: "submitted", timeoutMs: 2 ** 31 }).success,
    ).toBe(false);
    expect(
      waitMethod.params.safeParse({ artifact, until: "submitted", timeoutMs: 0, after: "12" })
        .success,
    ).toBe(true);
  });

  it("filter events by artifact and type pattern", () => {
    expect(EventFilter.safeParse({ types: ["submission.*", "signal.raised"] }).success).toBe(true);
    expect(EventFilter.safeParse({ types: ["*"] }).success).toBe(false);
    expect(EventFilter.safeParse({ artifacts: ["not-an-id"] }).success).toBe(false);
  });

  it("take state patches with a mutation ID and optional base", () => {
    const artifact = { artifactId: "art_01JB0000000000000000000000" };
    const mutationId = MutationId.create();
    expect(
      statePatchMethod.params.safeParse({
        artifact,
        mutationId,
        ops: [
          { id: "tasks.today", value: ["a"] },
          { id: "old", delete: true },
        ],
      }).success,
    ).toBe(true);
    expect(
      statePatchMethod.params.safeParse({ artifact, mutationId, ops: [], baseRevision: "3" })
        .success,
    ).toBe(false);
    expect(
      statePatchMethod.params.safeParse({
        artifact,
        mutationId: "m1",
        ops: [{ id: "a", value: 1 }],
      }).success,
    ).toBe(false);
  });

  it("let hosts set the home's policy and the ports they always provide (D102, D105)", () => {
    expect(
      HomeConfig.safeParse({ submission: { policy: "once" }, ports: ["submissions"] }).success,
    ).toBe(true);
    expect(HomeConfig.safeParse({ submission: { policy: "sometimes" } }).success).toBe(false);
  });

  it("mint links for a viewer (D104)", () => {
    const artifact = { artifactId: "art_01JB0000000000000000000000" };
    expect(
      viewUrlMethod.params.safeParse({ artifact, viewer: { ref: "ana@example.com", name: "Ana" } })
        .success,
    ).toBe(true);
    expect(viewUrlMethod.params.safeParse({ artifact, viewer: { ref: "" } }).success).toBe(false);
  });

  it("label deliveries and mirrors by kind (IN-06)", () => {
    expect(
      portDraftsMirrorMethod.params.safeParse({
        kind: "submission",
        artifactId: "art_01JB0000000000000000000000",
        viewerId: ViewerId.create(),
        epoch: 1,
        revision: "1",
        fields: {},
      }).success,
    ).toBe(false);
    const delivery = portSubmissionsDeliverMethod.result;
    expect(delivery.safeParse({ accepted: true }).success).toBe(true);
    expect(
      delivery.safeParse({ accepted: false, reason: "undeliverable", retry: false }).success,
    ).toBe(true);
    expect(delivery.safeParse({ accepted: false }).success).toBe(false);
  });

  it("accept a complete Results document", () => {
    const results = {
      artifact: { id: "art_01JB0000000000000000000000", title: "T", links: [] },
      submission: {
        id: "sub_01JB0000000000000000000000",
        at: "2026-10-15T08:00:00.000Z",
        epoch: 1,
        policy: { policy: "once", scope: "per-artifact" },
        channel: "shell",
        viewer: { id: ViewerId.create(), kind: "local" },
        versionId: "ver_0000000000000000000000000A",
        version: 1,
        viewId: ViewId.create(),
        staleView: false,
        draftRevision: "3",
        digest: "a".repeat(64),
        delivery: "pending",
        deliveries: [],
      },
      answers: { reply: { m1: "Thursday" } },
      fields: [{ id: "reply.m1", scope: "viewer" }],
      choices: [],
      comments: [],
      orphaned: [],
      actions: [],
      signals: [],
    };
    expect(Results.safeParse(results).success).toBe(true);
    expect(resultsGetMethod.result.safeParse(results).success).toBe(true);
    expect(
      resultsGetMethod.result.safeParse({ submissionId: results.submission.id, markdown: "# T" })
        .success,
    ).toBe(true);
  });
});

describe("browser protocol", () => {
  it("has one revision, the newest", () => {
    expect(BROWSER_PROTOCOL_REVISIONS.at(-1)).toBe(BROWSER_PROTOCOL_REVISION);
  });

  it("validates mutations, submits and snapshots", () => {
    const viewId = ViewId.create();
    expect(
      FieldsRequest.safeParse({
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId,
        ops: [{ id: "a", value: { nested: [1] } }],
      }).success,
    ).toBe(true);
    expect(
      FieldsRequest.safeParse({ mutationId: MutationId.create(), scope: "viewer", viewId, ops: [] })
        .success,
    ).toBe(false);
    expect(
      SubmitRequest.safeParse({ viewId, expectedRevision: "4", channel: "shell" }).success,
    ).toBe(false);
    expect(
      StreamSnapshot.safeParse({
        cursor: "9",
        viewer: { id: ViewerId.create(), kind: "local" },
        draft: { revision: "0", epoch: 1, fields: {} },
        state: { revision: "0", epoch: 1, fields: {} },
      }).success,
    ).toBe(true);
  });
});
