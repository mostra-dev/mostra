/**
 * The kit's changes to the shadcn items it pins, the same for both bases (D27: two bases cost CI
 * time, not duplicate code). `CLASS_CHANGES` replaces a class string wherever it appears with the
 * kit's token contract (D178 item 3), so a theme's shape, depth and type reach every part;
 * `FILE_CHANGES` adapts what an item assumes about its project to an artifact's.
 */

/** Class strings, each as shadcn writes it, and what the kit writes instead. */
export const CLASS_CHANGES: readonly (readonly [from: string, to: string])[] = [];

/** How a page's appearance reaches the toaster: Mostra's, not `next-themes`'. */
const SONNER_APPEARANCE = `import * as React from "react"

/** The page's appearance as Mostra sets it on \`<html data-appearance>\`, else the device's. */
function useAppearance(): ToasterProps["theme"] {
  const read = (): ToasterProps["theme"] => {
    const value = typeof document === "undefined" ? undefined : document.documentElement.dataset["appearance"]
    return value === "light" || value === "dark" ? value : "system"
  }
  const [appearance, setAppearance] = React.useState(read)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setAppearance(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] })
    return () => observer.disconnect()
  }, [])
  return appearance
}
`;

/** Whole-file changes by installed path, given the base. */
export const FILE_CHANGES: Readonly<Record<string, (code: string, base: string) => string>> = {
  // The Base UI item imports React and never uses it (TS6133 under an artifact's own
  // `noUnusedLocals`; VERIFIED_FACTS, kit components).
  "components/ui/scroll-area.tsx": (code, base) =>
    base === "base" ? code.replace(/^import \* as React from "react"\n/m, "") : code,
  // An artifact has no `next-themes`: the toaster follows the page's appearance instead.
  "components/ui/sonner.tsx": (code) => {
    const out = code
      .replace('import { useTheme } from "next-themes"\n', "")
      .replace(/(import \{[^}]*\} from "lucide-react"\n)/, `$1\n${SONNER_APPEARANCE}`)
      .replace('  const { theme = "system" } = useTheme()\n', "  const theme = useAppearance()\n")
      .replace('theme={theme as ToasterProps["theme"]}', "theme={theme}");
    if (out.includes("next-themes") || !out.includes("useAppearance()")) {
      throw new Error("sonner.tsx no longer reads its theme the way the kit's change expects.");
    }
    return out;
  },
};
