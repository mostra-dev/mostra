/**
 * `artifact_patch`'s edits (D164): exact text replacements, or a unified diff of one or more
 * files, planned against the files as they are now. A patch applies whole or not at all: when any
 * edit or hunk doesn't apply, nothing is written and every one that didn't is named with why, so
 * the agent can read the file again and send a patch that fits.
 */
import { applyPatch, parsePatch, type StructuredPatch } from "diff";

/** One exact replacement: `old` must appear exactly once in the file. */
export interface TextEdit {
  /** Text that appears exactly once in the file; empty to write a new or empty file. */
  readonly old: string;
  /** What replaces it. */
  readonly new: string;
}

/** What `artifact_patch` asks for. */
export type PatchRequest =
  | { readonly path: string; readonly edits: readonly TextEdit[] }
  | { readonly path?: string; readonly diff: string };

/** One edit or hunk that didn't apply. */
export interface PatchRejection {
  /** The file it was for. */
  readonly path: string;
  /** The edit's index in `edits`, from 0. */
  readonly edit?: number;
  /** The hunk's index in its file's diff, from 0, and its header (`@@ -4,6 +4,7 @@`). */
  readonly hunk?: number;
  /** The hunk's header, for a hunk. */
  readonly header?: string;
  /**
   * Why: `not-found` (the text isn't in the file), `ambiguous` (it is, more than once),
   * `missing` (the file doesn't exist), `exists` (a diff creates a file that already exists),
   * `context` (the hunk's lines don't match the file), `binary` (the file isn't UTF-8 text),
   * `malformed` (the diff can't be read, or names no file).
   */
  readonly reason:
    | "not-found"
    | "ambiguous"
    | "missing"
    | "exists"
    | "context"
    | "binary"
    | "malformed";
  /** For `ambiguous`: how many times the text appears. */
  readonly occurrences?: number;
}

/** The planned change: whole files to write and files to delete. */
export interface PlannedPatch {
  /** Files to write whole, by path inside the artifact. */
  readonly write: readonly { readonly path: string; readonly content: string }[];
  /** Files to delete. */
  readonly delete: readonly string[];
}

/** Reads a file of the artifact as bytes, `undefined` when missing. */
export type ReadFile = (path: string) => Promise<Uint8Array | undefined>;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Plans a patch against the current files: the change, or every rejection. */
export async function planPatch(
  request: PatchRequest,
  read: ReadFile,
): Promise<
  | { readonly ok: true; readonly change: PlannedPatch }
  | { readonly ok: false; readonly rejected: PatchRejection[] }
> {
  return "edits" in request
    ? planEdits(request.path, request.edits, read)
    : planDiff(request, read);
}

/** The file's text: missing, binary, or its content. */
async function readText(
  path: string,
  read: ReadFile,
): Promise<
  | { readonly kind: "missing" }
  | { readonly kind: "binary" }
  | { readonly kind: "text"; readonly text: string }
> {
  const bytes = await read(path);
  if (bytes === undefined) return { kind: "missing" };
  try {
    return { kind: "text", text: utf8.decode(bytes) };
  } catch {
    return { kind: "binary" };
  }
}

/** How many times `needle` appears in `text`, counting overlapping matches. */
function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) count++;
  return count;
}

async function planEdits(path: string, edits: readonly TextEdit[], read: ReadFile) {
  const file = await readText(path, read);
  if (file.kind === "binary")
    return { ok: false as const, rejected: [{ path, reason: "binary" as const }] };
  // An edit with an empty `old` writes a new (or empty) file: the one way to create a file here.
  if (file.kind === "missing" || file.text === "") {
    if (edits.length === 1 && edits[0]?.old === "") {
      return {
        ok: true as const,
        change: { write: [{ path, content: edits[0].new }], delete: [] },
      };
    }
    if (file.kind === "missing")
      return { ok: false as const, rejected: [{ path, reason: "missing" as const }] };
  }
  let text = file.kind === "text" ? file.text : "";
  const rejected: PatchRejection[] = [];
  for (const [index, edit] of edits.entries()) {
    const count = edit.old === "" ? 0 : occurrences(text, edit.old);
    if (count === 1) text = text.replace(edit.old, () => edit.new);
    else if (count === 0) rejected.push({ path, edit: index, reason: "not-found" });
    else rejected.push({ path, edit: index, reason: "ambiguous", occurrences: count });
  }
  return rejected.length > 0
    ? { ok: false as const, rejected }
    : { ok: true as const, change: { write: [{ path, content: text }], delete: [] } };
}

const NULL_FILE = /^(\/dev\/null|nul)$/i;

/** A diff header's file name without its `a/` or `b/` prefix and any timestamp. */
function headerPath(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const plain = name.split("\t")[0]?.trim() ?? "";
  if (plain === "" || NULL_FILE.test(plain)) return undefined;
  return plain.replace(/^[ab]\//, "");
}

function hunkHeader(hunk: StructuredPatch["hunks"][number]): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

async function planDiff(
  request: { readonly path?: string; readonly diff: string },
  read: ReadFile,
) {
  const where = request.path ?? "(diff)";
  let patches: StructuredPatch[];
  try {
    patches = parsePatch(request.diff).filter((patch) => patch.hunks.length > 0 || patch.isRename);
  } catch {
    return { ok: false as const, rejected: [{ path: where, reason: "malformed" as const }] };
  }
  if (patches.length === 0)
    return { ok: false as const, rejected: [{ path: where, reason: "malformed" as const }] };
  const write: { path: string; content: string }[] = [];
  const remove: string[] = [];
  const rejected: PatchRejection[] = [];
  for (const patch of patches) {
    const from = headerPath(patch.oldFileName);
    const to = headerPath(patch.newFileName);
    const creates =
      patch.oldFileName !== undefined &&
      from === undefined &&
      NULL_FILE.test(patch.oldFileName.split("\t")[0]?.trim() ?? "");
    const deletes =
      patch.newFileName !== undefined &&
      to === undefined &&
      NULL_FILE.test(patch.newFileName.split("\t")[0]?.trim() ?? "");
    // One file and a path given: the path wins over the headers (a diff made elsewhere).
    const path = patches.length === 1 && request.path !== undefined ? request.path : (to ?? from);
    if (path === undefined) {
      rejected.push({ path: where, reason: "malformed" });
      continue;
    }
    const source = from !== undefined && from !== path && patch.isRename ? from : path;
    const file = await readText(source, read);
    if (file.kind === "binary") {
      rejected.push({ path, reason: "binary" });
      continue;
    }
    if (creates && file.kind === "text") {
      rejected.push({ path, reason: "exists" });
      continue;
    }
    if (!creates && file.kind === "missing") {
      rejected.push({ path: source, reason: "missing" });
      continue;
    }
    const text = file.kind === "text" ? file.text : "";
    const result = patch.hunks.length === 0 ? text : applyPatch(text, patch);
    if (result === false) {
      // Name each hunk that doesn't fit the file on its own; when each fits alone, they clash.
      const alone = patch.hunks.map(
        (hunk) => applyPatch(text, { ...patch, hunks: [hunk] }) !== false,
      );
      for (const [index, hunk] of patch.hunks.entries()) {
        if (!alone[index] || alone.every(Boolean)) {
          rejected.push({ path, hunk: index, header: hunkHeader(hunk), reason: "context" });
        }
      }
      continue;
    }
    if (deletes) remove.push(source);
    else {
      write.push({ path, content: result });
      if (source !== path) remove.push(source);
    }
  }
  return rejected.length > 0
    ? { ok: false as const, rejected }
    : { ok: true as const, change: { write, delete: remove } };
}
