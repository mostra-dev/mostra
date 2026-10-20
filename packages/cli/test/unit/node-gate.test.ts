/** The Node.js gate `mostra` passes first (RT-01, D142): 22.19 or later starts it. */
import { describe, expect, it } from "vitest";
import { nodeTooOld } from "../../src/node-gate.ts";

describe("the Node.js gate", () => {
  it("refuses releases before 22.19 and starts on 22.19 and later", () => {
    for (const old of ["18.20.4", "20.20.2", "22.0.0", "22.18.9"])
      expect(nodeTooOld(old)).toBe(true);
    for (const fine of ["22.19.0", "22.22.1", "24.21.0", "26.0.0", "30.1.2"])
      expect(nodeTooOld(fine)).toBe(false);
  });
});
