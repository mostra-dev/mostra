import { createServerReference, defineArtifact } from "@mostra/react";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("defineArtifact (INTERFACES §2.2)", () => {
  it("returns the manifest unchanged, with its literal types", () => {
    const manifest = defineArtifact({ title: "Q3 plan", family: "proposal", mode: "spa" });
    expect(manifest).toEqual({ title: "Q3 plan", family: "proposal", mode: "spa" });
    expectTypeOf(manifest.family).toEqualTypeOf<"proposal">();
  });

  it("checks the manifest's shape at compile time", () => {
    // @ts-expect-error title is required
    defineArtifact({ family: "deck" });
    // @ts-expect-error spa is the only render mode (D19)
    defineArtifact({ title: "x", mode: "rsc" });
  });
});

describe("createServerReference (D54)", () => {
  it("carries the function ID and rejects where no server runs the call", async () => {
    const send = createServerReference("actions.ts#sendReply");
    expect(send.mostraServerFunctionId).toBe("actions.ts#sendReply");
    await expect(send("m1")).rejects.toMatchObject({ code: "MOSTRA_TARGET_UNAVAILABLE" });
  });
});
