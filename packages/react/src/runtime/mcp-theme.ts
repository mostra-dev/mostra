"use client";

/**
 * The host's look on a page inline (D175 item 6, D141 item 4): the MCP Apps host's variables are
 * set on the document, Mostra's tokens read them (`--background` from `--color-background-primary`
 * and so on, the table the exporter writes from `@mostra/themes`, `#mostra-host-tokens`), Studio's
 * values stay where the host gives none, the host's theme picks light or dark, and its fonts load.
 * Nothing is enforced (D68): a page's own styles still win where it sets its own.
 */
import type { McpHostContext } from "./mcp-host.ts";

/** The longest value of one variable taken from a host. */
const VALUE_MAX = 1024;
/** A CSS custom property's name. */
const PROPERTY = /^--[A-Za-z0-9-]{1,64}$/;

/** The token table the exporter wrote: each token and the host variables it reads, in order. */
function tokenTable(): Readonly<Record<string, readonly string[]>> {
  const text = document.getElementById("mostra-host-tokens")?.textContent;
  if (!text) return {};
  try {
    const table = JSON.parse(text) as unknown;
    if (table === null || typeof table !== "object") return {};
    const checked: Record<string, readonly string[]> = {};
    for (const [token, sources] of Object.entries(table as Record<string, unknown>)) {
      if (!PROPERTY.test(token) || !Array.isArray(sources)) continue;
      checked[token] = sources.filter(
        (source): source is string => typeof source === "string" && PROPERTY.test(source),
      );
    }
    return checked;
  } catch {
    return {};
  }
}

let applied = new Set<string>();

/** Applies the host's context to the document; called again with each change it sends. */
export function applyHostContext(context: McpHostContext): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const styles = context["styles"] as
    | { variables?: Record<string, unknown>; css?: { fonts?: unknown } }
    | undefined;
  const variables = styles?.variables ?? {};
  const set = new Set<string>();
  for (const [name, value] of Object.entries(variables)) {
    if (!PROPERTY.test(name) || typeof value !== "string" || value.length > VALUE_MAX) continue;
    root.style.setProperty(name, value);
    set.add(name);
  }
  for (const [token, sources] of Object.entries(tokenTable())) {
    const source = sources.find((name) => set.has(name));
    if (source === undefined) continue;
    root.style.setProperty(token, `var(${source})`);
    set.add(token);
  }
  // A variable the host no longer gives goes back to the page's own value.
  for (const name of applied) if (!set.has(name)) root.style.removeProperty(name);
  applied = set;
  const theme = context["theme"];
  if (theme === "light" || theme === "dark") {
    root.dataset["appearance"] = theme;
    root.style.colorScheme = theme;
  }
  const fonts = styles?.css?.fonts;
  if (typeof fonts === "string" && fonts.length <= 64 * 1024) {
    let style = document.getElementById("mostra-host-fonts");
    if (style === null) {
      style = document.createElement("style");
      style.id = "mostra-host-fonts";
      document.head.append(style);
    }
    style.textContent = fonts;
  }
}
