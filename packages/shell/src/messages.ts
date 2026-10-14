/** What the shell tells a person when it can't show the artifact (FAILURE_MODEL §8). */
export function explain(code: string): { readonly title: string; readonly detail: string } {
  switch (code) {
    case "MOSTRA_HYGIENE_TOKEN_REVOKED":
      return {
        title: "This link was revoked or has expired",
        detail: "Ask whoever shared it for a new link.",
      };
    case "MOSTRA_HYGIENE_SESSION_MISSING":
      return {
        title: "Open the full link to view this artifact",
        detail: "This page needs the link you were given, including everything after the #.",
      };
    case "MOSTRA_HYGIENE_TOKEN_INVALID":
      return {
        title: "This link doesn't work",
        detail: "It may be incomplete or belong to another artifact. Copy the whole link again.",
      };
    case "MOSTRA_HYGIENE_RATE_LIMITED":
      return { title: "Too many attempts", detail: "Wait a minute, then open the link again." };
    case "MOSTRA_ARTIFACT_VERSION_NOT_FOUND":
      return {
        title: "This version doesn't exist",
        detail: "Open the link without its version number to see the latest version.",
      };
    case "MOSTRA_HOME_INTEGRITY":
      return {
        title: "This version is damaged",
        detail:
          "Its files on this machine changed after it was published. Ask for it to be published again.",
      };
    case "MOSTRA_HYGIENE_SCOPE_DENIED":
      return { title: "This link doesn't allow that", detail: "Ask for a link with more access." };
    case "NO_ARTIFACT":
      return {
        title: "No artifact here",
        detail: "Open an artifact through the link Mostra gave you.",
      };
    default:
      return {
        title: "The artifact can't be shown right now",
        detail: "Reload the page. If it keeps happening, check that Mostra is running.",
      };
  }
}
