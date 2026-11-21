/**
 * `mostra verify --fix` writes a verdict's fixes only into the artifact's own files (KT-08): never
 * a file a fix names outside it, and never through a link inside it that leads out.
 */
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifyVerdict } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { applyVerdictFixes } from "../../src/commands/authoring.ts";

function verdictFor(path: string, files: readonly string[]): VerifyVerdict {
  return {
    status: "pass",
    artifact: { path, sourceDigest: "s", envDigest: "e" },
    diagnostics: files.map((file) => ({
      code: "MOSTRA_LINT_API_CHANGED",
      severity: "warning",
      message: "x",
      phase: "lint",
      docs: "https://example.com",
      fix: { kind: "replace", file, range: [1, 1, 1, 4], text: "new" },
    })),
    screenshots: [],
    aria: [],
    smoke: { interactions: 0, skippedActions: [], stateChanges: 0 },
    regressions: {},
    timingsMs: {},
  } as unknown as VerifyVerdict;
}

describe("verify --fix (KT-08)", () => {
  it("writes the artifact's own files and nothing a fix names outside it, through a link or not", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-fix-"));
    const artifact = join(root, "page");
    mkdirSync(artifact);
    writeFileSync(join(artifact, "index.tsx"), "old line\n");
    writeFileSync(join(root, "outside.tsx"), "old line\n");
    const linked = process.platform !== "win32";
    if (linked) symlinkSync(join(root, "outside.tsx"), join(artifact, "link.tsx"));
    const fixed = await applyVerdictFixes(
      verdictFor(artifact, ["index.tsx", "../outside.tsx", ...(linked ? ["link.tsx"] : [])]),
    );
    expect(fixed).toEqual([{ file: "index.tsx", fixes: 1 }]);
    expect(readFileSync(join(artifact, "index.tsx"), "utf8")).toBe("new line\n");
    expect(readFileSync(join(root, "outside.tsx"), "utf8")).toBe("old line\n");
  });
});
