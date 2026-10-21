import { describe, expect, it } from "vitest";
import { plan, publishableCrates, type RegistryState } from "../release/crates.ts";

describe("the crates a release publishes (D143)", () => {
  it("publishes a crate crates.io has without this version, waits for a first release's token, skips one it has", () => {
    const crates = [
      { name: "known", version: "0.2.0" },
      { name: "new", version: "0.2.0" },
      { name: "done", version: "0.2.0" },
    ];
    const states = new Map<string, RegistryState>([
      ["known", "without-version"],
      ["new", "absent"],
      ["done", "has-version"],
    ]);
    expect(plan(crates, states)).toEqual({ publish: ["known"], first: ["new"] });
  });

  it("finds the workspace's publishable crates: the host crate, never the reference host or codegen", () => {
    expect(publishableCrates().map((crate) => crate.name)).toEqual(["mostra-host"]);
  });
});
