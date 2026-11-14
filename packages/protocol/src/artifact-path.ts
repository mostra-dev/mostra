/**
 * A file's path inside an artifact, as every writer of an artifact's files checks it (the MCP
 * server's workspace, D164; source packs, WP-16): relative, `/`-separated, no `.` or `..` segment,
 * no empty segment, no drive or control character, and only names every system can hold, so an
 * artifact written on one system moves to another whole.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Characters Windows refuses in a name (`:` would also name an NTFS stream). */
const UNPORTABLE = /[<>:"|?*]/;

/** Windows' device names, with any extension (`nul.tsx` is the device too), any case. */
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** What {@link checkArtifactPath} found. */
export type ArtifactPathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "outside" }
  | { readonly ok: false; readonly reason: "unportable"; readonly segment: string };

/**
 * Checks a path inside an artifact and spells it with `/`. `outside`: empty, absolute, a drive, a
 * control character, or an empty, `.` or `..` segment. `unportable`: a segment with one of
 * Windows' reserved characters, a Windows device name, or a dot or space at its end, which
 * Windows strips (`index.tsx.` would be `index.tsx`).
 */
export function checkArtifactPath(path: string): ArtifactPathCheck {
  const segments = path.split(/[\\/]/);
  if (
    path === "" ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    CONTROL.test(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return { ok: false, reason: "outside" };
  }
  const segment = segments.find(
    (part) => UNPORTABLE.test(part) || DEVICE.test(part) || /[. ]$/.test(part),
  );
  if (segment !== undefined) return { ok: false, reason: "unportable", segment };
  return { ok: true, path: segments.join("/") };
}
