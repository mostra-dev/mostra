/**
 * Field coverage (D109): the builder's static field scan and the matcher the supervisor judges
 * orphans with. A version names the field IDs its code can use; a field it can't name is an
 * orphan of that version, and anything the scan can't follow makes the coverage open, so no answer
 * is ever orphaned by a guess.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanFields } from "../../src/builder/child/fields.ts";
import { coverageMatcher, type FieldCoverage } from "../../src/builder/coverage.ts";
import { tempDir } from "../support.ts";

async function scan(files: Record<string, string>): Promise<FieldCoverage> {
  const root = tempDir("fields");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return scanFields(root, Object.keys(files));
}

const ids = (coverage: FieldCoverage) =>
  coverage.entries.map((entry) => entry.id ?? entry.template?.join("*"));

describe("the field scan (D109)", () => {
  it("records literal IDs with their literal options and where they are", async () => {
    const coverage = await scan({
      "index.tsx": `import { useField, useChoice } from "@mostra/react";
export default function Page() {
  const [name] = useField("name", "", { label: "Your name", required: true });
  const [team] = useField("team", "", { scope: "artifact", sensitive: false });
  const choice = useChoice("layout");
  return null;
}
`,
    });
    expect(coverage.open).toBe(false);
    expect(coverage.entries).toEqual([
      expect.objectContaining({
        id: "name",
        hook: "useField",
        label: "Your name",
        required: true,
        location: { file: "index.tsx", line: 3, column: expect.any(Number) },
      }),
      expect.objectContaining({ id: "team", hook: "useField", scope: "artifact" }),
      expect.objectContaining({ id: "review.layout.choice", hook: "useChoice" }),
    ]);
  });

  it("forgets literal options a spread after them may replace (GPT review finding 12)", async () => {
    const coverage = await scan({
      "index.tsx": `import { useField } from "@mostra/react";
import { useForm } from "@mostra/react/form";
export default function Page(options: { scope?: "viewer" }) {
  const [answer] = useField("answer", "", { scope: "artifact", ...options });
  const [kept] = useField("kept", "", { ...options, scope: "artifact" });
  const form = useForm({ id: "old", ...options });
  return null;
}
`,
    });
    const answer = coverage.entries.find((entry) => entry.id === "answer");
    expect(answer?.scope).toBeUndefined();
    expect(coverage.entries.find((entry) => entry.id === "kept")?.scope).toBe("artifact");
    // The form's id may be replaced: the version covers every ID.
    expect(coverage.open).toBe(true);
    expect(coverageMatcher(coverage)("answer")).toBe(true);
  });

  it("records template IDs as patterns, follows renamed and namespace imports, and sees through TypeScript", async () => {
    const coverage = await scan({
      "index.tsx": `import { useField as field } from "@mostra/react";
import * as mostra from "@mostra/react";
export function Reply({ id }: { id: string }) {
  const [reply] = field(\`reply.\${id}\`, "");
  const [x] = mostra.useField("x" as const, 0);
  const [y] = mostra.useField(("y") satisfies string, 0);
  return null;
}
`,
    });
    expect(coverage.open).toBe(false);
    expect(ids(coverage)).toEqual(["reply.*", "x", "y"]);
  });

  it("records the form adapter's prefix and window.storage keys", async () => {
    const coverage = await scan({
      "form.tsx": `import { useForm } from "@mostra/react/form";
export function Intake() { const form = useForm({ id: "intake", defaultValues: { name: "" } }); return null; }
`,
      "store.ts": `export async function save() {
  await window.storage.set("prefs", "{}");
  await window.storage.get("prefs", true);
}
`,
    });
    expect(coverage.open).toBe(false);
    const matches = coverageMatcher(coverage);
    expect(matches("intake.name")).toBe(true);
    expect(matches("intake.address.city")).toBe(true);
    expect(matches("storage.prefs")).toBe(true);
    expect(matches("intakeX")).toBe(false);
  });

  it("opens the coverage for what it can't follow: a computed ID, a hook passed around, a re-export, the browser protocol", async () => {
    for (const [file, text] of [
      [
        "computed.tsx",
        `import { useField } from "@mostra/react";\nconst ids = ["a"]; export function P() { useField(ids[0], 0); return null; }\n`,
      ],
      [
        "passed.tsx",
        `import { useField } from "@mostra/react";\nexport const hooks = { useField };\n`,
      ],
      ["reexport.ts", `export { useField } from "@mostra/react";\n`],
      [
        "raw.ts",
        `export const save = () => fetch("/_mostra/v/2026-10-15/fields", { method: "POST" });\n`,
      ],
    ] as const) {
      const coverage = await scan({
        "index.tsx": `import { useField } from "@mostra/react";\nexport default function P() { useField("known", 0); return null; }\n`,
        [file]: text,
      });
      expect(coverage.open, file).toBe(true);
      expect(coverage.openReasons.length, file).toBeGreaterThan(0);
      expect(coverageMatcher(coverage)("anything"), file).toBe(true);
    }
  });

  it("covers everything for a version that names no field through @mostra/react", async () => {
    const coverage = await scan({ "index.tsx": "export default function P() { return null; }\n" });
    expect(coverage.open).toBe(true);
    expect(coverageMatcher(coverage)("whatever")).toBe(true);
  });

  it("reads MDX pages after compiling them", async () => {
    const coverage = await scan({
      "index.mdx": `---
title: Notes
---
import { useField } from "@mostra/react";

export function Notes() { const [n] = useField("mdx.notes", ""); return null; }

# Notes

<Notes />
`,
    });
    expect(coverage.open).toBe(false);
    expect(ids(coverage)).toEqual(["mdx.notes"]);
  });
});

describe("the coverage matcher (D109)", () => {
  const coverage = (entries: FieldCoverage["entries"], open = false): FieldCoverage => ({
    open,
    openReasons: [],
    entries,
  });
  const at = { file: "index.tsx", line: 1, column: 1 };

  it("covers literal IDs and templates, and nothing else", () => {
    const matches = coverageMatcher(
      coverage([
        { id: "name", hook: "useField", location: at },
        { template: ["reply.", ""], hook: "useField", location: at },
      ]),
    );
    expect(matches("name")).toBe(true);
    expect(matches("reply.m1")).toBe(true);
    expect(matches("reply.")).toBe(true);
    expect(matches("notes")).toBe(false);
    expect(matches("name.x")).toBe(false);
  });

  it("treats template text literally, never as a pattern", () => {
    const matches = coverageMatcher(
      coverage([{ template: ["a.b(", ")"], hook: "useField", location: at }]),
    );
    expect(matches("a.b(1)")).toBe(true);
    expect(matches("aXb(1)")).toBe(false);
  });

  it("leaves artifact-scoped entries out: a draft field is never artifact state", () => {
    const matches = coverageMatcher(
      coverage([{ id: "team", hook: "useField", scope: "artifact", location: at }]),
    );
    expect(matches("team")).toBe(false);
  });

  it("covers every ID for an open coverage and for a version built before WP-07", () => {
    expect(coverageMatcher(coverage([], true))("x")).toBe(true);
    expect(coverageMatcher(undefined)("x")).toBe(true);
  });
});
