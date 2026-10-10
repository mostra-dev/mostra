#!/usr/bin/env node
/**
 * Generated diagnostic references (AX-03): the catalog JSON and one docs page per code, rendered
 * from the catalog in `@mostra/protocol` (one source file per area). The docs site (WP-26)
 * renders the pages at `${docsBase}/errors/<CODE>`.
 *
 *   node tools/docs/diagnostics.ts write   regenerate docs/reference/
 *   node tools/docs/diagnostics.ts check   fail when the references are stale, a code lacks docs
 *                                          text, or a code that the base had is gone
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, fromRoot, mergeBase, readAtRevision } from "../lib/repo.ts";

/** The shape of `@mostra/protocol`'s `DiagnosticSpec` that the references use. */
interface Spec {
  readonly severity: string;
  readonly phase: string;
  readonly title: string;
  readonly hint: string;
  readonly docs: { readonly explanation: string; readonly fix: string };
  readonly deprecated?: string;
}

// Loaded from source (Node strips the types), so the references never need a build.
const { diagnosticCatalog } = (await import(
  pathToFileURL(fromRoot("packages/protocol/src/index.ts")).href
)) as { diagnosticCatalog: Readonly<Record<string, Spec>> };

const OUT = "docs/reference";
const CATALOG = `${OUT}/diagnostics.json`;
const PAGES = `${OUT}/errors`;

/** One catalog entry as published. */
interface Entry {
  readonly code: string;
  readonly severity: string;
  readonly phase: string;
  readonly title: string;
  readonly hint: string;
  readonly explanation: string;
  readonly fix: string;
  readonly deprecated?: string;
}

/** The catalog as published, sorted by code. */
export function entries(): Entry[] {
  return Object.entries(diagnosticCatalog)
    .map(([code, spec]) => ({
      code,
      severity: spec.severity,
      phase: spec.phase,
      title: spec.title,
      hint: spec.hint,
      explanation: spec.docs.explanation,
      fix: spec.docs.fix,
      ...(spec.deprecated ? { deprecated: spec.deprecated } : {}),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** The docs page for one code. */
export function renderPage(entry: Entry): string {
  return [
    "---",
    `code: ${entry.code}`,
    `severity: ${entry.severity}`,
    `phase: ${entry.phase}`,
    "---",
    "",
    "<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->",
    "",
    `# ${entry.code}`,
    "",
    `${entry.title}. Severity: ${entry.severity}. Phase: ${entry.phase}.`,
    ...(entry.deprecated ? ["", `**Deprecated.** ${entry.deprecated}`] : []),
    "",
    "## What it means",
    "",
    entry.explanation,
    "",
    "## How to fix it",
    "",
    entry.fix,
    "",
    "## Hint",
    "",
    entry.hint,
    "",
  ].join("\n");
}

function renderCatalog(all: readonly Entry[]): string {
  return `${JSON.stringify({ codes: all }, null, 2)}\n`;
}

/** Codes without complete docs text. */
export function missingText(all: readonly Entry[]): string[] {
  const problems: string[] = [];
  for (const entry of all) {
    for (const field of ["title", "hint", "explanation", "fix"] as const) {
      const text = entry[field].trim();
      if (text === "" || /\bTODO\b/.test(text))
        problems.push(`${entry.code} has no ${field} text.`);
    }
  }
  return problems;
}

/** Codes the base catalog had that the current one lacks (codes are never removed, AX-03). */
export function removedCodes(baseCatalog: string | undefined, all: readonly Entry[]): string[] {
  if (baseCatalog === undefined) return [];
  const before = (JSON.parse(baseCatalog) as { codes: { code: string }[] }).codes.map(
    (entry) => entry.code,
  );
  const now = new Set(all.map((entry) => entry.code));
  return before
    .filter((code) => !now.has(code))
    .map(
      (code) =>
        `${code} was removed. Codes are semver surface: mark it deprecated instead (AX-03).`,
    );
}

function main(): void {
  const mode = process.argv[2];
  const all = entries();
  const expected = new Map<string, string>([[CATALOG, renderCatalog(all)]]);
  for (const entry of all) expected.set(`${PAGES}/${entry.code}.md`, renderPage(entry));

  if (mode === "write") {
    rmSync(fromRoot(PAGES), { recursive: true, force: true });
    mkdirSync(fromRoot(PAGES), { recursive: true });
    for (const [path, text] of expected) writeFileSync(fromRoot(path), text);
    console.log(`✓ wrote ${all.length} diagnostic pages and ${CATALOG}`);
    return;
  }
  if (mode !== "check") {
    console.error("usage: diagnostics.ts <write|check>");
    process.exit(2);
  }
  const problems = [...missingText(all)];
  const base = mergeBase();
  if (base) problems.push(...removedCodes(readAtRevision(base, CATALOG), all));
  for (const [path, text] of expected) {
    const current = existsSync(fromRoot(path)) ? readFileSync(fromRoot(path), "utf8") : undefined;
    if (current !== text)
      problems.push(`${path} is stale. Run \`node tools/docs/diagnostics.ts write\`.`);
  }
  if (existsSync(fromRoot(PAGES))) {
    for (const file of readdirSync(fromRoot(PAGES))) {
      if (!expected.has(join(PAGES, file)))
        problems.push(`${PAGES}/${file} has no code in the catalog.`);
    }
  }
  if (problems.length > 0) fail(problems, "diagnostic catalog");
  console.log(`✓ diagnostic catalog: ${all.length} codes, each with docs text and a current page`);
}

if (import.meta.main) main();
