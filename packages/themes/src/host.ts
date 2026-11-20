/**
 * Mostra's tokens in an MCP Apps host (D175 item 6, D141 item 4): which of the host's standardized
 * variables (`hostContext.styles.variables`, VERIFIED_FACTS, WP-17) each token takes, so a page
 * shown inline wears the host's colors, radius and faces. A token the host doesn't give keeps the
 * page's own value (Studio's, or the artifact's theme), so nothing a host leaves out breaks.
 */

/**
 * Each token and the MCP Apps variables it reads, best first: the first one the host gives wins.
 * Mostra's own tokens without a host counterpart (`--answer`, the chart colors, motion) stay.
 */
export const HOST_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "--background": ["--color-background-primary"],
  "--foreground": ["--color-text-primary"],
  "--card": ["--color-background-secondary", "--color-background-primary"],
  "--card-foreground": ["--color-text-primary"],
  "--popover": ["--color-background-primary"],
  "--popover-foreground": ["--color-text-primary"],
  "--primary": ["--color-background-inverse", "--color-text-primary"],
  "--primary-foreground": ["--color-text-inverse", "--color-background-primary"],
  "--secondary": ["--color-background-tertiary", "--color-background-secondary"],
  "--secondary-foreground": ["--color-text-primary"],
  "--muted": ["--color-background-secondary"],
  "--muted-foreground": ["--color-text-secondary"],
  "--accent": ["--color-background-tertiary", "--color-background-secondary"],
  "--accent-foreground": ["--color-text-primary"],
  "--destructive": ["--color-text-danger"],
  "--destructive-foreground": ["--color-text-inverse"],
  "--success": ["--color-text-success"],
  "--warning": ["--color-text-warning"],
  "--border": ["--color-border-primary"],
  "--input": ["--color-border-primary"],
  "--ring": ["--color-ring-primary"],
  "--radius": ["--border-radius-md"],
  "--font-sans": ["--font-sans"],
  "--font-display": ["--font-sans"],
  "--font-mono": ["--font-mono"],
};

/** The value each token takes from a host's variables: only those the host gives. */
export function hostTokenValues(
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [token, sources] of Object.entries(HOST_TOKENS)) {
    for (const source of sources) {
      const value = variables[source];
      if (typeof value === "string" && value.trim() !== "" && value.length <= 1024) {
        values[token] = value;
        break;
      }
    }
  }
  return values;
}
