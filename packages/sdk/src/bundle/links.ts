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
 * directory, and what already sits at a link's path is replaced only when it is itself a link.
 */
import { lstat, mkdir, readlink, rmdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BundleFiles, BundleLinkEntry } from "@mostra/protocol";
import { linkStaysInside, linkTarget, safeRelative } from "./tree.ts";

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
  let waiting = [...manifest.links].sort((a, b) => a.path.length - b.path.length);
  while (waiting.length > 0) {
    const later: typeof waiting = [];
    for (const link of waiting) {
      if (!(await makeJunction(root, link))) later.push(link);
    }
    if (later.length === waiting.length) {
      const first = later[0] as BundleLinkEntry;
      throw new LinkRefused(`${first.path} links to ${first.target}, which is no directory.`);
    }
    waiting = later;
  }
}

/** Makes one link; `false` when its target isn't a directory (yet). */
async function makeJunction(root: string, link: BundleLinkEntry): Promise<boolean> {
  if (!safeRelative(link.path) || !linkStaysInside(root, link.path, link.target)) {
    throw new LinkRefused(`${link.path} links outside the bundle (${link.target}).`);
  }
  const at = join(root, link.path);
  const target = resolve(dirname(at), link.target);
  if (!(await realParents(root, at))) {
    throw new LinkRefused(`${link.path} sits below a link or a file.`);
  }
  const current = await lstat(at).catch(() => undefined);
  if (current !== undefined) {
    if (!current.isSymbolicLink()) {
      throw new LinkRefused(`${link.path} is a file or directory where the bundle has a link.`);
    }
    if (linkTarget(root, link.path, await readlink(at)) === link.target) return true;
  }
  const kind = await stat(target).catch(() => undefined);
  if (kind === undefined || !kind.isDirectory()) return false;
  // A junction is a directory to Windows: `rmdir` removes the link, never what it names.
  if (current !== undefined) await rmdir(at).catch(() => unlink(at));
  await symlink(target, at, "junction");
  if (linkTarget(root, link.path, await readlink(at)) !== link.target) {
    throw new LinkRefused(`${link.path} couldn't be made as a junction to ${link.target}.`);
  }
  return true;
}
