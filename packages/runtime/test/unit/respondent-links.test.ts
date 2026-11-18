/**
 * Respondents' personal links are each their own (#184, D168, D104): the owner's `share/start`
 * and the hosted `roster/add` refuse to hand out a link that is the share's own, another
 * respondent's, or one that acts as nobody, and say whose it was without a secret.
 */
import type { CapabilityLink } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { checkRespondentLinks } from "../../src/gateway/team.ts";

const link = (tokenId: string, ref?: string): CapabilityLink => ({
  url: `https://home.example/a/art#t=secret-of-${tokenId}`,
  tokenId,
  scopes: ["draft", "submit", "view"],
  ...(ref !== undefined ? { viewer: { id: `vw_${ref}`, kind: "token" as const, ref } } : {}),
});

const refused = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    const diagnostic = (error as { diagnostic?: { code: string; message: string } }).diagnostic;
    expect(diagnostic?.code).toBe("MOSTRA_HOST_INTERNAL_ERROR");
    return diagnostic?.message ?? "";
  }
  throw new Error("expected a refusal");
};

describe("respondents' personal links (#184)", () => {
  it("lets each respondent's own link through", () => {
    expect(() =>
      checkRespondentLinks(
        [
          { ref: "ada@example.com", link: link("tk_ada", "ada@example.com") },
          { ref: "sam@example.com", link: link("tk_sam", "sam@example.com") },
        ],
        ["tk_share"],
      ),
    ).not.toThrow();
  });

  it("refuses the share's own link given for the last respondent, as #184 was reported", () => {
    const message = refused(() =>
      checkRespondentLinks(
        [
          { ref: "ada@example.com", link: link("tk_ada", "ada@example.com") },
          // The share's link carries no viewer: a link of its own token for Sam.
          { ref: "sam@example.com", link: link("tk_share") },
        ],
        ["tk_share"],
      ),
    );
    expect(message).toContain("sam@example.com");
    expect(message).not.toContain("secret-of");
  });

  it("refuses the share's own token even when it claims the respondent's viewer", () => {
    expect(
      refused(() =>
        checkRespondentLinks(
          [{ ref: "sam@example.com", link: link("tk_share", "sam@example.com") }],
          ["tk_share"],
        ),
      ),
    ).toContain("the share's own link");
  });

  it("refuses one link given for two respondents, and a link acting as someone else", () => {
    expect(
      refused(() =>
        checkRespondentLinks([
          { ref: "ada", link: link("tk_one", "ada") },
          { ref: "sam", link: { ...link("tk_one", "ada"), viewer: link("x", "sam").viewer } },
        ]),
      ),
    ).toContain("also the one given for ada");
    expect(
      refused(() => checkRespondentLinks([{ ref: "sam", link: link("tk_ada", "ada") }])),
    ).toContain("acts as another person");
  });
});
