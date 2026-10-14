import { describe, expect, it } from "vitest";
import { parseTarget, tokenFrom } from "../src/location.ts";
import { explain } from "../src/messages.ts";

const ID = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";

describe("shell URLs (D97)", () => {
  it("names an artifact, optionally a version", () => {
    expect(parseTarget(`/a/${ID}`)).toEqual({ artifactId: ID, apiBase: `/a/${ID}/_mostra` });
    expect(parseTarget(`/a/${ID}/`)).toEqual({ artifactId: ID, apiBase: `/a/${ID}/_mostra` });
    expect(parseTarget(`/a/${ID}/v/3`)).toEqual({
      artifactId: ID,
      version: 3,
      apiBase: `/a/${ID}/_mostra`,
    });
  });

  it("refuses everything else", () => {
    for (const path of [
      "/",
      `/a/${ID}/v/0`,
      `/a/${ID}/v/x`,
      "/a/art_lower",
      `/a/${ID}/extra`,
      `/b/${ID}`,
    ]) {
      expect(parseTarget(path), path).toBeUndefined();
    }
  });

  it("reads the token from the fragment only", () => {
    expect(tokenFrom("#t=ABC")).toBe("ABC");
    expect(tokenFrom("t=ABC")).toBe("ABC");
    expect(tokenFrom("#t=")).toBeUndefined();
    expect(tokenFrom("")).toBeUndefined();
    expect(tokenFrom("#x=1")).toBeUndefined();
  });
});

describe("what the shell tells a person (FAILURE_MODEL §8)", () => {
  it("explains a revoked or expired link in plain words", () => {
    expect(explain("MOSTRA_HYGIENE_TOKEN_REVOKED").title).toMatch(/revoked or has expired/);
  });

  it("never leaves a code without an explanation", () => {
    for (const code of ["MOSTRA_HYGIENE_SESSION_MISSING", "MOSTRA_SOMETHING_NEW", "NO_ARTIFACT"]) {
      const { title, detail } = explain(code);
      expect(title.length).toBeGreaterThan(0);
      expect(detail.length).toBeGreaterThan(0);
    }
  });
});
