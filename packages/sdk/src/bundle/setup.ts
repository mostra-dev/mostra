/**
 * Making an extracted bundle usable (RT-01, D142): its files checked against `files.json`, which
 * `bundle.json` pins by SHA-256; the verify browser fetched through the bundle's own Playwright
 * and checked against the bundle's pin; then `.mostra-setup.json`, the one marker every reader
 * trusts. The SDK runs it after a download; `bin/mostra-setup` runs it for a bundle extracted by
 * hand, and for the Rust crate (WP-12), so there is one implementation of what "ready" means.
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUNDLE_SETUP_MARKER,
  BundleFiles,
  BundleInfo,
  BundleSetup,
  createDiagnostic,
  isWindowsBundle,
  RpcError,
} from "@mostra/protocol";
import { childEnvironment } from "../environment.ts";
import { scrubUrls } from "./download.ts";
import { LinkRefused, makeJunctions } from "./links.ts";
import { checkTree, hashFile, safeRelative } from "./tree.ts";

/** The environment setup reads. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** An extracted bundle and what its `bundle.json` says. */
export interface Bundle {
  /** Its root directory, holding `bundle.json`. */
  readonly root: string;
  /** Its parsed `bundle.json`. */
  readonly info: BundleInfo;
}

/** One step of setup, for progress reports. */
export type SetupStep = "files" | "browser";

/** Options of {@link setupBundle}. */
export interface SetupOptions {
  /** The environment: `MOSTRA_OFFLINE`, proxies, Playwright's download mirror. */
  readonly env?: Environment | undefined;
  /** Gives up the browser's download. */
  readonly signal?: AbortSignal | undefined;
  /** Each step as it starts. */
  readonly onStep?: ((step: SetupStep) => void) | undefined;
  /** Skip checking the files, for a tree the caller checked a moment ago. */
  readonly filesChecked?: boolean | undefined;
}

/** The directory Playwright's browsers live in, inside a bundle. */
export function browsersDir(root: string): string {
  return join(root, "browsers");
}

/** Whether `MOSTRA_OFFLINE` says Mostra is offline: any value but empty, `0`, `false` or `no`. */
export function offline(env: Environment): boolean {
  const value = env["MOSTRA_OFFLINE"]?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false" && value !== "no"
  );
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", { message }));
}

/** Reads `bundle.json` at `root`. Throws `MOSTRA_ENV_BUNDLE_INVALID` when it isn't a bundle's. */
export async function readBundle(root: string): Promise<Bundle> {
  let text: string;
  try {
    text = await readFile(join(root, "bundle.json"), "utf8");
  } catch (error) {
    throw invalid(`${root} has no readable bundle.json (${(error as Error).message}).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid(`${join(root, "bundle.json")} isn't JSON.`);
  }
  const result = BundleInfo.safeParse(parsed);
  if (!result.success) throw invalid(`${join(root, "bundle.json")} isn't a runtime bundle's.`);
  const info = result.data;
  const paths = [
    info.node.path,
    ...Object.values(info.entries),
    info.files.path,
    info.browser.installer,
  ];
  if (!paths.every(safeRelative))
    throw invalid(`${join(root, "bundle.json")} names a path outside the bundle.`);
  return { root, info };
}

/**
 * The bundle's real path: links followed, Windows' short names written out, the case as the file
 * system keeps it. A Windows bundle's junctions point into it, and its marker names it.
 */
export function realRoot(root: string): string {
  return realpathSync.native(root);
}

/**
 * The setup marker, when it describes exactly this bundle. A Windows bundle's marker must also
 * name the root it sits at now: its junctions point into the root setup ran at, so a bundle moved
 * or copied since is set up again, which makes them afresh (D153).
 */
export async function readSetup(bundle: Bundle): Promise<BundleSetup | undefined> {
  try {
    const marker = BundleSetup.parse(
      JSON.parse(await readFile(join(bundle.root, BUNDLE_SETUP_MARKER), "utf8")),
    );
    const { info } = bundle;
    const here = isWindowsBundle(info.platform) ? marker.root === realRoot(bundle.root) : true;
    return here &&
      marker.files === info.files.sha256 &&
      marker.version === info.version &&
      marker.platform === info.platform &&
      marker.browser.revision === info.browser.revision
      ? marker
      : undefined;
  } catch {
    return undefined;
  }
}

/** What `checkTree` may find besides the listed files: the bundle's own records and browsers. */
export function setupExtras(path: string): boolean {
  return (
    path === "bundle.json" ||
    path === "files.json" ||
    path === "browsers" ||
    path.startsWith("browsers/") ||
    path === BUNDLE_SETUP_MARKER ||
    path.startsWith(`${BUNDLE_SETUP_MARKER}.tmp-`)
  );
}

/** The bundle's `files.json`, once its SHA-256 is the one `bundle.json` pins. */
async function readManifest(bundle: Bundle): Promise<BundleFiles> {
  const { root, info } = bundle;
  const listing = join(root, info.files.path);
  const { sha256 } = await hashFile(listing).catch(() => ({ sha256: "" }));
  if (sha256 !== info.files.sha256) {
    throw invalid(`${info.files.path} doesn't match the SHA-256 that bundle.json pins.`);
  }
  const manifest = BundleFiles.safeParse(JSON.parse(await readFile(listing, "utf8")));
  if (!manifest.success) throw invalid(`${info.files.path} isn't a bundle's file list.`);
  return manifest.data;
}

/**
 * Makes a Windows bundle's links, each a junction at the bundle's real path (D153); nothing for
 * any other bundle, whose archive carries its links. Throws `MOSTRA_ENV_BUNDLE_INVALID` for a link
 * the bundle can't have.
 */
export async function makeLinks(bundle: Bundle): Promise<void> {
  if (!isWindowsBundle(bundle.info.platform)) return;
  const manifest = await readManifest(bundle);
  try {
    await makeJunctions(realRoot(bundle.root), manifest);
  } catch (error) {
    if (error instanceof LinkRefused) throw invalid(`The runtime bundle's links: ${error.message}`);
    throw error;
  }
}

/**
 * Checks the bundle's files; throws `MOSTRA_ENV_BUNDLE_INVALID` naming what differs. With
 * `links: false` the files alone are checked (a Windows bundle before `makeLinks` made its junctions).
 */
export async function checkFiles(
  bundle: Bundle,
  options: { readonly links?: boolean } = {},
): Promise<void> {
  const { root, info } = bundle;
  const manifest = await readManifest(bundle);
  const problems = await checkTree(root, manifest, {
    allowExtra: setupExtras,
    links: options.links ?? true,
  });
  if (problems.length > 0) {
    throw invalid(
      `Mostra ${info.version}'s runtime bundle for ${info.platform} differs from its file list: ${problems.join("; ")}.`,
    );
  }
}

/** The browser files that differ from the pin, relative to `browsers/`. */
export async function checkBrowser(bundle: Bundle): Promise<readonly string[]> {
  const problems = await checkTree(
    browsersDir(bundle.root),
    { schemaVersion: 1, files: bundle.info.browser.files, links: [] },
    // Playwright's own markers, its `.links` registry and any other browser it fetched.
    { allowExtra: () => true },
  ).catch((error: unknown) => [`browsers: ${(error as Error).message}`]);
  return problems;
}

/** The environment the browser install runs in: proxies and Playwright's mirror pass through. */
function installEnvironment(bundle: Bundle, env: Environment): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !name.startsWith("MOSTRA_") && name !== "PLAYWRIGHT_BROWSERS_PATH")
      out[name] = value;
  }
  out["PLAYWRIGHT_BROWSERS_PATH"] = browsersDir(bundle.root);
  return childEnvironment(out);
}

/** The variables whose URLs may carry credentials the browser's fetch uses. */
const CREDENTIAL_URLS = [
  "PLAYWRIGHT_DOWNLOAD_HOST",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
];

/** `text` without URLs' credentials or queries, and without any password `env`'s URLs carry. */
export function scrubSecrets(text: string, env: Environment): string {
  let out = scrubUrls(text);
  for (const name of CREDENTIAL_URLS) {
    const value = env[name];
    if (!value) continue;
    // A proxy is often written without a scheme (`user:pass@host:3128`), which `URL` would read
    // as the scheme `user:`.
    const spelled = value.includes("://") ? value : `http://${value}`;
    const parsed = URL.canParse(spelled) ? new URL(spelled) : undefined;
    for (const secret of [parsed?.password, parsed?.username]) {
      if (!secret) continue;
      for (const form of new Set([secret, decodeURIComponent(secret)]))
        if (form.length >= 3) out = out.split(form).join("***");
    }
  }
  return out;
}

/** Runs the bundle's Playwright to fetch the pinned browser; at most 15 minutes. */
async function installBrowser(bundle: Bundle, options: SetupOptions): Promise<void> {
  const { root, info } = bundle;
  const output: string[] = [];
  const code = await new Promise<number | string>((resolve) => {
    const child = spawn(
      join(root, info.node.path),
      [join(root, info.browser.installer), "install", "chromium-headless-shell"],
      {
        cwd: root,
        env: installEnvironment(bundle, options.env ?? process.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
        timeout: 15 * 60_000,
      },
    );
    const keep = (chunk: Buffer): void => {
      output.push(chunk.toString("utf8"));
      if (output.length > 40) output.shift();
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => resolve(error.message));
    child.on("close", (exit, signal) => resolve(exit ?? signal ?? "unknown"));
  });
  if (code === 0) return;
  // Playwright prints the URLs it fetches, and a mirror's or proxy's may carry credentials
  // (Opus review finding 3): every URL is reduced to its printable form, and any password the
  // environment names is removed wherever it appears.
  const tail = scrubSecrets(
    output.join("").trim().split("\n").slice(-6).join(" | "),
    options.env ?? process.env,
  );
  throw new RpcError(
    createDiagnostic("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", {
      message: `Fetching the verify browser (${info.browser.name} ${info.browser.browserVersion}) failed (${code}): ${tail}`,
    }),
  );
}

/**
 * Makes the bundle at `root` ready: checks its files, fetches and checks the browser when it is
 * missing or differs, and writes `.mostra-setup.json`. Idempotent: a ready bundle returns its
 * marker after the checks. Throws `MOSTRA_ENV_BUNDLE_INVALID`, `MOSTRA_ENV_BUNDLE_UNAVAILABLE`
 * (offline with no browser) or `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`.
 */
export async function setupBundle(root: string, options: SetupOptions = {}): Promise<BundleSetup> {
  const env = options.env ?? process.env;
  const bundle = await readBundle(root);
  // A Windows bundle's junctions are made where it sits now, each read back as it is made; a
  // tree checked a moment ago (`filesChecked`, before the cache's rename) needs nothing more.
  await makeLinks(bundle);
  if (!options.filesChecked) {
    options.onStep?.("files");
    await checkFiles(bundle);
  }
  options.onStep?.("browser");
  if ((await checkBrowser(bundle)).length > 0) {
    if (offline(env)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
          message: `The runtime bundle at ${root} has no verify browser yet, and MOSTRA_OFFLINE keeps Mostra from fetching it.`,
        }),
      );
    }
    // Fresh, never over what's there: a directory that differs from the pin may still carry
    // Playwright's "installation complete" marker, and Playwright would then fetch nothing.
    await rm(browsersDir(root), { recursive: true, force: true });
    await installBrowser(bundle, options);
    const problems = await checkBrowser(bundle);
    if (problems.length > 0) {
      throw invalid(
        `The verify browser Playwright fetched differs from the bundle's pin: ${problems.join("; ")}.`,
      );
    }
  }
  const marker: BundleSetup = {
    schemaVersion: 1,
    version: bundle.info.version,
    platform: bundle.info.platform,
    files: bundle.info.files.sha256,
    browser: { revision: bundle.info.browser.revision },
    at: new Date().toISOString(),
    root: realRoot(root),
  };
  const temporary = join(root, `${BUNDLE_SETUP_MARKER}.tmp-${process.pid}`);
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`);
  await rename(temporary, join(root, BUNDLE_SETUP_MARKER));
  return marker;
}
