import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  appearanceCookie,
  contrast,
  createPages,
  defineTheme,
  html,
  mostra,
  oklch,
  oklchToHex,
  type Palette,
  readAppearance,
  renderMail,
  safeHref,
  studio,
  THEME_REVISION,
  type Theme,
  ThemeError,
  tailwindStylesheet,
  themeStylesheet,
} from "@mostra/themes";
import { describe, expect, it } from "vitest";

describe("colours", () => {
  it("converts OKLCH to the brand's published hex values", () => {
    // B41's table: blu, rosso, nero, and Studio's pietra 600 (D141).
    expect(oklchToHex(0.45, 0.212, 267.0)).toBe("#2340c8");
    expect(oklchToHex(0.603, 0.218, 32.2)).toBe("#e63312");
    expect(oklchToHex(0.191, 0, 0)).toBe("#141414");
    expect(oklchToHex(0.466, 0.008, 106.7)).toBe("#5a5a55");
  });

  it("measures contrast as WCAG 2 defines it", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#2340c8", "#ffffff")).toBeGreaterThan(7.9);
    expect(contrast("#2340c8", "#ffffff")).toBeLessThan(8.1);
  });
});

describe("Mostra's themes", () => {
  for (const theme of [studio, mostra]) {
    it(`${theme.id} holds WCAG 2.2 AA in both modes`, () => {
      // defineTheme ran when the module loaded; run it again on a copy to see it pass.
      expect(() => defineTheme({ ...theme })).not.toThrow();
      for (const mode of ["light", "dark"] as const) {
        const palette = theme.modes[mode];
        expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.input, palette.card)).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("keeps the brand's blu as the main action and giallo as the answer (D141)", () => {
    expect(studio.modes.light.primary.hex).toBe("#2340c8");
    expect(studio.modes.light.answer.hex).toMatch(/^#f5b70[01]$/);
    expect(mostra.stage?.light.background.hex).toBe("#2340c8");
  });
});

describe("defineTheme", () => {
  const broken = (change: (palette: Palette) => Palette): Theme => ({
    ...studio,
    id: "broken",
    modes: { light: change(studio.modes.light), dark: studio.modes.dark },
  });

  it("refuses text below WCAG 2.2 AA, naming the pair and the ratio", () => {
    const pale = broken((palette) => ({ ...palette, mutedForeground: oklch(0.8, 0, 0) }));
    expect(() => defineTheme(pale)).toThrow(ThemeError);
    try {
      defineTheme(pale);
    } catch (error) {
      expect((error as ThemeError).problems.join("\n")).toMatch(
        /light: mutedForeground on background is \d\.\d\d:1, below WCAG 2\.2 AA's 4\.5:1/,
      );
    }
  });

  it("refuses a control edge below 3:1", () => {
    const faint = broken((palette) => ({ ...palette, input: oklch(0.92, 0.008, 106.6) }));
    expect(() => defineTheme(faint)).toThrow(/input on card/);
  });

  it("refuses a hex that isn't its OKLCH, an id that isn't one and a newer revision", () => {
    const lying = broken((palette) => ({
      ...palette,
      primary: { oklch: [0.45, 0.212, 267], hex: "#ff0000" },
    }));
    expect(() => defineTheme(lying)).toThrow(/primary: hex #ff0000 isn't oklch/);
    expect(() => defineTheme({ ...studio, id: "Not An Id" })).toThrow(/isn't a theme id/);
    expect(() => defineTheme({ ...studio, revision: "9999-01-01" })).toThrow(
      /newer than this renderer/,
    );
    expect(THEME_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("stylesheets", () => {
  it("are deterministic and give every role, light, dark and a person's choice", () => {
    const css = themeStylesheet(studio);
    expect(themeStylesheet(studio)).toBe(css);
    for (const variable of [
      "--background",
      "--card-foreground",
      "--primary",
      "--answer",
      "--chart-6",
      "--font-display",
      "--radius",
    ]) {
      expect(css).toContain(`${variable}:`);
    }
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-appearance="light"])');
    expect(css).toContain(':root[data-appearance="dark"]');
    expect(css).toContain('src: url("./fonts/figtree-latin-wght-normal.woff2")');
  });

  it("give the Agent Skill its Studio stylesheet", () => {
    const skill = readFileSync(
      new URL("../../../skills/mostra/assets/studio.css", import.meta.url),
      "utf8",
    );
    expect(skill, "run `pnpm --filter @mostra/themes generate`").toBe(tailwindStylesheet(studio));
  });

  it("ship as files that equal what the themes generate", () => {
    for (const theme of [studio, mostra]) {
      const file = readFileSync(new URL(`../css/${theme.id}.css`, import.meta.url), "utf8");
      expect(file, `run \`pnpm --filter @mostra/themes generate\``).toBe(
        themeStylesheet(theme, { assetBase: "../" }),
      );
    }
  });
});

describe("html", () => {
  it("escapes every interpolated value and keeps markup made by html", () => {
    const name = `<img src=x onerror="alert(1)">'&`;
    expect(html`<p>${name}</p>`.value).toBe(
      "<p>&#60;img src=x onerror=&#34;alert(1)&#34;&#62;&#39;&#38;</p>",
    );
    expect(html`<p>${html`<b>${name.length}</b>`}</p>`.value).toBe("<p><b>32</b></p>");
    expect(html`${["a", html`<i>b</i>`, null, false, undefined]}`.value).toBe("a<i>b</i>");
  });
});

describe("pages", () => {
  const pages = createPages({
    theme: studio,
    identity: { name: "Acme <Pages>" },
    assetBase: "/_mostra/theme/",
    appearanceAction: "/_mostra/appearance",
    madeWithHref: "https://mostradev.com",
    footer: [
      { href: "https://acme.example/terms", text: "Terms" },
      { href: "javascript:alert(1)", text: "Evil" },
    ],
  });

  it("render tenant and operator strings as text, with no script and no inline style", () => {
    const page = pages.render({
      kind: "task",
      title: `Sign in to ${"‮elgooG"} ${"x".repeat(256)}`,
      body: html`<p>${"<script>alert(1)</script>"}</p>`,
      appearance: "dark",
      path: "/device?user_code=AB&x=<1>",
    });
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/\sstyle=/);
    expect(page).not.toMatch(/\son[a-z]+=/i);
    expect(page).toContain("Acme &#60;Pages&#62;");
    expect(page).toContain("&#60;script&#62;");
    expect(page).not.toContain("javascript:");
    expect(page).toContain('data-appearance="dark"');
    expect(page).toContain('value="/device?user_code=AB&#38;x=&#60;1&#62;"');
    expect(page).toContain("Runs on Mostra");
  });

  it("lay out a workspace under a bar of its sections, the current one marked, unsafe ones dropped", () => {
    const page = pages.render({
      kind: "workspace",
      title: "Your account",
      sections: [
        { href: "/account", label: "Account", current: true },
        { href: "/account/sign-in", label: "Sign-in" },
        { href: "javascript:alert(1)", label: "Evil" },
      ],
      body: html`<p>Nothing here yet.</p>`,
    });
    expect(page).toContain('data-page="workspace"');
    expect(page).toContain('<a href="/account" aria-current="page">Account</a>');
    expect(page).toContain('<a href="/account/sign-in">Sign-in</a>');
    expect(page).not.toContain("Evil");
    expect(page).not.toMatch(/<script/i);
  });

  it("dress a server in Mostra's theme with the stage and no 'Runs on Mostra'", () => {
    const own = createPages({
      theme: mostra,
      identity: { name: "Mostra", stageLine: "Let your agent show you." },
      assetBase: "/a/",
    });
    const page = own.render({ kind: "task", title: "Sign in to Mostra" });
    expect(page).toContain('class="m-stage"');
    expect(page).toContain("/a/marks/wordmark-on-blu.svg");
    expect(page).not.toContain("Runs on Mostra");
  });

  it("serve their stylesheet, faces and marks from the page's own origin, every file present", () => {
    expect(pages.csp).toContain("style-src 'self'");
    expect(pages.csp).not.toContain("unsafe-inline");
    const stylesheet = pages.assets.find((asset) => asset.contentType.startsWith("text/css"));
    expect(stylesheet?.path).toMatch(/^pages-studio-[0-9a-z]+\.css$/);
    for (const asset of pages.assets) {
      if ("fileUrl" in asset.body)
        expect(readFileSync(new URL(asset.body.fileUrl)).length).toBeGreaterThan(100);
    }
  });

  it("allow links only to https:, loopback http: and the page's own paths", () => {
    expect(safeHref("https://mostradev.com/x")).toBe("https://mostradev.com/x");
    expect(safeHref("/signin/github/start?next=%2F")).toBe("/signin/github/start?next=%2F");
    expect(safeHref("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
    for (const bad of [
      "javascript:alert(1)",
      "//evil.example",
      "/\\evil.example",
      "http://evil.example",
      "data:text/html,x",
      "",
    ]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });

  it("keep a person's appearance in a host-only cookie and read it back", () => {
    expect(appearanceCookie("dark", true)).toBe(
      "__Host-mostra-appearance=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(readAppearance("a=b; __Host-mostra-appearance=dark")).toBe("dark");
    expect(readAppearance("mostra-appearance=light")).toBe("light");
    expect(readAppearance("mostra-appearance=<x>")).toBe("system");
    expect(readAppearance(undefined, "light")).toBe("light");
  });
});

describe("mail", () => {
  it("writes HTML with a plain-text part that carries the whole message", () => {
    const mail = renderMail(
      studio,
      { name: "Mostra" },
      {
        subject: "You've used 80% of this month's allowance",
        preheader: "Pages keep working; new ones wait at 100%.",
        heading: "80% of this month's allowance used",
        paragraphs: [
          "Your pages keep working.",
          html`See <a href="https://mostradev.com/usage">your usage</a>.`,
        ],
        action: { href: "https://mostradev.com/pricing", label: "See plans" },
        footer: ["You get this because you own a Mostra account."],
      },
    );
    expect(mail.html).not.toMatch(/<script/i);
    expect(mail.html).toContain("#2340c8");
    expect(mail.text).toContain("Your pages keep working.");
    expect(mail.text).toContain("See your usage (https://mostradev.com/usage).");
    expect(mail.text).toContain("See plans: https://mostradev.com/pricing");
  });
});

describe("faces", () => {
  // The files are fontsource 5.3.0's, SIL OFL 1.1 (VERIFIED_FACTS, UX-01): a changed byte is a
  // changed font, which needs its own check and record.
  const PINNED: Record<string, string> = {
    "figtree-latin-wght-normal.woff2":
      "4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd",
    "figtree-latin-ext-wght-normal.woff2":
      "bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965",
    "jost-latin-wght-normal.woff2":
      "7726a5cd6f3c0e876c028ea2a643d45f7aad4b0f164b70966c669f4a4668f4b9",
    "jost-latin-ext-wght-normal.woff2":
      "312ef2b80cefd8d6fd0e8553536862e7103f80be117a5aeba333dac68e4c0a6a",
    "spline-sans-mono-latin-wght-normal.woff2":
      "46b7dcafe3e51dbe87be1bafaac3fed7646db1fe0a146647a6ffce3699f2752d",
    "spline-sans-mono-latin-ext-wght-normal.woff2":
      "0ca9a3989044d1f9b4da1f303cea3c3091f5cb02fe54da04fd51fceaf676ecf9",
  };
  it("are the pinned files, each with its licence", () => {
    for (const [file, sha] of Object.entries(PINNED)) {
      const bytes = readFileSync(new URL(`../fonts/${file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(sha);
    }
    for (const licence of ["OFL-Figtree.txt", "OFL-Jost.txt", "OFL-SplineSansMono.txt"]) {
      expect(readFileSync(new URL(`../fonts/${licence}`, import.meta.url), "utf8")).toContain(
        "SIL OPEN FONT LICENSE Version 1.1",
      );
    }
  });
});
