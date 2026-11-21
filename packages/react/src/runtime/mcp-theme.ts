"use client";

/**
 * The host's look on a page (D175 item 6, D181 item 5): inline in an MCP Apps host, and in Mostra's
 * shell, which passes a host's look the same way. The host's theme picks light or dark. Where the
 * page's theme stack names `"host"`, the host's variables are set on the document and Mostra's
 * tokens read them (`--background` from `--color-background-primary` and so on, the table the
 * build writes from `@mostra/themes`, `#mostra-host-tokens`), the page's theme keeping what the
 * host gives none of, and the host's fonts load. Nothing is enforced (D68).
 */
import type { McpHostContext } from "./mcp-host.ts";

/** The longest value of one variable taken from a host. */
const VALUE_MAX = 1024;
/** A CSS custom property's name. */
const PROPERTY = /^--[A-Za-z0-9-]{1,64}$/;
/** What can end a declaration or a rule: never part of a value taken from a host. */
const BREAKS = /[;{}<>\\]/;

/** The token table the build wrote: each token and the host variables it reads, in order. */
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

/** Where the host's look goes, as the page's theme stack placed it (`<html data-host-look>`). */
function hostLook(root: HTMLElement): "over" | "under" | undefined {
  const look = root.dataset["hostLook"];
  return look === "over" || look === "under" ? look : undefined;
}

let applied = new Set<string>();

/**
 * Applies the host's context to the document; called again with each change it sends. The host's
 * light or dark always applies. Its colours, radius and faces apply only where the page's theme
 * stack names `"host"` (D181 item 5, amending D175 item 6): last in the stack, over everything (on
 * the root's own style); before the page's own layers, under them (a rule of no specificity after
 * the theme's, which any rule of the page's outranks).
 */
export function applyHostContext(context: McpHostContext): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = context["theme"];
  if (theme === "light" || theme === "dark") {
    root.dataset["appearance"] = theme;
    root.style.colorScheme = theme;
  }
  const placement = hostLook(root);
  if (placement === undefined) return;
  const styles = context["styles"] as
    | { variables?: Record<string, unknown>; css?: { fonts?: unknown } }
    | undefined;
  if (styles === undefined) return;
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(styles.variables ?? {})) {
    if (!PROPERTY.test(name) || typeof value !== "string" || value.length > VALUE_MAX) continue;
    if (BREAKS.test(value)) continue;
    values.set(name, value);
  }
  for (const [token, sources] of Object.entries(tokenTable())) {
    const source = sources.find((name) => values.has(name));
    if (source !== undefined) values.set(token, `var(${source})`);
  }
  if (placement === "over") {
    for (const [name, value] of values) root.style.setProperty(name, value);
    // A variable the host no longer gives goes back to the page's own value.
    for (const name of applied) if (!values.has(name)) root.style.removeProperty(name);
    applied = new Set(values.keys());
  } else {
    let rule = document.getElementById("mostra-host-look");
    if (rule === null) {
      rule = document.createElement("style");
      rule.id = "mostra-host-look";
      document.head.append(rule);
    }
    const lines = [...values].map(([name, value]) => `  ${name}: ${value};`);
    rule.textContent = [":where(:root) {", ...lines, "}"].join("\n");
  }
  const fonts = styles.css?.fonts;
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
