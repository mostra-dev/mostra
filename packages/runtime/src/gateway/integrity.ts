/**
 * Integrity of served versions (FAILURE_MODEL §3: reads verify content). Before a version's
 * files are served, its stored tree is checked once against the output digest its manifest
 * records, and the change time of every file is remembered. A file served later whose change time
 * differs (any write or `chmod` changes it) makes the whole version checked again, so a version
 * altered while the gateway runs is refused from the next request on, not after a restart.
 */
import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "../log.ts";
import type { FoundFile } from "./serve.ts";

/**
 * How long a damaged version's verdict is kept before its files are hashed again, unless its
 * directory was replaced (a republish rebuilds it in place, D98 and WP-03).
 */
const DAMAGE_TTL_MS = 10_000;

/** What the integrity checks need to know about versions. */
export interface VersionStore {
  /** The directory of a published version (`versions/<id>`). */
  versionDir(versionId: string): string;
  /** What is wrong with a version's stored files, or `undefined` when they match their digest. */
  damage(versionId: string): Promise<string | undefined>;
}

/** The checks of one gateway. */
export interface VersionIntegrity {
  /** The version's damage, or `undefined` when its stored files match their digest. */
  check(versionId: string): Promise<string | undefined>;
  /**
   * Whether `file`, found in the version's `client/` tree, may be served: `undefined` when it may,
   * else what is wrong. A file whose change time differs from the last check checks the version
   * again.
   */
  serve(versionId: string, file: FoundFile): Promise<string | undefined>;
}

/** The change time of every file under `root`, by real path. */
async function changeTimes(root: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  const real = await realpath(root);
  for (const entry of await readdir(real, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const path = await realpath(join(entry.parentPath, entry.name));
    const info = await stat(path);
    if (info.isFile()) times.set(path, info.ctimeMs);
  }
  return times;
}

/** Creates the integrity checks of one gateway. */
export function versionIntegrity(store: VersionStore, log: Log): VersionIntegrity {
  const verified = new Map<string, Map<string, number>>();
  const damaged = new Map<
    string,
    { readonly damage: string; readonly until: number; readonly dir: string }
  >();
  /** The identity of a version's directory: a rebuild puts a new one in place. */
  const dirIdentity = async (versionId: string): Promise<string> => {
    try {
      const info = await stat(store.versionDir(versionId));
      return `${info.ino}:${info.ctimeMs}`;
    } catch {
      return "missing";
    }
  };
  const running = new Map<string, Promise<string | undefined>>();

  const check = (versionId: string): Promise<string | undefined> => {
    if (verified.has(versionId)) return Promise.resolve(undefined);
    const pending = running.get(versionId);
    if (pending) return pending;
    const started = (async () => {
      const dir = await dirIdentity(versionId);
      const known = damaged.get(versionId);
      if (known && known.until > Date.now() && known.dir === dir) return known.damage;
      // Change times first: a write between them and the hashing is caught by the hashing, and
      // a write after it by the change time.
      let times: Map<string, number>;
      try {
        times = await changeTimes(join(store.versionDir(versionId), "client"));
      } catch (error) {
        times = new Map();
        log.warn("gateway.version_unreadable", {
          versionId,
          code: (error as NodeJS.ErrnoException).code,
        });
      }
      const damage = await store.damage(versionId);
      if (damage !== undefined) {
        log.error("gateway.version_damaged", { versionId, damage });
        damaged.set(versionId, { damage, until: Date.now() + DAMAGE_TTL_MS, dir });
        return damage;
      }
      damaged.delete(versionId);
      verified.set(versionId, times);
      return undefined;
    })().finally(() => running.delete(versionId));
    running.set(versionId, started);
    return started;
  };

  return {
    check,
    async serve(versionId, file) {
      if (verified.get(versionId)?.get(file.path) === file.ctimeMs) return undefined;
      // First sight of this file, or it changed since the check: check the version again.
      verified.delete(versionId);
      const damage = await check(versionId);
      if (damage !== undefined) return damage;
      return verified.get(versionId)?.get(file.path) === file.ctimeMs
        ? undefined
        : "a file changed while the version was checked";
    },
  };
}
