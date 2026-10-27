/**
 * The local cache of runtime bundles (RT-01): one directory per archive digest, so a bundle is
 * found by what it is, not by what it's called. A bundle enters the cache only through
 * {@link installPinned}: downloaded against its pin, extracted into a temporary directory, its
 * files checked, renamed into place, its browser fetched, and only then marked ready. Concurrent
 * installers of one bundle share a lock, so it is downloaded once; a crash leaves a temporary
 * directory the next install removes, never a half-ready bundle.
 */
import { randomBytes } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  utimes,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import {
  type BundleAsset,
  BundleAsset as BundleAssetSchema,
  type BundlePins,
  type BundlePlatform,
  bundleAssetName,
  createDiagnostic,
  isWindowsBundle,
  RpcError,
} from "@mostra/protocol";
import { type DownloadProgress, download } from "./download.ts";
import { extractBundle } from "./extract.ts";
import {
  type Bundle,
  checkFiles,
  type Environment,
  offline,
  readBundle,
  readSetup,
  type SetupStep,
  setupBundle,
} from "./setup.ts";

/**
 * Where the cache is: `MOSTRA_CACHE_DIR`, else the platform's per-user cache directory:
 * `~/Library/Caches/mostra` on macOS, `%LOCALAPPDATA%\mostra-cache` on Windows (beside the home,
 * `%LOCALAPPDATA%\mostra`, as npm keeps `npm-cache`), `${XDG_CACHE_HOME:-~/.cache}/mostra` on
 * Linux.
 */
export function cacheRoot(env: Environment, platform: string = process.platform): string {
  const override = env["MOSTRA_CACHE_DIR"];
  if (override) return resolve(override);
  if (platform === "win32") {
    const local =
      env["LOCALAPPDATA"] || win32.join(env["USERPROFILE"] || homedir(), "AppData", "Local");
    return win32.join(local, "mostra-cache");
  }
  // POSIX paths, whatever system computes them (`platform` is the one the cache is for).
  const home = env["HOME"] || homedir();
  if (platform === "darwin") return posix.join(home, "Library", "Caches", "mostra");
  const xdg = env["XDG_CACHE_HOME"];
  return posix.join(xdg?.startsWith("/") ? xdg : posix.join(home, ".cache"), "mostra");
}

/** The directory a bundle with this archive digest lives in. */
export function bundleDir(env: Environment, sha256: string): string {
  return join(cacheRoot(env), "bundles", sha256);
}

/** What an install reports while it works. */
export type InstallProgress =
  | ({ readonly step: "download" } & DownloadProgress)
  | { readonly step: "extract" | "lock" }
  | { readonly step: SetupStep };

/** Options of {@link installPinned}. */
export interface InstallOptions {
  /** The environment: the cache, mirror and offline variables, proxies. */
  readonly env: Environment;
  /** The platform whose archive to install. */
  readonly platform: BundlePlatform;
  /** Gives up the install; nothing partial is kept. */
  readonly signal?: AbortSignal | undefined;
  /** Each step, and the bytes received while downloading. */
  readonly onProgress?: ((progress: InstallProgress) => void) | undefined;
}

/** The space an install needs beyond the archive and its files: the browser and some margin. */
const BROWSER_ALLOWANCE = 500 * 1024 * 1024;

/**
 * The pinned bundle for this platform, ready to run: from the cache when it is there and ready,
 * else installed. `MOSTRA_BUNDLE_MIRROR` replaces the release URL (files keep their names).
 */
export async function installPinned(pins: BundlePins, options: InstallOptions): Promise<Bundle> {
  const asset = pins.assets[options.platform];
  // Checked before any I/O: the asset's name becomes a path in the cache's scratch directory and
  // its digest the bundle's directory (Opus review finding 8), so the asset must be well-formed
  // and named exactly as its release's archive for this platform.
  if (
    asset !== undefined &&
    (!BundleAssetSchema.safeParse(asset).success ||
      asset.file !== bundleAssetName(pins.version, options.platform))
  ) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
        message: `The pins name ${JSON.stringify(asset.file)} for ${options.platform}, not Mostra ${pins.version}'s archive ${bundleAssetName(pins.version, options.platform)}.`,
      }),
    );
  }
  if (asset === undefined) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
        message: `Mostra ${pins.version} has no runtime bundle for ${options.platform}.`,
      }),
    );
  }
  const dir = bundleDir(options.env, asset.sha256);
  const ready = await readyAt(dir);
  if (ready) return ready;
  if (offline(options.env)) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
        message: `Mostra ${pins.version}'s runtime bundle isn't in the cache (${dir}), and MOSTRA_OFFLINE keeps Mostra from fetching it.`,
      }),
    );
  }
  const bundles = join(cacheRoot(options.env), "bundles");
  await mkdir(bundles, { recursive: true, mode: 0o700 });
  options.onProgress?.({ step: "lock" });
  const release = await lock(join(bundles, `${asset.sha256}.lock`), options.signal);
  try {
    const raced = await readyAt(dir);
    if (raced) return raced;
    await sweep(bundles);
    if (await exists(dir)) {
      // A bundle whose setup didn't finish (no network for the browser, a crash). Only its own
      // files decide whether it is downloaded afresh: a file that differs from the pins can't be
      // repaired in place, but the browser can be fetched again, and downloading 200 MB again
      // never changes what Playwright serves (Opus review finding 5). Anything else, such as a
      // permission error, is thrown: it says nothing about the bundle, so nothing is deleted.
      if (await filesIntact(dir)) return await finish(dir, { ...options, filesChecked: true });
      await rm(dir, { recursive: true, force: true });
    }
    await fetchInto(pins, asset, dir, bundles, options);
    return await finish(dir, { ...options, filesChecked: true });
  } finally {
    await release();
  }
}

/**
 * Whether the bundle at `dir` holds exactly what its `files.json` lists. `false` only for
 * `MOSTRA_ENV_BUNDLE_INVALID` (a missing or changed file, a `bundle.json` that doesn't read);
 * every other error is thrown.
 */
async function filesIntact(dir: string): Promise<boolean> {
  try {
    const bundle = await readBundle(dir);
    // A Windows bundle's junctions are made by setup, after this (D153).
    await checkFiles(bundle, { links: !isWindowsBundle(bundle.info.platform) });
    return true;
  } catch (error) {
    if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_ENV_BUNDLE_INVALID")
      return false;
    throw error;
  }
}

/** The bundle at `dir` when it exists and its setup marker matches it. */
async function readyAt(dir: string): Promise<Bundle | undefined> {
  const bundle = await readBundle(dir).catch(() => undefined);
  if (bundle === undefined) return undefined;
  return (await readSetup(bundle)) ? bundle : undefined;
}

async function finish(
  dir: string,
  options: InstallOptions & { readonly filesChecked?: boolean },
): Promise<Bundle> {
  await setupBundle(dir, {
    env: options.env,
    signal: options.signal,
    filesChecked: options.filesChecked,
    onStep: (step) => options.onProgress?.({ step }),
  });
  return readBundle(dir);
}

/** Downloads, extracts and checks the archive, then renames it into `dir`. */
async function fetchInto(
  pins: BundlePins,
  asset: BundleAsset,
  dir: string,
  bundles: string,
  options: InstallOptions,
): Promise<void> {
  await requireSpace(bundles, asset);
  const scratch = join(bundles, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  await mkdir(scratch, { mode: 0o700 });
  try {
    const archive = join(scratch, asset.file);
    const base = options.env["MOSTRA_BUNDLE_MIRROR"] || pins.release;
    const url = `${withoutTrailingSlashes(base)}/${encodeURIComponent(asset.file)}`;
    await download(url, archive, asset, {
      env: options.env,
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.({ step: "download", ...progress }),
    });
    options.onProgress?.({ step: "extract" });
    const root = join(scratch, "root");
    await mkdir(root);
    const top = asset.file.replace(/\.tar\.gz$/, "");
    if (top !== bundleAssetName(pins.version, options.platform).replace(/\.tar\.gz$/, "")) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
          message: `The pinned archive ${asset.file} isn't Mostra ${pins.version}'s bundle for ${options.platform}.`,
        }),
      );
    }
    // A Windows archive holds no links (D153): its junctions are made once it is in place.
    const windows = isWindowsBundle(options.platform);
    await extractBundle(archive, root, top, { links: windows ? "refuse" : "keep" });
    await rm(archive, { force: true });
    const bundle = await readBundle(root);
    if (bundle.info.version !== pins.version || bundle.info.platform !== options.platform) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
          message: `The archive holds Mostra ${bundle.info.version} for ${bundle.info.platform}, not ${pins.version} for ${options.platform}.`,
        }),
      );
    }
    options.onProgress?.({ step: "files" });
    await checkFiles(bundle, { links: !windows });
    try {
      await renameIntoPlace(root, dir);
    } catch (error) {
      // Another installer finished first (the lock is an optimization, never what correctness
      // rests on): its directory is used, whose files it checked before renaming them into place.
      // Windows refuses a rename over an existing directory with EPERM.
      const code = (error as NodeJS.ErrnoException).code;
      const taken = code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM";
      if (!taken || !(await exists(dir))) throw error;
    }
  } finally {
    // Windows may hold the files a moment (an antivirus scan); a scratch directory left anyway
    // is removed by the next install's sweep.
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => undefined,
    );
  }
}

/**
 * Renames `from` to `to`. On Windows a file that an antivirus scan or the indexer holds for a
 * moment refuses the rename (EPERM, EACCES, EBUSY) though nothing is wrong, so the rename is
 * tried again with backoff for up to 3 s, as the runtime's renames are (D150 item 8), and never
 * turned into a copy; a refusal that lasts is thrown, and EPERM over an existing directory with it.
 */
async function renameIntoPlace(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 3000;
  for (let wait = 25; ; wait = Math.min(wait * 2, 400)) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const held = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (process.platform !== "win32" || !held || Date.now() > deadline || (await exists(to)))
        throw error;
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

/** Fails early when the cache's file system can't hold the bundle. */
async function requireSpace(dir: string, asset: BundleAsset): Promise<void> {
  const fs = await statfs(dir).catch(() => undefined);
  if (fs === undefined) return;
  const free = Number(fs.bavail) * Number(fs.bsize);
  const needed = asset.size + asset.unpackedSize + BROWSER_ALLOWANCE;
  if (free < needed) {
    const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", {
        message: `The runtime bundle needs about ${gib(needed)} free in ${dir}, and ${gib(free)} is free (the disk is full).`,
      }),
    );
  }
}

/** Removes temporary directories an interrupted install left, when their process is gone. */
async function sweep(bundles: string): Promise<void> {
  for (const name of await readdir(bundles).catch(() => [] as string[])) {
    const match = /^\.tmp-(\d+)-/.exec(name);
    if (match && !alive(Number(match[1]))) {
      await rm(join(bundles, name), { recursive: true, force: true });
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How old a lock may get before another installer takes it over whatever its owner. */
const STALE_LOCK_MS = 60 * 60_000;
/**
 * How often a held lock is touched, so an install longer than {@link STALE_LOCK_MS} (a slow
 * network, a large browser) is never taken from its live owner (Opus review of WP-12, finding 10).
 */
const LOCK_TOUCH_MS = 60_000;

/** `url` without trailing slashes, in linear time (a regex would be quadratic on many slashes). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** A lock judged stale: the file judged, by its identity and what it held. */
export interface JudgedLock {
  readonly ino: number;
  readonly dev: number;
  readonly text: string;
}

/**
 * Judges the lock at `path` through one descriptor: `gone`, `live`, or stale (its owner gone, or
 * older than an hour) with what identifies the file judged.
 */
export async function judgeLock(path: string): Promise<"gone" | "live" | JudgedLock> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch {
    return "gone";
  }
  try {
    const info = await handle.stat();
    const text = await handle.readFile("utf8");
    const owner = Number.parseInt(text, 10);
    const stale =
      Date.now() - info.mtimeMs > STALE_LOCK_MS ||
      (Number.isInteger(owner) && owner > 0 && !alive(owner));
    return stale ? { ino: info.ino, dev: info.dev, text } : "live";
  } finally {
    await handle.close();
  }
}

/**
 * Moves the lock at `path` aside and removes it only if it is the file `judged` describes, by
 * identity and by contents: a fresh lock another installer took in between is put back (or, if a
 * third took one meanwhile, left to the next round). The contents matter because a file system may
 * give a new file the number of one just removed (ext4 does at once), and each lock holds its
 * owner's PID and its own token (MT-02).
 */
export async function removeJudged(path: string, judged: JudgedLock): Promise<void> {
  const aside = `${path}.stale-${randomBytes(6).toString("hex")}`;
  try {
    await rename(path, aside);
  } catch {
    return; // someone else moved or removed it
  }
  const moved = await stat(aside).catch(() => undefined);
  const text = await readFile(aside, "utf8").catch(() => undefined);
  const same =
    moved !== undefined &&
    moved.ino === judged.ino &&
    moved.dev === judged.dev &&
    text === judged.text;
  // Not the file judged stale: a fresh lock. Put it back unless a newer one exists.
  if (!same) await link(aside, path).catch(() => undefined);
  await rm(aside, { force: true });
}

/**
 * Removes the lock at `path` when it is stale and says whether it may be taken now. The lock only
 * saves a second download; the scratch directory and its rename keep the cache correct whatever
 * happens here.
 */
async function takeOverIfStale(path: string): Promise<boolean> {
  const judged = await judgeLock(path);
  if (judged === "gone") return true; // gone already: try to take it
  if (judged === "live") return false;
  await removeJudged(path, judged);
  return true;
}

/**
 * Takes the install lock at `path`: an exclusive create holding the owner's PID. A lock whose
 * owner is gone, or older than an hour, is taken over; otherwise the caller waits for it.
 */
async function lock(path: string, signal: AbortSignal | undefined): Promise<() => Promise<void>> {
  const token = randomBytes(8).toString("hex");
  for (;;) {
    signal?.throwIfAborted();
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${process.pid} ${token}\n`);
      await handle.close();
      const touch = setInterval(() => {
        void readFile(path, "utf8")
          .then((text) => {
            if (text.includes(token)) return utimes(path, new Date(), new Date());
            return undefined;
          })
          .catch(() => undefined);
      }, LOCK_TOUCH_MS);
      touch.unref();
      // Released by moving it aside and removing it only if it is still this installer's own.
      return async () => {
        clearInterval(touch);
        const aside = `${path}.done-${randomBytes(6).toString("hex")}`;
        if (
          !(await rename(path, aside).then(
            () => true,
            () => false,
          ))
        )
          return;
        const text = await readFile(aside, "utf8").catch(() => "");
        if (!text.includes(token)) await link(aside, path).catch(() => undefined);
        await rm(aside, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await takeOverIfStale(path)) continue;
    await new Promise((done) => setTimeout(done, 250));
  }
}
