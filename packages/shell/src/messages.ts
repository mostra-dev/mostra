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
    case "MOSTRA_HYGIENE_HEADERS_TOO_LARGE":
      return {
        title: "This browser sent too many cookies",
        detail:
          "A page on this machine filled them, and they have been cleared. Open your link again.",
      };
    case "MOSTRA_HYGIENE_SCOPE_DENIED":
      return { title: "This link doesn't allow that", detail: "Ask for a link with more access." };
    case "MOSTRA_HOST_IDENTITY_UNAVAILABLE":
      return {
        title: "Mostra can't tell who you are right now",
        detail:
          "The app that identifies people for this artifact isn't answering. Try again in a moment.",
      };
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

/** What a link's scopes let a person do, in plain words (D97). */
function abilities(scopes: readonly string[]): string[] {
  const words: string[] = ["view"];
  if (scopes.includes("draft")) words.push("save answers");
  if (scopes.includes("submit")) words.push("submit");
  if (scopes.includes("review")) words.push("comment and choose");
  if (scopes.includes("signal")) words.push("notify the agent");
  if (scopes.includes("action:*")) words.push("run every action");
  else {
    const actions = scopes.filter((scope) => scope.startsWith("action:"));
    if (actions.length > 0) {
      words.push(`run ${actions.map((scope) => scope.slice("action:".length)).join(", ")}`);
    }
  }
  return words;
}

/** What a link allows, in one sentence, for the choice between two links (D98 item 8). */
export function describeAccess(access: {
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
  readonly version?: number;
}): string {
  const words = abilities(access.scopes);
  const list =
    words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  const version = access.version === undefined ? "" : `, version ${access.version} only`;
  const until =
    access.expiresAt === undefined
      ? ""
      : `, until ${new Date(access.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
  return `Can ${list}${version}${until}.`;
}
