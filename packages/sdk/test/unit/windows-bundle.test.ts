/**
 * Windows bundles (RT-12, D153): an archive with no links, whose `files.json` lists them and whose
 * setup makes each a junction at the bundle's real path, so an ordinary user (who can't create
 * symbolic links) installs one; a bundle moved since its setup is set up again. The junction
 * cases run on Windows only; the archive's refusal of links runs everywhere.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type BundleFiles, RpcError } from "@mostra/protocol";
import { c } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPinned } from "../../src/bundle/cache.ts";
import { extractBundle } from "../../src/bundle/extract.ts";
import { LinkRefused, makeJunctions } from "../../src/bundle/links.ts";
import { readBundle, readSetup, realRoot, setupBundle } from "../../src/bundle/setup.ts";
import { bundlePlatform } from "../../src/platform.ts";
import { resolveRuntime } from "../../src/runtime.ts";
import { LINK_PATH, pinsEnv, removeLink, syntheticBundle, tempDir, WINDOWS } from "../support.ts";

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir("mwin");
});
afterEach(() => dir.cleanup());

const code = (error: unknown): string | undefined =>
  error instanceof RpcError ? error.diagnostic.code : undefined;

describe("a Windows archive holds no links (D153)", () => {
  it("refuses an archive with a link when its links are made by setup", async () => {
    const top = "mostra-0.0.0-test-win32-x64";
    mkdirSync(join(dir.path, "src", top, "real"), { recursive: true });
    writeFileSync(join(dir.path, "src", top, "real", "a.js"), "a");
    symlinkSync("real", join(dir.path, "src", top, "link"), WINDOWS ? "junction" : "dir");
    const archive = join(dir.path, "with-link.tar.gz");
    await c({ gzip: true, file: archive, cwd: join(dir.path, "src"), portable: true }, [top]);
    mkdirSync(join(dir.path, "keep"));
    // A POSIX bundle's archive carries its links …
    if (!WINDOWS) {
      await extractBundle(archive, join(dir.path, "keep"), top, { links: "keep" });
      expect(lstatSync(join(dir.path, "keep", "link")).isSymbolicLink()).toBe(true);
    }
    // … a Windows one never does.
    mkdirSync(join(dir.path, "refuse"));
    const error = await extractBundle(archive, join(dir.path, "refuse"), top, {
      links: "refuse",
    }).catch((caught: unknown) => caught);
    expect(code(error)).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect((error as RpcError).diagnostic.message).toContain("link (SymbolicLink)");
  });
});

describe.runIf(WINDOWS)("a Windows bundle's junctions (D153)", () => {
  it("installs with no link in its archive and makes each listed link a junction inside it", async () => {
    const synthetic = await syntheticBundle(dir.path);
    expect(synthetic.platform.startsWith("win32-")).toBe(true);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release);
    const bundle = await installPinned(synthetic.pins(release), {
      env,
      platform: bundlePlatform(),
    });
    const link = join(bundle.root, LINK_PATH);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    // A junction: an absolute target, inside the bundle's own real path.
    expect(readlinkSync(link)).toBe(
      join(realRoot(bundle.root), "lib/node_modules/fake-playwright"),
    );
    expect(existsSync(join(link, "cli.js"))).toBe(true);
    const marker = await readSetup(bundle);
    expect(marker?.root).toBe(realRoot(bundle.root));
    // Every file a Windows tree lists is non-executable: Windows keeps no execute bit.
    const files = JSON.parse(readFileSync(join(bundle.root, "files.json"), "utf8")) as BundleFiles;
    expect(files.files.every((file) => !file.executable)).toBe(true);
    expect(files.links).toEqual([{ path: LINK_PATH, target: "../fake-playwright" }]);
  });

  it("sets a moved bundle up again, so its junctions point into where it is now", async () => {
    const synthetic = await syntheticBundle(dir.path);
    await setupBundle(synthetic.root, { env: { PATH: process.env["PATH"] ?? "" } });
    const moved = join(dir.path, "moved", "mostra");
    mkdirSync(join(dir.path, "moved"));
    renameSync(synthetic.root, moved);
    // The marker names the old root: the bundle isn't ready where it is now …
    expect(await readSetup(await readBundle(moved))).toBeUndefined();
    // … and finding the runtime sets it up again, which makes the junctions afresh.
    const runtime = await resolveRuntime({
      env: { PATH: process.env["PATH"] ?? "", MOSTRA_BUNDLE: moved },
    });
    expect(runtime.bundle?.root).toBe(moved);
    expect(readlinkSync(join(moved, LINK_PATH))).toBe(
      join(realRoot(moved), "lib/node_modules/fake-playwright"),
    );
    expect(existsSync(join(moved, LINK_PATH, "cli.js"))).toBe(true);
    expect((await readSetup(await readBundle(moved)))?.root).toBe(realRoot(moved));
  });

  it("sets up a copy a tool made by following the junctions, whose links are real directories (Opus review of WP-W3, finding 4)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    await setupBundle(synthetic.root, { env: { PATH: process.env["PATH"] ?? "" } });
    // As Explorer, Copy-Item and robocopy copy: each junction's contents, as a real directory.
    const copy = join(dir.path, "copied", "mostra");
    cpSync(synthetic.root, copy, { recursive: true, dereference: true });
    expect(lstatSync(join(copy, LINK_PATH)).isSymbolicLink()).toBe(false);
    await setupBundle(copy, { env: { PATH: process.env["PATH"] ?? "" } });
    expect(lstatSync(join(copy, LINK_PATH)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(copy, LINK_PATH))).toBe(
      join(realRoot(copy), "lib/node_modules/fake-playwright"),
    );
    expect((await readSetup(await readBundle(copy)))?.root).toBe(realRoot(copy));
  });

  it("two setups of one moved bundle at once both succeed (Opus review of WP-W3, finding 5)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    await setupBundle(synthetic.root, { env: { PATH: process.env["PATH"] ?? "" } });
    const moved = join(dir.path, "moved-twice", "mostra");
    mkdirSync(join(dir.path, "moved-twice"));
    renameSync(synthetic.root, moved);
    const manifest = JSON.parse(readFileSync(join(moved, "files.json"), "utf8")) as BundleFiles;
    const root = realRoot(moved);
    for (let round = 0; round < 10; round++) {
      // Each round leaves the links naming the old root again, so both calls replace them.
      await Promise.all([makeJunctions(root, manifest), makeJunctions(root, manifest)]);
      expect(readlinkSync(join(moved, LINK_PATH))).toBe(
        join(root, "lib/node_modules/fake-playwright"),
      );
      removeLink(join(moved, LINK_PATH));
      symlinkSync(join(dir.path, "elsewhere"), join(moved, LINK_PATH), "junction");
    }
  });

  it("refuses a directory where a link belongs, and removes nothing", async () => {
    const synthetic = await syntheticBundle(dir.path);
    removeLink(join(synthetic.root, LINK_PATH));
    mkdirSync(join(synthetic.root, LINK_PATH));
    writeFileSync(join(synthetic.root, LINK_PATH, "keep.txt"), "mine");
    const error = await setupBundle(synthetic.root, {
      env: { PATH: process.env["PATH"] ?? "" },
    }).catch((caught: unknown) => caught);
    expect(code(error)).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(readFileSync(join(synthetic.root, LINK_PATH, "keep.txt"), "utf8")).toBe("mine");
  });

  it("makes no link that leaves the bundle, or that names a file", async () => {
    const root = join(dir.path, "tree");
    mkdirSync(join(root, "lib", "real"), { recursive: true });
    writeFileSync(join(root, "lib", "a.js"), "a");
    const digest = createHash("sha256").update("a").digest("hex");
    const manifest = (target: string): BundleFiles => ({
      schemaVersion: 1,
      files: [{ path: "lib/a.js", size: 1, sha256: digest, executable: false }],
      links: [{ path: "lib/link", target }],
    });
    for (const target of ["../../outside", "..\\..\\outside", "a.js", "missing"]) {
      await expect(makeJunctions(realRoot(root), manifest(target)), target).rejects.toBeInstanceOf(
        LinkRefused,
      );
      expect(existsSync(join(root, "lib", "link")), target).toBe(false);
    }
    await makeJunctions(realRoot(root), manifest("real"));
    expect(readlinkSync(join(root, "lib", "link"))).toBe(join(realRoot(root), "lib", "real"));
  });
});
