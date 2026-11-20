import { PACKAGE_NAME } from "@mostra/kit";
import { describe, expect, it } from "vitest";

describe("@mostra/kit", () => {
  it("loads through its public entry point", () => {
    expect(PACKAGE_NAME).toBe("@mostra/kit");
  });
});
