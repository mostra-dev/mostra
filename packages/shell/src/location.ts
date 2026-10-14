/**
 * What a shell URL names (D97): `/a/<artifactId>` for the latest version, `/a/<artifactId>/v/<n>`
 * for one version, and the capability token in the fragment (`#t=<secret>`) on first open.
 */

/** The artifact and version a shell page shows. */
export interface ShellTarget {
  /** The artifact ID from the path. */
  readonly artifactId: string;
  /** The version number the link pins, if any. */
  readonly version?: number;
  /** The shell's API base for this artifact, where its session cookie applies. */
  readonly apiBase: string;
}

const PATH = /^\/a\/(art_[0-9A-HJKMNP-TV-Z]{26})(?:\/v\/([1-9][0-9]{0,8}))?\/?$/;

/** Reads the target from a path, or `undefined` when the path names no artifact. */
export function parseTarget(pathname: string): ShellTarget | undefined {
  const match = PATH.exec(pathname);
  if (!match?.[1]) return undefined;
  const artifactId = match[1];
  return {
    artifactId,
    ...(match[2] !== undefined ? { version: Number(match[2]) } : {}),
    apiBase: `/a/${artifactId}/_mostra`,
  };
}

/** The capability token in a fragment (`#t=<secret>`), if any. */
export function tokenFrom(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("t");
  return token !== null && token.length > 0 ? token : undefined;
}
