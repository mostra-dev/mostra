/**
 * The lockfile (`lock.yaml`, D20, D95): what a version was built with, frozen at publish, and the
 * form of every artifact's working lockfile. WP-03's form lists the warm set; an artifact with
 * on-demand packages adds `packages` (each direct one at its exact version) and `pnpm` (the
 * installer's lockfile, which pins the whole graph). `lockDigest` is the SHA-256 of the text, so
 * any change to either changes `envDigest` and the version (DP-03).
 */
import { createHash } from "node:crypto";
import { parse } from "yaml";

/** A lockfile's content. */
export interface Lock {
  /** Every warm package and its version. */
  readonly warm: Readonly<Record<string, string>>;
  /** Each direct on-demand package and its exact version; empty without any. */
  readonly packages: Readonly<Record<string, string>>;
  /** The installer's lockfile (pnpm's `pnpm-lock.yaml`), present exactly when `packages` isn't empty. */
  readonly pnpm?: string;
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
  };
  return {
    warm: data.warm ?? {},
    packages: data.packages ?? {},
    ...(typeof data.pnpm === "string" ? { pnpm: data.pnpm } : {}),
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
