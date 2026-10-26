/**
 * A bundle's files against its manifest (RT-01): one walk that both writes `files.json` (the
 * assembler) and checks an extracted bundle against it (setup), so the two can't disagree about
 * what counts. Links must stay inside the bundle; nothing may be missing, changed or extra.
 *
 * On Windows (D153) a link is read as the relative, `/`-separated path from its directory to its
 * target, whether it is a symbolic link (`..\\x`, as pnpm makes them for an administrator) or a
 * junction (an absolute target, as setup makes them for everyone), so `files.json` reads the same
 * on every system; and no file is executable, since Windows keeps no execute bit (D150 item 8).
 */
import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BundleFileEntry, BundleFiles, BundleLinkEntry } from "@mostra/protocol";

/** Whether this process runs on Windows, whose links and modes the walk reads its own way. */
const WINDOWS = process.platform === "win32";

/**
 * A link's target as the manifest spells it: relative to the link's directory, `/`-separated.
 * POSIX targets are kept exactly as written; a Windows junction's absolute target, and a Windows
 * symbolic link's `\\`-separated one, are rewritten into that form.
 */
export function linkTarget(root: string, path: string, written: string): string {
  if (!WINDOWS) return written;
  // A junction's target may carry the `\\?\` prefix of Windows' own namespace.
  const plain = written.startsWith("\\\\?\\") ? written.slice(4) : written;
  if (!isAbsolute(plain)) return plain.split(sep).join("/");
  // A junction stores an absolute path, spelled as whoever made it spelled the bundle's root:
  // setup uses the real path, while `root` may be another spelling of it (an 8.3 short name such
  // as `RUNNER~1`, another case). Each spelling of the link's directory is tried against the
  // same spelling of the root, so neither reads as a detour out of the bundle; Windows compares
  // without case.
  const given = resolve(root);
  const dir = dirname(join(given, path));
  const spellings: [string, string][] = [[given, dir]];
  try {
    const realRoot = realpathSync.native(given);
    spellings.push([realRoot, join(realRoot, relative(given, dir))]);
  } catch {
    // A root that doesn't exist holds no junction; the lexical form reports the mismatch.
  }
  const lower = plain.toLowerCase();
  for (const [base, from] of spellings) {
    if (lower === base.toLowerCase() || lower.startsWith(`${base.toLowerCase()}${sep}`))
      return relative(from, plain).split(sep).join("/");
  }
  return relative(dir, plain).split(sep).join("/");
}

/** The SHA-256 and size of one file, read as a stream. */
export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size };
}

/** One entry of a walk: a regular file or a link, by `/`-separated path from the root. */
type Walked =
  | { readonly kind: "file"; readonly path: string; readonly executable: boolean }
  | { readonly kind: "link"; readonly path: string; readonly target: string }
  | { readonly kind: "other"; readonly path: string };

/** Every file and link under `root`, sorted by path, skipping `exclude`d paths (and below). */
async function walk(root: string, exclude: (path: string) => boolean): Promise<Walked[]> {
  const out: Walked[] = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (exclude(path)) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isSymbolicLink()) {
        const written = await readlink(join(root, path));
        out.push({ kind: "link", path, target: linkTarget(root, path, written) });
      } else if (entry.isFile()) {
        // Windows keeps no execute bit: Node.js reports one there for every file it can read.
        const executable = WINDOWS ? false : ((await lstat(join(root, path))).mode & 0o100) !== 0;
        out.push({ kind: "file", path, executable });
      } else out.push({ kind: "other", path });
    }
  };
  await visit("");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Runs `task` over `items`, at most `limit` at a time, keeping the order of results. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Whether a link's target is relative and resolves inside `root`. */
export function linkStaysInside(root: string, path: string, target: string): boolean {
  if (isAbsolute(target) || /[\\:\0]/.test(target)) return false;
  const base = resolve(root);
  const resolved = resolve(base, dirname(path), target);
  return resolved === base || resolved.startsWith(base + sep);
}

/** Whether a manifest path is a plain relative path: no absolute start, no `.` or `..` segment. */
export function safeRelative(path: string): boolean {
  if (path === "" || isAbsolute(path) || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The manifest of the tree under `root`: every regular file with its SHA-256, size and execute
 * bit, every link with its target. Throws on anything else (a device, a socket, a link leaving
 * the tree), which a bundle must never contain.
 */
export async function describeTree(
  root: string,
  exclude: (path: string) => boolean = () => false,
): Promise<BundleFiles> {
  const walked = await walk(root, exclude);
  const files: BundleFileEntry[] = [];
  const links: BundleLinkEntry[] = [];
  const regular = walked.filter((entry) => entry.kind === "file");
  const hashed = await mapLimit(regular, 32, (entry) => hashFile(join(root, entry.path)));
  regular.forEach((entry, index) => {
    const { sha256, size } = hashed[index] as { sha256: string; size: number };
    files.push({ path: entry.path, size, sha256, executable: entry.executable });
  });
  for (const entry of walked) {
    if (entry.kind === "other") throw new Error(`${entry.path} is neither a file nor a link.`);
    if (entry.kind !== "link") continue;
    if (!linkStaysInside(root, entry.path, entry.target))
      throw new Error(`${entry.path} links outside the tree (${entry.target}).`);
    links.push({ path: entry.path, target: entry.target });
  }
  return { schemaVersion: 1, files, links };
}

/** What a check found: an empty list means the tree matches. Paths are relative to the root. */
export type TreeProblems = readonly string[];

/**
 * Checks the tree under `root` against `manifest`: each listed file present, regular, with its
 * size, SHA-256 and execute bit; each link present with its target, staying inside; and nothing
 * else besides what `allowExtra` accepts. Reports at most `limit` problems.
 */
export async function checkTree(
  root: string,
  manifest: BundleFiles,
  options: {
    readonly allowExtra?: (path: string) => boolean;
    readonly limit?: number;
    /**
     * Whether the links are checked; `false` checks the files alone and lets each listed link be
     * there or not, for a Windows bundle whose junctions setup makes after a rename (D153).
     */
    readonly links?: boolean;
  } = {},
): Promise<TreeProblems> {
  const limit = options.limit ?? 20;
  const allowExtra = options.allowExtra ?? (() => false);
  const checkLinks = options.links ?? true;
  const problems: string[] = [];
  const add = (problem: string): void => {
    if (problems.length < limit) problems.push(problem);
  };
  const expectedFiles = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const expectedLinks = new Map(manifest.links.map((entry) => [entry.path, entry]));
  for (const path of [...expectedFiles.keys(), ...expectedLinks.keys()]) {
    if (!safeRelative(path)) add(`${path}: not a plain relative path`);
  }
  if (problems.length > 0) return problems;
  // An allowed extra is skipped whole unless something listed lies at or below it.
  const listedDirs = new Set<string>();
  for (const path of [...expectedFiles.keys(), ...expectedLinks.keys()]) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++)
      listedDirs.add(segments.slice(0, index).join("/"));
  }
  const walked = await walk(
    root,
    (path) =>
      allowExtra(path) &&
      !expectedFiles.has(path) &&
      !expectedLinks.has(path) &&
      !listedDirs.has(path),
  );
  const found = new Map(walked.map((entry) => [entry.path, entry]));
  for (const entry of walked) {
    if (!expectedFiles.has(entry.path) && !expectedLinks.has(entry.path)) {
      if (!allowExtra(entry.path)) add(`${entry.path}: not in the bundle's file list`);
    }
  }
  for (const [path, link] of checkLinks ? expectedLinks : new Map<string, BundleLinkEntry>()) {
    const actual = found.get(path);
    if (actual?.kind !== "link") add(`${path}: missing link`);
    else if (actual.target !== link.target)
      add(`${path}: links to ${actual.target}, not ${link.target}`);
    else if (!linkStaysInside(root, path, link.target)) add(`${path}: links outside the bundle`);
  }
  const files = [...expectedFiles.values()];
  const results = await mapLimit(files, 32, async (entry) => {
    const actual = found.get(entry.path);
    if (actual?.kind !== "file") return `${entry.path}: missing file`;
    if (actual.executable !== entry.executable)
      return `${entry.path}: ${entry.executable ? "not executable" : "executable"}`;
    const { sha256, size } = await hashFile(join(root, entry.path));
    if (size !== entry.size) return `${entry.path}: ${size} bytes, not ${entry.size}`;
    if (sha256 !== entry.sha256) return `${entry.path}: its SHA-256 differs`;
    return undefined;
  });
  for (const result of results) if (result !== undefined) add(result);
  return problems;
}
