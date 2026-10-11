/**
 * Static manifest extraction (D51, AU-07, AU-04): literal manifests are read without running code;
 * anything that needs evaluation is MOSTRA_MANIFEST_NOT_LITERAL with its location.
 */
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { extractManifest } from "../../src/publish/index.ts";

const ID = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const entry = (manifest: string, imports = 'import { defineArtifact } from "@mostra/react";') =>
  `${imports}\n${manifest}\nexport default function Page() { return <p>x</p>; }\n`;

function failure(file: string, text: string) {
  try {
    extractManifest(file, text);
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic;
    throw error;
  }
  throw new Error("expected a diagnostic");
}

describe("literal manifests (D51, AU-04)", () => {
  it("reads every manifest field, with mode left to its spa default", () => {
    const { manifest, hasDefaultExport, warnings } = extractManifest(
      "index.tsx",
      entry(`export const artifact = defineArtifact({
  id: "${ID}",
  title: "Q3 plan",
  description: \`Plain template\`,
  family: "proposal",
  links: [{ rel: "round-of", artifact: "${ID}" }],
  submission: { policy: "once", scope: "per-viewer" },
  kit: { base: "radix" },
  limits: { heapMb: 512, watchdogMs: +10000 },
  verify: { viewports: ["1280x800"], smoke: false },
  "terminals": { htop: { command: ["htop"], cols: 120 } },
} as const satisfies object);`),
    );
    expect(manifest).toEqual({
      id: ID,
      title: "Q3 plan",
      description: "Plain template",
      family: "proposal",
      links: [{ rel: "round-of", artifact: ID }],
      submission: { policy: "once", scope: "per-viewer" },
      kit: { base: "radix" },
      limits: { heapMb: 512, watchdogMs: 10000 },
      verify: { viewports: ["1280x800"], smoke: false },
      terminals: { htop: { command: ["htop"], cols: 120 } },
    });
    expect(manifest?.mode).toBeUndefined();
    expect(hasDefaultExport).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("accepts an aliased import, a namespace import and a const exported by name", () => {
    expect(
      extractManifest(
        "index.tsx",
        entry(
          'export const artifact = define({ title: "A" });',
          'import { defineArtifact as define } from "@mostra/react";',
        ),
      ).manifest,
    ).toEqual({ title: "A" });
    expect(
      extractManifest(
        "index.tsx",
        entry(
          'export const artifact = M.defineArtifact({ title: "B" });',
          'import * as M from "@mostra/react";',
        ),
      ).manifest,
    ).toEqual({ title: "B" });
    expect(
      extractManifest(
        "index.tsx",
        entry('const artifact = defineArtifact({ title: "C" });\nexport { artifact };'),
      ).manifest,
    ).toEqual({ title: "C" });
  });

  it("treats an entry without a manifest as one with defaults", () => {
    const result = extractManifest("page.tsx", "export default function Page() { return null; }\n");
    expect(result).toEqual({ manifest: undefined, hasDefaultExport: true, warnings: [] });
    expect(extractManifest("page.jsx", "export const x = 1;\n").hasDefaultExport).toBe(false);
    expect(
      extractManifest("page.tsx", "function P() {}\nexport { P as default };\n").hasDefaultExport,
    ).toBe(true);
  });

  it("warns about unknown keys, so newer manifests still publish", () => {
    const { manifest, warnings } = extractManifest(
      "index.tsx",
      entry('export const artifact = defineArtifact({ title: "x", familly: "deck" });'),
    );
    expect(manifest).toEqual({ title: "x" });
    expect(warnings.map((warning) => warning.code)).toEqual(["MOSTRA_MANIFEST_UNKNOWN_KEY"]);
    expect(warnings[0]?.severity).toBe("warning");
  });
});

describe("values that need evaluation (AU-07)", () => {
  // Each case names the source text the location must point at.
  const cases: [string, string, string][] = [
    ["an identifier", "export const artifact = defineArtifact({ title: TITLE });", "TITLE"],
    ["a call", "export const artifact = defineArtifact({ title: makeTitle() });", "makeTitle"],
    ["a spread", 'export const artifact = defineArtifact({ ...base, title: "x" });', "...base"],
    ["a computed key", 'export const artifact = defineArtifact({ [key]: "x" });', "[key]"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the case is artifact source with a placeholder.
    ["a template placeholder", "export const artifact = defineArtifact({ title: `Q${n}` });", "`Q"],
    ["a shorthand property", "export const artifact = defineArtifact({ title });", "title }"],
    ["a method", "export const artifact = defineArtifact({ title() { return 1; } });", "title()"],
    [
      "a non-literal argument",
      "export const artifact = defineArtifact(base);",
      "defineArtifact(base)",
    ],
    [
      "something other than defineArtifact",
      'export const artifact = { title: "x" };',
      '{ title: "x" }',
    ],
    [
      "an array hole",
      'export const artifact = defineArtifact({ title: "x", verify: { viewports: [, "a"] } });',
      '[, "a"]',
    ],
  ];
  for (const [what, manifest, at] of cases) {
    it(`reports ${what} with its location`, () => {
      const diagnostic = failure("index.tsx", entry(manifest));
      expect(diagnostic.code).toBe("MOSTRA_MANIFEST_NOT_LITERAL");
      expect(diagnostic.location).toEqual({
        file: "index.tsx",
        line: 2,
        column: manifest.indexOf(at) + 1,
      });
    });
  }

  it("reports a manifest that isn't a const", () => {
    expect(
      failure("index.tsx", entry('export let artifact = defineArtifact({ title: "x" });')).code,
    ).toBe("MOSTRA_MANIFEST_NOT_LITERAL");
    expect(failure("index.tsx", entry('export { artifact } from "./manifest";')).code).toBe(
      "MOSTRA_MANIFEST_NOT_LITERAL",
    );
  });
});

describe("invalid manifests", () => {
  it("names the field: missing title, foreign id, unsupported mode, wrong policy", () => {
    for (const [manifest, field] of [
      ['{ description: "no title" }', "title"],
      ['{ title: "x", id: "my-dashboard" }', "id"],
      ['{ title: "x", mode: "rsc" }', "mode"],
      ['{ title: "x", submission: { policy: "twice" } }', "submission"],
    ] as const) {
      const diagnostic = failure(
        "index.tsx",
        entry(`export const artifact = defineArtifact(${manifest});`),
      );
      expect(diagnostic.code).toBe("MOSTRA_MANIFEST_INVALID");
      expect(diagnostic.message).toContain(`\`${field}`);
    }
  });

  it("asks for the import when defineArtifact isn't imported", () => {
    const diagnostic = failure(
      "index.tsx",
      entry('export const artifact = defineArtifact({ title: "x" });', ""),
    );
    expect(diagnostic.code).toBe("MOSTRA_MANIFEST_INVALID");
    expect(diagnostic.message).toContain('import { defineArtifact } from "@mostra/react"');
  });

  it("reports a syntax error in the entry with its location", () => {
    const diagnostic = failure("index.tsx", "export const x = (;\n");
    expect(diagnostic).toMatchObject({
      code: "MOSTRA_BUILD_FAILED",
      location: { file: "index.tsx", line: 1, column: 19 },
    });
  });
});

describe("MDX frontmatter (D51)", () => {
  it("is the manifest of an MDX entry", () => {
    const { manifest, hasDefaultExport } = extractManifest(
      "index.mdx",
      "---\ntitle: Release notes\nfamily: deck\nlinks:\n  - rel: follows\n    artifact: art_01JB8Z3QF6S7W3N8D5K2C4V9XG\n---\n\n# Notes\n",
    );
    expect(manifest).toEqual({
      title: "Release notes",
      family: "deck",
      links: [{ rel: "follows", artifact: ID }],
    });
    expect(hasDefaultExport).toBe(true);
  });

  it("is optional, and invalid YAML or values are reported", () => {
    expect(extractManifest("page.mdx", "# Just Markdown\n").manifest).toBeUndefined();
    expect(failure("page.mdx", "---\ntitle: [unclosed\n---\n").code).toBe(
      "MOSTRA_MANIFEST_INVALID",
    );
    expect(failure("page.mdx", "---\ntitle: 42\n---\n").message).toContain("`title`");
  });
});
