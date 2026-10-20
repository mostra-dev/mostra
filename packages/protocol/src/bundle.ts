/**
 * The runtime bundle's contract (RT-01, INTERFACES §16): what a host downloads, how it checks it
 * and where its entry points are. The SDK, the CLI's bootstrap and the Rust crate (WP-12) all read
 * these files, so they are wire schemas: published as JSON Schema and changed only additively.
 *
 * A release attaches one archive per platform, `mostra-<version>-<platform>.tar.gz`, whose single
 * top directory holds:
 *
 * ```text
 * bundle.json       BundleInfo: identity, entry points, the digest of files.json, the browser pin
 * files.json        BundleFiles: every other file and link of the archive with its SHA-256
 * node/             the official Node.js distribution for the platform
 * lib/node_modules/ Mostra's packages (cli, runtime, worker, verify, shell, sdk, warm) and theirs
 * bin/              the mostra, mostra-runtime and mostra-setup launchers
 * ```
 *
 * The verify browser isn't in the archive: setup downloads the pinned revision through the
 * bundle's own Playwright and checks every file against `BundleInfo.browser.files` (D142).
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

/** The platforms v1 ships a bundle for (D35; Windows follows in v1.1, D120). */
export const BUNDLE_PLATFORMS: readonly ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] =
  ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];

/** One platform a bundle is built for: `<os>-<arch>` as Node names them. */
export type BundlePlatform = (typeof BUNDLE_PLATFORMS)[number];

/** The `name` every `bundle.json` carries, so a stray JSON file is never taken for one. */
export const BUNDLE_NAME = "mostra-runtime-bundle";

/** The marker setup writes at a bundle's root once its files and its browser are verified. */
export const BUNDLE_SETUP_MARKER = ".mostra-setup.json";

/** The archive a release attaches for a version and platform. */
export function bundleAssetName(version: string, platform: BundlePlatform): string {
  return `mostra-${version}-${platform}.tar.gz`;
}

const sha256: z.ZodType<string> = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .register(wireRegistry, { id: "Sha256", description: "A SHA-256 digest in lowercase hex." });

/**
 * A path inside a bundle, `/`-separated and relative. Readers refuse absolute paths and `.` or
 * `..` segments themselves; the pattern only keeps the obvious out.
 */
const bundlePath: z.ZodType<string> = z
  .string()
  .min(1)
  .regex(/^[^/\0]/);

/** The platform schema. */
export const BundlePlatformSchema: z.ZodType<BundlePlatform> = z
  .enum(BUNDLE_PLATFORMS)
  .register(wireRegistry, { id: "BundlePlatform" });

/** One regular file of a bundle or of its browser. */
export interface BundleFileEntry {
  /** Relative to the bundle's root (or to `browsers/` for the browser), `/`-separated. */
  readonly path: string;
  /** Its length in bytes. */
  readonly size: number;
  /** The SHA-256 of its bytes, lowercase hex. */
  readonly sha256: string;
  /** Whether its owner may execute it (mode 0755 rather than 0644 once extracted). */
  readonly executable: boolean;
}

/** The file entry schema. */
export const BundleFileEntry: z.ZodType<BundleFileEntry> = z
  .object({
    path: bundlePath,
    size: z.int().min(0),
    sha256,
    executable: z.boolean(),
  })
  .register(wireRegistry, { id: "BundleFileEntry" });

/** One symbolic link of a bundle. Its target is relative and resolves inside the bundle. */
export interface BundleLinkEntry {
  /** The link itself, relative to the bundle's root. */
  readonly path: string;
  /** What the link holds, exactly as written (relative). */
  readonly target: string;
}

/** The link entry schema. */
export const BundleLinkEntry: z.ZodType<BundleLinkEntry> = z
  .object({ path: bundlePath, target: z.string().min(1) })
  .register(wireRegistry, { id: "BundleLinkEntry" });

/** `files.json`: everything in the archive besides `bundle.json`, each list sorted by path. */
export interface BundleFiles {
  /** The format's version; 1 today. */
  readonly schemaVersion: 1;
  /** Every regular file, sorted by path. */
  readonly files: readonly BundleFileEntry[];
  /** Every symbolic link, sorted by path. */
  readonly links: readonly BundleLinkEntry[];
}

/** The `files.json` schema. */
export const BundleFiles: z.ZodType<BundleFiles> = z
  .object({
    schemaVersion: z.literal(1),
    files: z.array(BundleFileEntry),
    links: z.array(BundleLinkEntry),
  })
  .register(wireRegistry, { id: "BundleFiles" });

/** The verify browser a bundle pins: fetched at setup, checked file by file (D142). */
export interface BundleBrowser {
  /** Playwright's name for the browser. */
  readonly name: "chromium-headless-shell";
  /** Playwright's revision, the directory `browsers/chromium_headless_shell-<revision>`. */
  readonly revision: string;
  /** The browser's own version, for people and diagnostics. */
  readonly browserVersion: string;
  /** The bundle's Playwright CLI, run with the bundle's Node: `install chromium-headless-shell`. */
  readonly installer: string;
  /** Every file the install leaves under `browsers/`, besides Playwright's own markers. */
  readonly files: readonly BundleFileEntry[];
}

/** The browser pin schema. */
export const BundleBrowser: z.ZodType<BundleBrowser> = z
  .object({
    name: z.literal("chromium-headless-shell"),
    revision: z.string().min(1),
    browserVersion: z.string().min(1),
    installer: bundlePath,
    files: z.array(BundleFileEntry),
  })
  .register(wireRegistry, { id: "BundleBrowser" });

/** `bundle.json`: a bundle's identity and entry points. */
export interface BundleInfo {
  /** The format's version; 1 today. */
  readonly schemaVersion: 1;
  /** Always {@link BUNDLE_NAME}, so a stray `bundle.json` isn't taken for one. */
  readonly name: typeof BUNDLE_NAME;
  /** The Mostra release: every Mostra package in the bundle has this version. */
  readonly version: string;
  /** The platform it was built on and for. */
  readonly platform: BundlePlatform;
  /** The private Node.js the bundle runs on (RT-01), and its executable. */
  readonly node: { readonly version: string; readonly path: string };
  /** Scripts each run as `<node.path> <entry> …`, paths relative to the bundle's root. */
  readonly entries: {
    /** `mostra-runtime host|daemon|service`: what a host spawns (D85). */
    readonly runtime: string;
    /** `mostra`, the CLI. */
    readonly cli: string;
    /** Verifies the bundle, fetches its browser and writes `.mostra-setup.json`. */
    readonly setup: string;
  };
  /** `files.json` and its SHA-256, which ties every other file to this one. */
  readonly files: { readonly path: string; readonly sha256: string };
  /** The verify browser setup fetches and checks (D142 item 2). */
  readonly browser: BundleBrowser;
  /** Where it was built from. */
  readonly source?: { readonly repository: string; readonly commit: string };
}

/** The `bundle.json` schema. */
export const BundleInfo: z.ZodType<BundleInfo> = z
  .object({
    schemaVersion: z.literal(1),
    name: z.literal(BUNDLE_NAME),
    version: z.string().min(1),
    platform: BundlePlatformSchema,
    node: z.object({ version: z.string().min(1), path: bundlePath }),
    entries: z.object({ runtime: bundlePath, cli: bundlePath, setup: bundlePath }),
    files: z.object({ path: bundlePath, sha256 }),
    browser: BundleBrowser,
    source: z.object({ repository: z.string(), commit: z.string() }).exactOptional(),
  })
  .register(wireRegistry, { id: "BundleInfo" });

/** One platform's archive in a release. */
export interface BundleAsset {
  /** The file name, {@link bundleAssetName}. */
  readonly file: string;
  /** The SHA-256 of the archive's bytes, lowercase hex. */
  readonly sha256: string;
  /** Bytes of the archive. */
  readonly size: number;
  /** Bytes once extracted, before the browser: what an installer checks free space against. */
  readonly unpackedSize: number;
}

/** The asset schema. */
export const BundleAsset: z.ZodType<BundleAsset> = z
  .object({
    // Exactly an archive's own name, no directory: an installer joins it to its scratch directory
    // (Opus review finding 8), and `BundlePins` checks it names its release and platform.
    file: z
      .string()
      .regex(/^mostra-[0-9A-Za-z][0-9A-Za-z.+-]*-(darwin|linux)-(arm64|x64)\.tar\.gz$/),
    sha256,
    size: z.int().positive(),
    unpackedSize: z.int().positive(),
  })
  .register(wireRegistry, { id: "BundleAsset" });

/**
 * `bundles.json`: one release's archives, pinned by SHA-256. The release workflow writes it into
 * `@mostra/sdk` before the package is published, so an npm install pins exactly what it fetches.
 */
export interface BundlePins {
  /** The format's version; 1 today. */
  readonly schemaVersion: 1;
  /** The release these archives belong to: the SDK's own version. */
  readonly version: string;
  /** The base URL the archives are under: the GitHub release's download path. */
  readonly release: string;
  /** Each platform's archive. */
  readonly assets: Partial<Record<BundlePlatform, BundleAsset>>;
}

/** The `bundles.json` schema: each asset's `file` is {@link bundleAssetName} of its release and platform. */
export const BundlePins: z.ZodType<BundlePins> = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/),
    release: z.url({ protocol: /^https?$/ }),
    assets: z.partialRecord(BundlePlatformSchema, BundleAsset),
  })
  .superRefine((pins, context) => {
    for (const [platform, asset] of Object.entries(pins.assets)) {
      if (asset && asset.file !== bundleAssetName(pins.version, platform as BundlePlatform))
        context.addIssue({
          code: "custom",
          path: ["assets", platform, "file"],
          message: `must be ${bundleAssetName(pins.version, platform as BundlePlatform)}`,
        });
    }
  })
  .register(wireRegistry, { id: "BundlePins" });

/** `.mostra-setup.json`: written by setup once the files and the browser are verified. */
export interface BundleSetup {
  /** The format's version; 1 today. */
  readonly schemaVersion: 1;
  /** The bundle's release. */
  readonly version: string;
  /** The bundle's platform. */
  readonly platform: BundlePlatform;
  /** `BundleInfo.files.sha256` of the bundle it describes. */
  readonly files: string;
  /** The browser revision setup fetched and checked. */
  readonly browser: { readonly revision: string };
  /** When setup finished (RFC 3339). */
  readonly at: string;
}

/** The setup marker's schema. */
export const BundleSetup: z.ZodType<BundleSetup> = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().min(1),
    platform: BundlePlatformSchema,
    files: sha256,
    browser: z.object({ revision: z.string().min(1) }),
    at: z.string(),
  })
  .register(wireRegistry, { id: "BundleSetup" });
