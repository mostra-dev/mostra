import { createServerReference, defineArtifact, useField } from "@mostra/react";
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

describe("useField's types (D52)", () => {
  it("takes its type from the initial value, as useState does, whatever the validator says", () => {
    // Types only: nothing renders.
    const typed = (): void => {
      const [count, setCount] = useField("count", 1, {
        validate: (value: number) => (value > 2 ? "At most 2" : undefined),
      });
      expectTypeOf(count).toEqualTypeOf<number>();
      setCount(3);
      setCount((previous) => previous + 1);
      const [layout] = useField<"a" | "b">("layout", "a");
      expectTypeOf(layout).toEqualTypeOf<"a" | "b">();
      // @ts-expect-error a string field takes no number
      useField("name", "")[1](1);
    };
    expect(typeof typed).toBe("function");
  });
});
