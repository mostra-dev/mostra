/**
 * Applying machine-applicable fixes (`Diagnostic.fix`) to a file's text: what `mostra verify --fix`
 * does with the `replace`, `insert` and `delete` fixes verify reports (KT-08). Pure: the caller
 * reads and writes the files.
 */
import type { DiagnosticFix } from "./diagnostic.ts";

/** The offset of a 1-based line and column in `text`, or `undefined` when it isn't in it. */
function offsetOf(text: string, line: number, column: number): number | undefined {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return undefined;
    offset = next + 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  const length = (lineEnd === -1 ? text.length : lineEnd) - offset;
  // The end of a range may sit one past the line's last character, or at a line's start.
  if (column < 1 || column > length + 1) return undefined;
  return offset + column - 1;
}

/** What applying fixes to one file did. */
export interface AppliedFixes {
  /** The file's text with the fixes applied. */
  readonly text: string;
  /** How many fixes were applied. */
  readonly applied: number;
  /** Fixes left out: one overlapping another, or a range outside the text. */
  readonly skipped: number;
}

/**
 * Applies the text fixes of one file, from the end of the text to its start so earlier ranges keep
 * their places. A fix whose range overlaps one already applied, or lies outside the text, is
 * skipped (verify again to see what remains). `command` fixes are not text and are skipped.
 */
export function applyFixes(text: string, fixes: readonly DiagnosticFix[]): AppliedFixes {
  const edits: { start: number; end: number; text: string }[] = [];
  let skipped = 0;
  for (const fix of fixes) {
    if (fix.kind === "command" || fix.range === undefined) {
      skipped += 1;
      continue;
    }
    const [startLine, startColumn, endLine, endColumn] = fix.range;
    const start = offsetOf(text, startLine, startColumn);
    const end = fix.kind === "insert" ? start : offsetOf(text, endLine, endColumn);
    if (start === undefined || end === undefined || end < start) {
      skipped += 1;
      continue;
    }
    edits.push({ start, end, text: fix.kind === "delete" ? "" : (fix.text ?? "") });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let applied = 0;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    // Edits run from the end: one reaching into an edit already made overlaps it.
    if (edit.end > floor) {
      skipped += 1;
      continue;
    }
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
    applied += 1;
  }
  return { text: out, applied, skipped };
}
