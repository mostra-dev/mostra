/**
 * The lockfile (`lock.yaml`, D20, D95): what a version was built with, frozen at publish, and the
 * form of every artifact's working lockfile. WP-03's form lists the warm set; an artifact with
 * on-demand packages adds `packages` (each direct one at its exact version) and `pnpm` (the
 * installer's lockfile, which pins the whole graph). WP-16 adds, additively, `plugins` (the
 * artifact's plugins in load order, ROUND-3 §6.4) and `licenses` (the licenses acknowledged for
 * them and for packs, D31, each with its class, who accepted it and when). `lockDigest` is the
 * SHA-256 of the text, so any change to any of them changes `envDigest` and the version (DP-03);
 * a lockfile without plugins or acknowledgments keeps its earlier form byte for byte.
 */
import { createHash } from "node:crypto";
import type { LicenseClass } from "@mostra/protocol";
import { parse } from "yaml";

/** A license acknowledged for an artifact (or the home), as its lockfile records it (D31). */
export interface LockLicense {
  /** Its class when it was accepted. */
  readonly class: LicenseClass;
  /** `flag` (`--accept-license`) or `host` (the home's license policy). */
  readonly by: "flag" | "host";
  /** When (RFC 3339). */
  readonly at: string;
}

/** A lockfile's content. */
export interface Lock {
  /** Every warm package and its version. */
  readonly warm: Readonly<Record<string, string>>;
  /** Each direct on-demand package and its exact version; empty without any. */
  readonly packages: Readonly<Record<string, string>>;
  /** The installer's lockfile (pnpm's `pnpm-lock.yaml`), present exactly when `packages` isn't empty. */
  readonly pnpm?: string;
  /** The plugins' package names in load order (WP-16); each is also in `packages`. */
  readonly plugins?: readonly string[];
  /** The licenses acknowledged, by ID (WP-16). */
  readonly licenses?: Readonly<Record<string, LockLicense>>;
}

const HEADER = "# Mostra lockfile: the packages this version was built with. Frozen at publish.";

const sorted = (record: Readonly<Record<string, string>>): [string, string][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1));

/** The canonical text of `lock`. */
export function lockText(lock: Lock): string {
  const lines = [HEADER, "lockfileVersion: 1", "warm:"];
  for (const [name, version] of sorted(lock.warm)) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(version)}`);
  }
  const packages = sorted(lock.packages);
  if (packages.length > 0) {
    if (lock.pnpm === undefined)
      throw new Error("A lockfile with packages needs its pnpm lockfile.");
    lines.push("packages:");
    for (const [name, version] of packages) {
      lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(version)}`);
    }
    lines.push("pnpm: |");
    const pnpm = lock.pnpm.replace(/\s+$/, "");
    for (const line of pnpm.split("\n")) lines.push(line === "" ? "" : `  ${line}`);
  }
  if ((lock.plugins?.length ?? 0) > 0) {
    lines.push("plugins:");
    for (const name of lock.plugins ?? []) lines.push(`  - ${JSON.stringify(name)}`);
  }
  const licenses = Object.entries(lock.licenses ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (licenses.length > 0) {
    lines.push("licenses:");
    for (const [id, license] of licenses) {
      lines.push(`  ${JSON.stringify(id)}:`);
      lines.push(`    class: ${JSON.stringify(license.class)}`);
      lines.push(`    by: ${JSON.stringify(license.by)}`);
      lines.push(`    at: ${JSON.stringify(license.at)}`);
    }
  }
  const text = `${lines.join("\n")}\n`;
  // The block scalar must hold the installer's lockfile exactly; anything else is a bug here.
  const back = parseLock(text);
  if (packages.length > 0 && back.pnpm !== `${lock.pnpm?.replace(/\s+$/, "")}\n`) {
    throw new Error("The pnpm lockfile doesn't round-trip through lock.yaml.");
  }
  return text;
}

/** Reads a lockfile's text. */
export function parseLock(text: string): Lock {
  const data = (parse(text) ?? {}) as {
    warm?: Record<string, string> | null;
    packages?: Record<string, string> | null;
    pnpm?: string;
    plugins?: string[] | null;
    licenses?: Record<string, LockLicense> | null;
  };
  return {
    warm: data.warm ?? {},
    packages: data.packages ?? {},
    ...(typeof data.pnpm === "string" ? { pnpm: data.pnpm } : {}),
    ...(Array.isArray(data.plugins) && data.plugins.length > 0 ? { plugins: data.plugins } : {}),
    ...(data.licenses && Object.keys(data.licenses).length > 0 ? { licenses: data.licenses } : {}),
  };
}

/** The SHA-256 of a lockfile's text, as lowercase hex. */
export function lockDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Every package, direct or transitive, an installer lockfile pins: `{ name, version }`. */
export function pinnedPackages(pnpm: string): { name: string; version: string }[] {
  const data = (parse(pnpm) ?? {}) as { packages?: Record<string, unknown> | null };
  const result: { name: string; version: string }[] = [];
  for (const key of Object.keys(data.packages ?? {})) {
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    result.push({ name: key.slice(0, at), version: key.slice(at + 1) });
  }
  return result;
}

/** `lock` with the plugins and acknowledgments of `from` (a working lockfile), which a resolution keeps. */
export function withExtras(lock: Lock, from: Lock | undefined): Lock {
  const { plugins: _plugins, licenses: _licenses, ...rest } = lock;
  const plugins = from?.plugins ?? [];
  const licenses = from?.licenses ?? {};
  return {
    ...rest,
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(Object.keys(licenses).length > 0 ? { licenses } : {}),
  };
}

/**
 * The key of the layout a lockfile builds against (`deps/locks/<key>`): the digest of its
 * packages alone, without its plugins and acknowledgments, which change what a version records
 * but not what it installs. For a lockfile without either it is its `lockDigest`, so layouts made
 * before WP-16 keep their names.
 */
export function layoutKey(lock: Lock): string {
  return lockDigest(
    lockText({
      warm: lock.warm,
      packages: lock.packages,
      ...(lock.pnpm ? { pnpm: lock.pnpm } : {}),
    }),
  );
}
