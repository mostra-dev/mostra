/**
 * The channel policy a frame ticket resolves (D40, D108): a host that registered
 * `trustedControls` answers per artifact; without one the home's `submitChannels` hold; without
 * those both channels; and a host that registered the port but can't answer narrows the view to
 * the shell channel, never widens it.
 */
import type { ArtifactDetail, SubmitChannel } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { controlsPolicy } from "../../src/gateway/controls.ts";
import { silentLog } from "../../src/log.ts";

const ARTIFACT = {
  id: "art_01J00000000000000000000000",
  title: "Plan",
  links: [],
  mode: "spa",
  createdAt: "2026-10-15T00:00:00.000Z",
  manifest: { title: "Plan" },
  versions: [],
} as unknown as ArtifactDetail;

function input(options: {
  home?: readonly SubmitChannel[];
  host?: (params: unknown) => Promise<unknown>;
}) {
  const calls: unknown[] = [];
  return {
    calls,
    input: {
      artifact: ARTIFACT,
      log: silentLog,
      home: () => options.home,
      registrant: () => (options.host ? { session: 7, owner: "jcode" } : undefined),
      call: async (session: number, params: unknown) => {
        calls.push({ session, params });
        if (!options.host) throw new Error("no host");
        return options.host(params);
      },
    },
  };
}

describe("the channel policy in force for a view (D108)", () => {
  it("is both channels in the standalone host (D40)", async () => {
    expect(await controlsPolicy(input({}).input)).toEqual({
      submitChannels: ["shell", "artifact"],
    });
  });

  it("is the home's submitChannels when no host registered the port", async () => {
    expect(await controlsPolicy(input({ home: ["shell"] }).input)).toEqual({
      submitChannels: ["shell"],
    });
  });

  it("is the registered host's answer, asked with the artifact's summary only, over the home's", async () => {
    const { input: asked, calls } = input({
      home: ["shell", "artifact"],
      host: async () => ({ submitChannels: ["artifact", "shell"], controls: ["choose", "choose"] }),
    });
    expect(await controlsPolicy(asked)).toEqual({
      submitChannels: ["shell", "artifact"],
      controls: ["choose"],
    });
    expect(calls).toEqual([
      {
        session: 7,
        params: { artifact: expect.not.objectContaining({ versions: expect.anything() }) },
      },
    ]);
    expect((calls[0] as { params: { artifact: object } }).params.artifact).not.toHaveProperty(
      "manifest",
    );
  });

  it("narrows to the shell channel when the host fails, times out or answers nonsense", async () => {
    for (const host of [
      async () => {
        throw new Error("timeout");
      },
      async () => ({ submitChannels: "everything" }),
      async () => ({ submitChannels: [] }),
    ]) {
      expect(await controlsPolicy(input({ home: ["artifact"], host }).input)).toEqual({
        submitChannels: ["shell"],
      });
    }
  });
});
