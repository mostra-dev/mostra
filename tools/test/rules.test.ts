/**
 * Unit tests for the pure rules behind the gates: schema compatibility (HO-07), commit messages
 * (EN-01), action pinning (EN-06) and Markdown links.
 */
import { describe, expect, it } from "vitest";
import { checkMessage } from "../commits/cli.ts";
import { brokenLinks } from "../docs/links.ts";
import { workflowProblems } from "../repo-lint/cli.ts";
import { type Bundle, compareBundles, newRevisions, type Schema } from "../schemas/compat.ts";

const bundle = (defs: Record<string, Schema>, revision = "2026-10-10"): Bundle => ({
  "x-mostra-revisions": { "host-protocol": revision },
  $defs: defs,
});
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  required,
});
const reasons = (before: Record<string, Schema>, after: Record<string, Schema>): string[] =>
  compareBundles(bundle(before), bundle(after)).map((item) => `${item.path}: ${item.reason}`);

describe("schema compatibility", () => {
  const base = { T: obj({ a: { type: "string" }, b: { type: "number" } }, ["a"]) };

  it("accepts additive changes", () => {
    expect(reasons(base, { ...base, U: { type: "string" } })).toEqual([]);
    expect(
      reasons(base, {
        T: obj({ a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } }, ["a"]),
      }),
    ).toEqual([]);
    expect(
      reasons({ E: { type: "string", enum: ["x"] } }, { E: { type: "string", enum: ["x", "y"] } }),
    ).toEqual([]);
    expect(reasons({ N: { type: "integer" } }, { N: { type: "number" } })).toEqual([]);
    expect(
      reasons({ S: { type: "string", maxLength: 5 } }, { S: { type: "string", maxLength: 9 } }),
    ).toEqual([]);
    expect(
      reasons(
        { D: { type: "string", description: "a" } },
        { D: { type: "string", description: "b" } },
      ),
    ).toEqual([]);
    expect(
      reasons({ R: obj({ a: { required: [] } }) }, { R: obj({ a: { required: [] } }) }),
    ).toEqual([]);
  });

  it("rejects removed definitions and fields", () => {
    expect(reasons(base, {})).toEqual(["T: definition removed"]);
    expect(reasons(base, { T: obj({ a: { type: "string" } }, ["a"]) })).toEqual([
      "T.b: field removed",
    ]);
  });

  it("rejects narrowed types", () => {
    expect(reasons({ N: { type: "number" } }, { N: { type: "integer" } })).toEqual([
      "N: type number no longer accepted",
    ]);
    expect(reasons({ U: { type: ["string", "null"] } }, { U: { type: "string" } })).toEqual([
      "U: type null no longer accepted",
    ]);
    expect(reasons({ S: { type: "string" } }, { S: { type: "string", pattern: "^a" } })).toEqual([
      "S: pattern added or changed",
    ]);
    expect(
      reasons({ S: { type: "string", minLength: 1 } }, { S: { type: "string", minLength: 2 } }),
    ).toEqual(["S: minLength raised"]);
    expect(reasons({ S: { type: "string" } }, { S: { const: "x" } })).toEqual([
      "S: const added or changed",
    ]);
    expect(
      reasons({ O: obj({}) }, { O: { ...(obj({}) as object), additionalProperties: false } }),
    ).toEqual(["O: unknown fields no longer accepted"]);
  });

  it("rejects removed enum values and newly required fields", () => {
    expect(
      reasons({ E: { type: "string", enum: ["x", "y"] } }, { E: { type: "string", enum: ["x"] } }),
    ).toEqual(['E: enum value "y" removed']);
    expect(
      reasons(base, { T: obj({ a: { type: "string" }, b: { type: "number" } }, ["a", "b"]) }),
    ).toEqual(["T.b: field became required"]);
  });

  it("follows references and checks alternatives", () => {
    const before = { A: { type: "string" }, W: obj({ v: { $ref: "#/$defs/A" } }) };
    expect(
      reasons(before, { A: { type: "integer" }, W: obj({ v: { $ref: "#/$defs/A" } }) }),
    ).toEqual(["A: type string no longer accepted"]);
    expect(
      reasons(before, {
        A: { type: "string" },
        B: { type: "number" },
        W: obj({ v: { $ref: "#/$defs/B" } }),
      }),
    ).toEqual(["W.v: type string no longer accepted"]);
    const union = { U: { anyOf: [{ type: "string" }, { type: "number" }] } };
    expect(
      reasons(union, { U: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] } }),
    ).toEqual([]);
    expect(reasons(union, { U: { anyOf: [{ type: "string" }] } })).toEqual([
      "U.anyOf[1]: alternative removed or narrowed",
    ]);
  });

  it("fails closed on keywords it doesn't model", () => {
    expect(
      reasons({ X: { type: "string" } }, { X: { type: "string", contentMediaType: "text/x" } }),
    ).toEqual(['X: keyword "contentMediaType" changed, and the checker can\'t prove it additive']);
  });

  it("reports surfaces whose revision moved forward", () => {
    expect(newRevisions(bundle({}), bundle({}, "2027-01-01"))).toEqual([
      "host-protocol 2027-01-01",
    ]);
    expect(newRevisions(bundle({}), bundle({}))).toEqual([]);
  });
});

describe("commit messages", () => {
  const commit = (message: string, authorEmail = "a@example.test") => ({
    id: "c",
    authorName: "A",
    authorEmail,
    message,
  });
  const signed = "\n\nSigned-off-by: A <a@example.test>";

  it("accepts Conventional Commits with a matching sign-off", () => {
    for (const subject of [
      "feat(protocol): add IDs",
      "fix: x",
      "docs(design,progress): y",
      "feat!: z",
      "ci(deps): pin",
    ]) {
      expect(checkMessage(commit(subject + signed))).toEqual([]);
    }
  });

  it("rejects other subjects, missing or mismatched sign-offs and a missing blank line", () => {
    expect(checkMessage(commit(`Add stuff${signed}`))[0]).toContain("is not a Conventional Commit");
    expect(checkMessage(commit("feat: x"))).toEqual([
      "missing the DCO sign-off: commit with `git commit -s` (Signed-off-by: Name <email>)",
    ]);
    expect(checkMessage(commit(`feat: x${signed}`, "b@example.test"))).toEqual([
      "no Signed-off-by trailer matches the author <b@example.test>",
    ]);
    expect(checkMessage(commit(`feat: x\nbody${signed}`))).toContain(
      "the second line must be blank",
    );
    expect(checkMessage(commit(`feat: ${"x".repeat(120)}${signed}`))[0]).toContain("at most 100");
  });
});

describe("action pinning", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const workflow = (step: string) =>
    `name: x\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: ${step}\n`;

  it("accepts SHA pins with a version comment, local actions and digest-pinned images", () => {
    expect(
      workflowProblems(".github/workflows/a.yml", workflow(`actions/checkout@${sha} # v4.2.2`)),
    ).toEqual([]);
    expect(
      workflowProblems(".github/workflows/a.yml", workflow("./.github/actions/setup")),
    ).toEqual([]);
    expect(
      workflowProblems(
        ".github/workflows/a.yml",
        workflow(`docker://alpine@sha256:${"a".repeat(64)}`),
      ),
    ).toEqual([]);
  });

  it("rejects tags, branches, missing comments and workflows without permissions", () => {
    expect(
      workflowProblems(".github/workflows/a.yml", workflow("actions/checkout@v4"))[0],
    ).toContain("full commit SHA");
    expect(
      workflowProblems(".github/workflows/a.yml", workflow("actions/checkout@main"))[0],
    ).toContain("full commit SHA");
    expect(
      workflowProblems(".github/workflows/a.yml", workflow(`actions/checkout@${sha}`))[0],
    ).toContain("version comment");
    expect(
      workflowProblems(".github/workflows/a.yml", "name: x\non: push\njobs: {}\n")[0],
    ).toContain("top-level permissions");
  });
});

describe("Markdown links", () => {
  it("reports relative links whose target is missing and ignores code, URLs and anchors", () => {
    const text =
      "[ok](b.md) [bad](missing.md#x) [web](https://x.test) [anchor](#top) `[code](nope.md)`";
    expect(brokenLinks("docs/a.md", text, (path) => path === "docs/b.md")).toEqual([
      "docs/a.md: link to missing.md#x does not resolve",
    ]);
  });
});
