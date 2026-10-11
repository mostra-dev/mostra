/**
 * Identity and digests (DATA_MODEL §2, D77, D89). Pure functions over bytes and listings; the
 * snapshot module feeds them files, and publish combines them into the version ID.
 */
import { createHash } from "node:crypto";
import { VersionId } from "@mostra/protocol";

/** One file of a canonical listing. */
export interface ListedFile {
  /** Relative, `/`-separated, NFC path. */
  readonly path: string;
  /** Whether any execute bit is set. */
  readonly executable: boolean;
  /** SHA-256 of the file's bytes, lowercase hex. */
  readonly sha256: string;
}

/** The environment a version is built in; its canonical JSON's SHA-256 is `envDigest`. */
export interface BuildEnvironment {
  readonly mostraVersion: string;
  /** The kit's release, or `null` while the runtime ships no kit (WP-18). */
  readonly kitVersion: string | null;
  readonly kitBase: "base" | "radix";
  readonly mode: "spa";
  /** SHA-256 of the frozen lockfile (`lock.yaml`). */
  readonly lockDigest: string;
  /** SHA-256 of the render mode's build settings and target list. */
  readonly buildConfigDigest: string;
  /** The browser protocol revision the client runtime speaks, or `null` before WP-07 defines it. */
  readonly browserProtocolRevision: string | null;
}

/** SHA-256 as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical JSON (RFC 8785 for the values Mostra hashes: objects with string keys, arrays,
 * strings, finite numbers, booleans and null): keys sorted by UTF-16 code units, no whitespace.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Canonical JSON has no representation for a non-finite number.");
    }
    if (value === undefined) throw new TypeError("Canonical JSON has no undefined.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Orders paths by their UTF-8 bytes, so the listing is the same on every platform. */
function byUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * The SHA-256 of a tree's canonical listing (DATA_MODEL §2): the JSON array of
 * `[path, executable, sha256]` for every file, sorted by the path's UTF-8 bytes.
 */
export function listingDigest(files: readonly ListedFile[]): string {
  const sorted = [...files].sort((a, b) => byUtf8(a.path, b.path));
  return sha256Hex(JSON.stringify(sorted.map((file) => [file.path, file.executable, file.sha256])));
}

/** `envDigest`: the SHA-256 of the environment's canonical JSON. */
export function environmentDigest(environment: BuildEnvironment): string {
  return sha256Hex(canonicalJson(environment));
}

/**
 * The version ID (D89): SHA-256 over the artifact ID's UTF-8 bytes, one `0x00` byte, then the
 * 32 bytes of `sourceDigest` and of `envDigest`, encoded by `VersionId.fromSha256` (D77).
 */
export function versionIdFor(artifactId: string, sourceDigest: string, envDigest: string): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(artifactId, "utf8"));
  hash.update(Buffer.from([0]));
  hash.update(Buffer.from(sourceDigest, "hex"));
  hash.update(Buffer.from(envDigest, "hex"));
  return VersionId.fromSha256(new Uint8Array(hash.digest()));
}
