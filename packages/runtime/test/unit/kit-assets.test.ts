/**
 * `mostra dev`'s kit assets (WP-19, D186 item 5): the dev server serves exactly the files a build
 * of the version carries at `/kit-assets/`, so a directory the kit leaves out (Excalidraw's CJK
 * face) is left out in dev too (Opus review of WP-19, finding 10), and nothing outside the asset's
 * directory, by `..` or by a link.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devAssetFile } from "../../src/builder/child/kit.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "mostra-kit-assets-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const dir = join(root, "package", "dist", "prod", "fonts");
mkdirSync(join(dir, "Virgil"), { recursive: true });
mkdirSync(join(dir, "Xiaolai"), { recursive: true });
writeFileSync(join(dir, "Virgil", "Virgil.woff2"), "face");
writeFileSync(join(dir, "Xiaolai", "Xiaolai-1.woff2"), "cjk");
writeFileSync(join(root, "secret.txt"), "not a font");
// A link out of the directory (a junction on Windows, which needs no privilege there).
symlinkSync(root, join(dir, "Virgil", "out"), "junction");

const sets = [
  {
    asset: {
      package: "@excalidraw/excalidraw",
      from: "dist/prod/fonts",
      to: "excalidraw/fonts",
      skip: ["Xiaolai"],
    },
    dir,
  },
];

describe("the files mostra dev serves at /kit-assets/ (KT-01)", () => {
  it("serves an asset's file by its real path", () => {
    expect(devAssetFile(sets, "/kit-assets/excalidraw/fonts/Virgil/Virgil.woff2?v=1")).toBe(
      join(dir, "Virgil", "Virgil.woff2"),
    );
  });

  it("leaves out the directories the build leaves out (Opus review of WP-19, finding 10)", () => {
    expect(
      devAssetFile(sets, "/kit-assets/excalidraw/fonts/Xiaolai/Xiaolai-1.woff2"),
    ).toBeUndefined();
  });

  it("serves nothing outside the asset's directory, nor a name it can't read", () => {
    expect(
      devAssetFile(sets, "/kit-assets/excalidraw/fonts/../../../../secret.txt"),
    ).toBeUndefined();
    expect(
      devAssetFile(sets, "/kit-assets/excalidraw/fonts/Virgil/out/secret.txt"),
    ).toBeUndefined();
    expect(devAssetFile(sets, "/kit-assets/excalidraw/fonts/%E0%A4%A")).toBeUndefined();
    expect(devAssetFile(sets, "/kit-assets/excalidraw/fonts/Virgil/none.woff2")).toBeUndefined();
    expect(devAssetFile(sets, "/kit-assets/other/Virgil.woff2")).toBeUndefined();
  });
});
