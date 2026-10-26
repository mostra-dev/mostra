/**
 * A Windows bundle's links (D153). An ordinary Windows user can't create symbolic links (that
 * takes an administrator or Developer Mode), so a Windows archive holds none: its `files.json`
 * lists each link, every one to a directory inside the bundle, and setup makes each a junction,
 * which any user can create. A junction names its target by absolute path, so it is made at the
 * bundle's real path, and a bundle moved since is set up again (`readSetup` compares the root
 * its marker names).
 *
 * Nothing outside the bundle is ever touched: a listed link's path and target must stay inside
 * it, every directory above a link must be a real directory (never a link), the target must be a
 * directory, and what already sits at a link's path is replaced only when it is itself a link, or
 * a real directory holding exactly the files and bytes of the link's target. That is what a copy
 * made by a tool that follows junctions leaves (Explorer, `Copy-Item`, `robocopy` without `/SJ`,
 * and a move to another drive, which is a copy), so such a copy is set up again; a directory
 * holding anything else is refused and kept (Opus review of WP-W3, finding 4).
 *
 * Two setups of one bundle may run at once (a moved bundle met by two commands): each step
 * tolerates the other's, and a link counts as made once it names its target, whoever made it
 * (finding 5).
 */
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BundleFiles, BundleLinkEntry } from "@mostra/protocol";
import { hashFile, linkStaysInside, linkTarget, realOrNone, safeRelative } from "./tree.ts";

/** Why a link couldn't be made; the caller reports it as `MOSTRA_ENV_BUNDLE_INVALID`. */
export class LinkRefused extends Error {}

/** Whether `path` (an absolute path inside `root`) has only real directories above it. */
async function realParents(root: string, path: string): Promise<boolean> {
  let dir = dirname(path);
  const chain: string[] = [];
  while (dir.length > root.length) {
    chain.unshift(dir);
    dir = dirname(dir);
  }
  for (const parent of chain) {
    const info = await lstat(parent).catch(() => undefined);
    if (info === undefined) {
      await mkdir(parent);
      continue;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
  }
  return true;
}

/**
 * Makes every link `manifest` lists as a junction under `root`, which must be the bundle's real
 * path (`realpath.native`). A link that already names its target is kept; one that names another
 * (the bundle moved) is replaced. Throws {@link LinkRefused} for a link the manifest can't have.
 */
export async function makeJunctions(root: string, manifest: BundleFiles): Promise<void> {
  // A link's target may lie behind another link (`node_modules/x` through a scope's link), so a
  // link whose target isn't there yet waits for the next round; a round that makes nothing ends.
  const realRoot = realOrNone(root);
  let waiting = [...manifest.links].sort((a, b) => a.path.length - b.path.length);
  while (waiting.length > 0) {
    const later: typeof waiting = [];
    for (const link of waiting) {
      if (!(await makeJunction(root, link, realRoot))) later.push(link);
    }
    if (later.length === waiting.length) {
      const first = later[0] as BundleLinkEntry;
      throw new LinkRefused(`${first.path} links to ${first.target}, which is no directory.`);
    }
    waiting = later;
  }
}

/** Makes one link; `false` when its target isn't a directory (yet). */
async function makeJunction(
  root: string,
  link: BundleLinkEntry,
  realRoot: string | undefined,
): Promise<boolean> {
  if (!safeRelative(link.path) || !linkStaysInside(root, link.path, link.target)) {
    throw new LinkRefused(`${link.path} links outside the bundle (${link.target}).`);
  }
  const at = join(root, link.path);
  const target = resolve(dirname(at), link.target);
  if (!(await realParents(root, at))) {
    throw new LinkRefused(`${link.path} sits below a link or a file.`);
  }
  if (await names(root, link, at, realRoot)) return true;
  const kind = await stat(target).catch(() => undefined);
  if (kind === undefined || !kind.isDirectory()) return false;
  const current = await lstat(at).catch(() => undefined);
  if (current !== undefined && !current.isSymbolicLink()) {
    if (!current.isDirectory() || !(await sameTree(at, target))) {
      throw new LinkRefused(
        `${link.path} is a file or directory where the bundle has a link, and it isn't a copy of ${link.target}.`,
      );
    }
  }
  try {
    if (current?.isSymbolicLink()) {
      // A junction is a directory to Windows: `rmdir` removes the link, never what it names.
      await rmdir(at).catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? undefined : unlink(at),
      );
    } else if (current !== undefined) {
      // A copy of the target: no link inside it (`sameTree` refuses one), so nothing outside it.
      await rm(at, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    await symlink(target, at, "junction");
  } catch (error) {
    // Another setup of this bundle made it meanwhile.
    if (await names(root, link, at, realRoot)) return true;
    throw new LinkRefused(
      `${link.path} couldn't be made as a junction to ${link.target}: ${(error as Error).message}`,
    );
  }
  if (!(await names(root, link, at, realRoot))) {
    throw new LinkRefused(`${link.path} couldn't be made as a junction to ${link.target}.`);
  }
  return true;
}

/** Whether the link at `at` exists and names the manifest's target. */
async function names(
  root: string,
  link: BundleLinkEntry,
  at: string,
  realRoot: string | undefined,
): Promise<boolean> {
  const info = await lstat(at).catch(() => undefined);
  if (info === undefined || !info.isSymbolicLink()) return false;
  const written = await readlink(at).catch(() => undefined);
  return written !== undefined && linkTarget(root, link.path, written, realRoot) === link.target;
}

/**
 * Whether the real directory `copy` holds exactly what `original` holds: the same names, files of
 * the same bytes, and directories alike all the way down. A link anywhere in the copy, or an entry
 * of any other kind, makes it no copy.
 */
async function sameTree(copy: string, original: string): Promise<boolean> {
  const [mine, theirs] = await Promise.all([
    readdir(copy, { withFileTypes: true }).catch(() => undefined),
    readdir(original, { withFileTypes: true }).catch(() => undefined),
  ]);
  if (mine === undefined || theirs === undefined || mine.length !== theirs.length) return false;
  const byName = new Map(theirs.map((entry) => [entry.name, entry]));
  for (const entry of mine) {
    const other = byName.get(entry.name);
    if (other === undefined || entry.isSymbolicLink()) return false;
    const a = join(copy, entry.name);
    const b = join(original, entry.name);
    if (entry.isDirectory()) {
      // The original may reach a directory through a link (a junction made a moment ago).
      if (!(await stat(b).catch(() => undefined))?.isDirectory()) return false;
      if (!(await sameTree(a, b))) return false;
    } else if (entry.isFile()) {
      if (!(other.isFile() || other.isSymbolicLink()) || !(await sameBytes(a, b))) return false;
    } else return false;
  }
  return true;
}

/** Whether two files hold the same bytes (streamed, so a large program isn't held in memory). */
async function sameBytes(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a), stat(b)]).catch(() => [undefined, undefined]);
  if (sa === undefined || sb === undefined || !sb.isFile() || sa.size !== sb.size) return false;
  const [ha, hb] = await Promise.all([hashFile(a), hashFile(b)]);
  return ha.sha256 === hb.sha256;
}
