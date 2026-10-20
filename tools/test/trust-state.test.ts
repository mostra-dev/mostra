/**
 * The judgement of `npm trust list --json` that tools/release/npm-setup.sh acts on. The first
 * release's npm steps took an EOTP error (npm wanting a one-time password it couldn't ask for)
 * for "a trusted publisher exists" and skipped configuring one: only an empty answer may be
 * `none`, and anything npm doesn't say clearly is `unreadable`, never a state.
 */
import { describe, expect, it } from "vitest";
import { judge, line } from "../release/trust-state.ts";

const publisher = { repository: "mostra-dev/mostra", file: "release.yml", environment: "release" };
const ours = {
  id: "a1",
  type: "github",
  file: "release.yml",
  repository: "mostra-dev/mostra",
  environment: "release",
};

describe("npm-setup's trusted-publisher judgement", () => {
  it("reads an empty answer as none, in either form npm gives it", () => {
    expect(judge("", publisher)).toEqual({ kind: "none" });
    expect(judge("  []\n", publisher)).toEqual({ kind: "none" });
  });

  it("reads exactly this repository, workflow and environment as ours", () => {
    expect(judge(JSON.stringify(ours, null, 2), publisher)).toEqual({ kind: "ours" });
    expect(judge(JSON.stringify([ours]), publisher)).toEqual({ kind: "ours" });
  });

  it("reads anything else as another publisher, which the script refuses to overwrite", () => {
    for (const changed of [
      { ...ours, file: "publish.yml" },
      { ...ours, environment: undefined },
      { ...ours, repository: "someone/fork" },
      { ...ours, type: "gitlab" },
    ]) {
      expect(judge(JSON.stringify(changed), publisher).kind).toBe("other");
    }
    // One of two configurations being ours isn't enough.
    const two = `${JSON.stringify(ours)}\n${JSON.stringify({ ...ours, id: "b2", file: "x.yml" })}`;
    expect(judge(two, publisher).kind).toBe("other");
  });

  it("never reads an error as a state: npm's EOTP, alone or followed by the old `|| echo []`", () => {
    const eotp = JSON.stringify(
      {
        error: {
          code: "EOTP",
          summary: "This operation requires a one-time password.",
          authUrl: "https://www.npmjs.com/auth/cli/x",
        },
      },
      null,
      2,
    );
    expect(judge(eotp, publisher)).toEqual({
      kind: "unreadable",
      why: "EOTP: This operation requires a one-time password.",
    });
    expect(judge(`${eotp}\n[]`, publisher).kind).toBe("unreadable");
    expect(line(judge(`${eotp}\n[]`, publisher))).toMatch(/^unreadable EOTP/);
  });

  it("reads text that isn't npm's JSON as unreadable", () => {
    for (const text of ["npm ERR! something", "{ broken", "[]x", '{"a":1}}']) {
      expect(judge(text, publisher).kind).toBe("unreadable");
    }
  });
});
