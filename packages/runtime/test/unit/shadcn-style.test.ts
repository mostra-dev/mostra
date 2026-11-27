/**
 * #219 (WP-19): `mostra add` rewrites an item of shadcn's `base-nova` and `radix-nova` styles as
 * shadcn 4.23.0's CLI does. Two proofs, both over every file of every item the kit pins of both
 * styles (`packages/kit/upstream/shadcn/`):
 * - with the options a Mostra artifact has (lucide, the default menu colour, left to right, the
 *   theme's `--font-heading`), the result is byte for byte what shadcn's own CLI wrote
 *   (`upstream/shadcn/<style>/installed/`);
 * - for every other option `components.json` can give (each icon library, each menu colour, right
 *   to left, no heading face), the result is byte for byte what shadcn's own transformers
 *   (`@shadcn/registry` 0.2.1, the version that CLI runs) make of the same file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformCleanup } from "@shadcn/registry/internal/transformers/transform-cleanup";
import { transformFont } from "@shadcn/registry/internal/transformers/transform-font";
import { transformIcons } from "@shadcn/registry/internal/transformers/transform-icons";
import { transformMenu } from "@shadcn/registry/internal/transformers/transform-menu";
import { transformRtl } from "@shadcn/registry/internal/transformers/transform-rtl";
import { twMerge } from "cn";
import { describe, expect, it } from "vitest";
import { type StyleOptions, shadcnStyleTransform } from "../../src/packs/shadcn-style.ts";

const UPSTREAM = fileURLToPath(new URL("../../../kit/upstream/shadcn/", import.meta.url));
const FOLDER: Readonly<Record<string, string>> = {
  "registry:ui": "ui",
  "registry:lib": "lib",
  "registry:hook": "hooks",
};

interface StyledFile {
  readonly style: string;
  readonly name: string;
  /** The item's file as shadcn's registry serves it, its imports pointed at the default aliases. */
  readonly raw: string;
  /** What shadcn 4.23.0's CLI wrote for it. */
  readonly installed: string;
}

function styledFiles(): StyledFile[] {
  const files: StyledFile[] = [];
  for (const style of ["base-nova", "radix-nova"]) {
    for (const entry of readdirSync(join(UPSTREAM, style)).filter((f) => f.endsWith(".json"))) {
      const item = JSON.parse(readFileSync(join(UPSTREAM, style, entry), "utf8")) as {
        files?: { path: string; type: string; content?: string }[];
      };
      for (const file of item.files ?? []) {
        if (typeof file.content !== "string") continue;
        const name = file.path.split("/").pop() as string;
        let installed: string;
        try {
          installed = readFileSync(
            join(UPSTREAM, style, "installed", FOLDER[file.type] ?? "ui", name),
            "utf8",
          );
        } catch {
          continue;
        }
        // What `rewriteImports` does first, as shadcn's `transformImport` does.
        const raw = file.content.replace(/@\/registry\/[a-z-]+\/(ui|lib|hooks)\//g, (_m, kind) =>
          kind === "ui" ? "@/components/ui/" : `@/${kind}/`,
        );
        files.push({ style, name, raw, installed });
      }
    }
  }
  return files;
}

/** shadcn's own pipeline for one file, as its CLI runs it. */
async function shadcn(file: StyledFile, options: StyleOptions): Promise<string> {
  const config = {
    style: file.style,
    iconLibrary: options.iconLibrary,
    menuColor: options.menuColor,
    rtl: options.rtl,
    rsc: true,
    tsx: true,
    resolvedPaths: { tailwindCss: "" },
  };
  let code = file.raw;
  for (const transform of [
    transformIcons,
    transformMenu,
    transformRtl,
    transformFont,
    transformCleanup,
  ]) {
    code = await (transform as (c: string, o: Record<string, unknown>) => string | Promise<string>)(
      code,
      {
        config,
        filename: file.name,
        supportedFontMarkers: options.fontHeading ? ["cn-font-heading"] : [],
      },
    );
  }
  return code;
}

const MOSTRA: StyleOptions = {
  iconLibrary: "lucide",
  menuColor: "default",
  rtl: false,
  fontHeading: true,
};
const FILES = styledFiles();

describe("shadcn's styled items as its CLI installs them (#219)", () => {
  it("reads every file of the pinned base-nova and radix-nova items", () => {
    // 65 items per style; the count moves only with a refresh of the pins.
    expect(FILES.length).toBeGreaterThan(130);
    expect(FILES.filter((f) => /IconPlaceholder/.test(f.raw)).length).toBeGreaterThan(40);
  });

  it("writes every file byte for byte as shadcn 4.23.0's CLI did", () => {
    const differing = FILES.filter(
      (file) => shadcnStyleTransform(file.raw, MOSTRA, twMerge) !== file.installed,
    ).map((file) => `${file.style}/${file.name}`);
    expect(differing).toEqual([]);
  });

  const variants: readonly [string, Partial<StyleOptions>][] = [
    ...["tabler", "hugeicons", "phosphor", "remixicon"].map(
      (iconLibrary): [string, Partial<StyleOptions>] => [
        `icons from ${iconLibrary}`,
        { iconLibrary },
      ],
    ),
    ...["inverted", "default-translucent", "inverted-translucent"].map(
      (menuColor): [string, Partial<StyleOptions>] => [`${menuColor} menus`, { menuColor }],
    ),
    ["right to left", { rtl: true }],
    ["no heading face", { fontHeading: false }],
  ];
  for (const [name, change] of variants) {
    it(`matches shadcn's own transformers with ${name}`, async () => {
      const options = { ...MOSTRA, ...change };
      const differing: string[] = [];
      for (const file of FILES) {
        if ((await shadcn(file, options)) !== shadcnStyleTransform(file.raw, options, twMerge)) {
          differing.push(`${file.style}/${file.name}`);
        }
      }
      expect(differing).toEqual([]);
    }, 120_000);
  }
});
