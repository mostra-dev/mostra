import { readViewContext, uiInitialize, type ViewContext } from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const VIEW: ViewContext = {
  artifactId: "art_01J00000000000000000000000",
  viewId: "vw_01J00000000000000000000000",
  version: { id: "ver_00000000000000000000000001", number: 1 },
  latest: { id: "ver_00000000000000000000000001", number: 1 },
  policy: { policy: "once", scope: "per-artifact" },
  submitChannels: ["shell", "artifact"],
  controls: ["submit", "choose"],
  target: "live",
};

const initialized = (mostra: unknown) => ({
  protocolVersion: "2026-01-26",
  hostInfo: { name: "mostra-shell", version: "0" },
  hostCapabilities: {},
  hostContext: {},
  mostra,
});

describe("a page reads values a later shell adds (Claude review finding 5)", () => {
  it("accepts a view with a channel, policy, scope and target it doesn't know", () => {
    for (const later of [
      { submitChannels: ["shell", "host"] },
      { policy: { policy: "once", scope: "per-team" } },
      { policy: { policy: "quorum" } },
      { target: "hosted" },
      { newKey: 1 },
    ]) {
      expect(uiInitialize.result.safeParse(initialized({ ...VIEW, ...later })).success).toBe(true);
    }
  });

  it("reads them the safe way: an unknown channel isn't allowed, an unknown policy is once per viewer", () => {
    expect(
      readViewContext({ ...VIEW, submitChannels: ["artifact-v2", "shell"] }).submitChannels,
    ).toEqual(["shell"]);
    expect(readViewContext({ ...VIEW, submitChannels: ["host"] }).submitChannels).toEqual([
      "shell",
    ]);
    expect(readViewContext({ ...VIEW, policy: { policy: "quorum" } }).policy).toEqual({
      policy: "once",
      scope: "per-viewer",
    });
    expect(
      readViewContext({ ...VIEW, policy: { policy: "once", scope: "per-team" } }).policy,
    ).toEqual({
      policy: "once",
      scope: "per-viewer",
    });
    expect(readViewContext({ ...VIEW, target: "hosted" }).target).toBe("live");
    expect(readViewContext(VIEW)).toEqual(VIEW);
  });
});
