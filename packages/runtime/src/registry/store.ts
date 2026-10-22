/**
 * The content-addressed version store on disk (DATA_MODEL §1, FAILURE_MODEL §3): `versions/<id>/`
 * and `sources/<artifactId>/<sourceDigest>.tar.zst`. A version directory is assembled in staging,
 * synced and made read-only (`platform`: modes on POSIX, an access list on Windows), then renamed
 * into place; it becomes visible only when its ledger row
 * commits, and anything without a row is removed at the next start.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fsyncPath, removeTree, renamePath, sealPlaced, sealTree } from "../platform/index.ts";

export { fsyncPath, removeTree, sealTree };

/** The version store of one home. */
export interface VersionStore {
  readonly versionsDir: string;
  readonly sourcesDir: string;
  /** Where staging directories live (`cache/staging`), on the same file system as `versions/`. */
  readonly stagingDir: string;
  versionDir(versionId: string): string;
  snapshotPath(artifactId: string, sourceDigest: string): string;
  /** Seals `built` and renames it to `versions/<versionId>`, replacing a leftover without a row. */
  promote(built: string, versionId: string): Promise<void>;
  /** Removes staging, and version directories and snapshots no ledger row names. */
  sweep(known: {
    readonly versions: ReadonlySet<string>;
    readonly snapshots: ReadonlySet<string>;
  }): Promise<{ readonly versions: string[]; readonly snapshots: string[] }>;
}

/** Opens the version store of the home at `home`, creating its directories. */
export async function openVersionStore(home: string): Promise<VersionStore> {
  const versionsDir = join(home, "versions");
  const sourcesDir = join(home, "sources");
  const stagingDir = join(home, "cache", "staging");
  for (const dir of [versionsDir, sourcesDir, stagingDir])
    await mkdir(dir, { recursive: true, mode: 0o700 });
  const versionDir = (versionId: string): string => join(versionsDir, versionId);
  return {
    versionsDir,
    sourcesDir,
    stagingDir,
    versionDir,
    snapshotPath: (artifactId, sourceDigest) =>
      join(sourcesDir, artifactId, `${sourceDigest}.tar.zst`),
    async promote(built, versionId) {
      await sealTree(built, true);
      const target = versionDir(versionId);
      // A directory without a ledger row is a leftover of an interrupted publish (FAILURE_MODEL §3).
      await removeTree(target);
      await renamePath(built, target);
      await sealPlaced(target);
      fsyncPath(versionsDir, true);
    },
    async sweep(known) {
      const removed = { versions: [] as string[], snapshots: [] as string[] };
      await removeTree(stagingDir);
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      for (const name of await readdir(versionsDir)) {
        if (!known.versions.has(name)) {
          await removeTree(join(versionsDir, name));
          removed.versions.push(name);
        }
      }
      for (const artifact of await readdir(sourcesDir)) {
        const dir = join(sourcesDir, artifact);
        if (!(await stat(dir)).isDirectory()) continue;
        for (const name of await readdir(dir)) {
          if (!known.snapshots.has(`${artifact}/${name}`)) {
            await rm(join(dir, name), { force: true });
            removed.snapshots.push(`${artifact}/${name}`);
          }
        }
      }
      return removed;
    },
  };
}
