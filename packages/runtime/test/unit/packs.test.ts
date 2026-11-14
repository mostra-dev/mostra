/**
 * Placing a pack's files and CSS as shadcn 4.23.0 places them (EX-03), checked against what the
 * real `shadcn add` wrote for the same items (VERIFIED_FACTS, WP-16).
 */

import { describe, expect, it } from "vitest";
import {
  cssText,
  itemCss,
  placeFile,
  rewriteImports,
  withCssBlock,
} from "../../src/packs/index.ts";
import { parseItem } from "../../src/packs/read.ts";

const aliases = { components: "components", ui: "components/ui", lib: "lib", hooks: "hooks" };

describe("where an item's files land", () => {
  it("follows each file's type, its target and the aliases", () => {
    expect(
      placeFile({ path: "registry/new-york-v4/ui/button.tsx", type: "registry:ui" }, aliases),
    ).toBe("components/ui/button.tsx");
    expect(
      placeFile(
        {
          path: "registry/new-york-v4/blocks/login-01/components/login-form.tsx",
          type: "registry:component",
        },
        aliases,
      ),
    ).toBe("components/login-form.tsx");
    expect(
      placeFile({ path: "registry/new-york-v4/lib/utils.ts", type: "registry:lib" }, aliases),
    ).toBe("lib/utils.ts");
    expect(placeFile({ path: "x/use-copy.ts", type: "registry:hook" }, aliases)).toBe(
      "hooks/use-copy.ts",
    );
    expect(placeFile({ path: "a.md", type: "registry:file", target: "~/docs/a.md" }, aliases)).toBe(
      "docs/a.md",
    );
    expect(
      placeFile({ path: "x.tsx", type: "registry:ui", target: "@ui/fancy/x.tsx" }, aliases),
    ).toBe("components/ui/fancy/x.tsx");
    // Next.js's app router page becomes a page of pages/ (D57), and has no place without it.
    expect(
      placeFile({ path: "p.tsx", type: "registry:page", target: "app/login/page.tsx" }, aliases),
    ).toBe("pages/login.tsx");
    expect(
      placeFile(
        { path: "p.tsx", type: "registry:page", target: "app/login/page.tsx" },
        aliases,
        false,
      ),
    ).toBeUndefined();
    expect(() =>
      placeFile({ path: "x.tsx", type: "registry:ui", target: "@ui/../../x.tsx" }, aliases),
    ).toThrow(/leaves the ui alias/);
  });

  it("points registry imports at the files' places", () => {
    const placed = new Map([
      ["registry/new-york-v4/blocks/login-01/components/login-form", "components/login-form.tsx"],
    ]);
    expect(
      rewriteImports(
        'import { LoginForm } from "@/registry/new-york-v4/blocks/login-01/components/login-form";\nimport { Button } from "@/registry/new-york-v4/ui/button";\n',
        aliases,
        placed,
      ),
    ).toBe(
      'import { LoginForm } from "@/components/login-form";\nimport { Button } from "@/components/ui/button";\n',
    );
  });
});

describe("an item's CSS", () => {
  // The same item that `shadcn add` wrote into a stylesheet (VERIFIED_FACTS, WP-16).
  const item = parseItem(
    JSON.stringify({
      name: "vars",
      type: "registry:theme",
      cssVars: {
        theme: { "font-heading": "Jost, sans-serif", "radius-card": "1rem" },
        light: { badge: "oklch(0.7 0.1 140)", radius: "0.5rem" },
        dark: { badge: "oklch(0.5 0.1 140)" },
      },
      css: { "@layer base": { h1: { "font-weight": "600" } }, "@utility tag": { padding: "2px" } },
    }),
    "vars",
  );

  it("declares what shadcn declares: the theme, colours from light and dark, the radius scale", () => {
    const css = itemCss(item) as string;
    for (const line of [
      "@custom-variant dark (&:is(.dark *));",
      "--font-heading: Jost, sans-serif;",
      "--radius-card: 1rem;",
      "--color-badge: var(--badge);",
      "--radius-sm: calc(var(--radius) * 0.6);",
      "--radius-4xl: calc(var(--radius) * 2.6);",
      "--badge: oklch(0.7 0.1 140);",
      "--radius: 0.5rem;",
      "--badge: oklch(0.5 0.1 140);",
      "font-weight: 600;",
      "padding: 2px;",
    ]) {
      expect(css, line).toContain(line);
    }
    expect(css.indexOf(":root {")).toBeLessThan(css.indexOf(".dark {"));
    expect(cssText({ '@plugin "x"': {} })).toBe('@plugin "x";');
  });

  it("keeps one block per item, replaced when the item is added again", () => {
    const once = withCssBlock('@import "tailwindcss";\n', "vars", ":root {}");
    const twice = withCssBlock(once, "vars", ":root { --a: 1; }");
    expect(twice.match(/mostra add vars: begin/g)).toHaveLength(1);
    expect(twice).toContain("--a: 1;");
    expect(twice.startsWith('@import "tailwindcss";')).toBe(true);
  });
});
