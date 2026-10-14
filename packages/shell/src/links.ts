/** `ui/open-link` (MCP Apps): the artifact asks the shell to send the viewer somewhere. */
import { OPEN_LINK_SCHEMES } from "@mostra/protocol";

/** Opens a URL in a new browsing context; `window.open` in the shell. */
export type Opener = (url: string, target: string, features: string) => unknown;

/**
 * Opens a URL the artifact asked for in a new tab, never in the shell's own, and only for the
 * schemes of {@link OPEN_LINK_SCHEMES}: a `javascript:` URL would run in the shell's origin.
 * `noopener` keeps the new tab from reaching back into the shell.
 */
export function openLink(url: string, opener: Opener): { readonly isError?: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { isError: true };
  }
  if (!OPEN_LINK_SCHEMES.includes(parsed.protocol)) return { isError: true };
  opener(parsed.href, "_blank", "noopener,noreferrer");
  return {};
}
