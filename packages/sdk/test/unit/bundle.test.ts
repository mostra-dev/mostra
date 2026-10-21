import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RpcError } from "@mostra/protocol";
import {
  bundleDir,
  bundlePlatform,
  checkFiles,
  checkTree,
  describeTree,
  installPinned,
  readBundle,
  readSetup,
  resolveRuntime,
  setupBundle,
} from "@mostra/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_FILE, fileServer, pinsEnv, syntheticBundle, tempDir } from "../support.ts";

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir("msdk");
});
afterEach(() => dir.cleanup());

/** The diagnostic code an install failed with. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("expected a failure");
}

/** Every name in the cache's bundles directory. */
function cached(env: Record<string, string>): string[] {
  const bundles = join(env["MOSTRA_CACHE_DIR"] as string, "bundles");
  return existsSync(bundles) ? readdirSync(bundles) : [];
}

describe("installing a pinned bundle (RT-01)", () => {
  it("downloads, checks, sets up and caches the bundle by its digest; later uses never fetch it again", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const log = join(dir.path, "installs.log");
    const env = pinsEnv(dir.path, synthetic, pathToFileURL(dir.path).href, {
      FAKE_INSTALL_LOG: log,
    });
    const steps: string[] = [];
    const bundle = await installPinned(synthetic.pins(pathToFileURL(dir.path).href), {
      env,
      platform: bundlePlatform(),
      onProgress: (progress) => steps.push(progress.step),
    });
    expect(bundle.root).toBe(bundleDir(env, synthetic.sha256));
    expect(steps).toEqual(expect.arrayContaining(["download", "extract", "files", "browser"]));
    expect(await readSetup(bundle)).toMatchObject({
      version: "0.0.0-test",
      browser: { revision: "1" },
    });
    expect(existsSync(join(bundle.root, "browsers", BROWSER_FILE))).toBe(true);
    // Nothing but the bundle and its lock's absence: no archive, no scratch directory.
    expect(cached(env)).toEqual([synthetic.sha256]);
    // The second use finds it ready: no download (the archive is gone) and no browser install.
    const { rmSync } = await import("node:fs");
    rmSync(synthetic.archive);
    const again = await installPinned(synthetic.pins(pathToFileURL(dir.path).href), {
      env,
      platform: bundlePlatform(),
    });
    expect(again.root).toBe(bundle.root);
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses an archive whose bytes differ from the pin, and leaves nothing behind", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const bytes = readFileSync(synthetic.archive);
    bytes[bytes.length - 10] = (bytes[bytes.length - 10] as number) ^ 0xff;
    writeFileSync(synthetic.archive, bytes);
    const env = pinsEnv(dir.path, synthetic, pathToFileURL(dir.path).href);
    expect(
      await failure(
        installPinned(synthetic.pins(pathToFileURL(dir.path).href), {
          env,
          platform: bundlePlatform(),
        }),
      ),
    ).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(cached(env)).toEqual([]);
  });

  it("refuses a well-formed archive of the pinned size whose SHA-256 isn't the pinned one", async () => {
    // Nothing but the digest check can refuse it: the archive extracts and checks cleanly.
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const pins = synthetic.pins(release);
    const platform = bundlePlatform();
    const asset = pins.assets[platform];
    if (!asset) throw new Error("no asset for this platform");
    const wrong = { ...pins, assets: { [platform]: { ...asset, sha256: "0".repeat(64) } } };
    const env = pinsEnv(dir.path, synthetic, release);
    let message = "";
    try {
      await installPinned(wrong, { env, platform });
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      expect(error.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
      message = error.diagnostic.message;
    }
    expect(message).toContain("not the pinned");
    expect(cached(env)).toEqual([]);
  });

  it("refuses an archive larger than its pin as soon as it passes it", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const pins = synthetic.pins(pathToFileURL(dir.path).href);
    const asset = pins.assets[synthetic.platform];
    const shrunk = { ...pins, assets: { [synthetic.platform]: { ...asset, size: 100 } } };
    const env = pinsEnv(dir.path, synthetic, pathToFileURL(dir.path).href);
    expect(await failure(installPinned(shrunk, { env, platform: bundlePlatform() }))).toBe(
      "MOSTRA_ENV_BUNDLE_INVALID",
    );
  });

  it("refuses a correctly pinned archive whose files differ from its own file list", async () => {
    const synthetic = await syntheticBundle(dir.path, {
      afterListing: (root) =>
        writeFileSync(
          join(root, "lib/node_modules/@mostra/runtime/dist/bin.js"),
          "// NOT run by unit tests\n",
        ),
    });
    const env = pinsEnv(dir.path, synthetic, pathToFileURL(dir.path).href);
    const error = await installPinned(synthetic.pins(pathToFileURL(dir.path).href), {
      env,
      platform: bundlePlatform(),
    }).catch((caught: RpcError) => caught);
    expect((error as RpcError).diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect((error as RpcError).diagnostic.message).toContain(
      "runtime/dist/bin.js: its SHA-256 differs",
    );
    expect(cached(env)).toEqual([]);
  });

  it("refuses a file the list doesn't name, and an entry outside the bundle's directory", async () => {
    const extra = await syntheticBundle(dir.path, {
      afterListing: (root) => writeFileSync(join(root, "lib/smuggled.js"), "evil\n"),
    });
    const env = pinsEnv(dir.path, extra, pathToFileURL(dir.path).href);
    const error = await installPinned(extra.pins(pathToFileURL(dir.path).href), {
      env,
      platform: bundlePlatform(),
    }).catch((caught: RpcError) => caught);
    expect((error as RpcError).diagnostic.message).toContain(
      "lib/smuggled.js: not in the bundle's file list",
    );

    const other = tempDir("msdk-out");
    try {
      writeFileSync(join(other.path, "outside.txt"), "x");
      const outside = await syntheticBundle(other.path, { extraEntries: ["outside.txt"] });
      const env2 = pinsEnv(other.path, outside, pathToFileURL(other.path).href);
      const refused = await installPinned(outside.pins(pathToFileURL(other.path).href), {
        env: env2,
        platform: bundlePlatform(),
      }).catch((caught: RpcError) => caught);
      expect((refused as RpcError).diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
      expect((refused as RpcError).diagnostic.message).toContain("outside.txt");
    } finally {
      other.cleanup();
    }
  });

  it("refuses a browser whose files differ from the bundle's pin, and keeps the bundle unready", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const env = pinsEnv(dir.path, synthetic, pathToFileURL(dir.path).href, {
      FAKE_BROWSER_CONTENT: "a different browser\n",
    });
    const error = await installPinned(synthetic.pins(pathToFileURL(dir.path).href), {
      env,
      platform: bundlePlatform(),
    }).catch((caught: RpcError) => caught);
    expect((error as RpcError).diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect((error as RpcError).diagnostic.message).toContain(BROWSER_FILE);
    const root = bundleDir(env, synthetic.sha256);
    expect(await readSetup(await readBundle(root))).toBeUndefined();
  });

  it("finishes a bundle whose browser couldn't be fetched once the network is back, without downloading it again", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const failing = pinsEnv(dir.path, synthetic, release, { FAKE_BROWSER_FAIL: "1" });
    expect(
      await failure(
        installPinned(synthetic.pins(release), { env: failing, platform: bundlePlatform() }),
      ),
    ).toBe("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED");
    const { rmSync } = await import("node:fs");
    rmSync(synthetic.archive);
    const env = { ...failing, FAKE_BROWSER_FAIL: "" };
    const bundle = await installPinned(synthetic.pins(release), {
      env,
      platform: bundlePlatform(),
    });
    expect(await readSetup(bundle)).toBeDefined();
  });

  it("works offline from the cache, and says so plainly when the cache lacks the bundle", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release, { MOSTRA_OFFLINE: "1" });
    expect(
      await failure(installPinned(synthetic.pins(release), { env, platform: bundlePlatform() })),
    ).toBe("MOSTRA_ENV_BUNDLE_UNAVAILABLE");
    await installPinned(synthetic.pins(release), {
      env: { ...env, MOSTRA_OFFLINE: "0" },
      platform: bundlePlatform(),
    });
    const bundle = await installPinned(synthetic.pins(release), {
      env,
      platform: bundlePlatform(),
    });
    expect(await readSetup(bundle)).toBeDefined();
  });

  it("downloads over HTTP from a mirror, retries a server error and gives up at once on a 404", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const bytes = readFileSync(synthetic.archive);
    const flaky = await fileServer((_req, res, count) => {
      if (count === 1) res.writeHead(503).end();
      else res.writeHead(200, { "content-length": bytes.length }).end(bytes);
    });
    try {
      const env = pinsEnv(dir.path, synthetic, "https://release.invalid/v0", {
        MOSTRA_BUNDLE_MIRROR: `${flaky.url}/mirror/`,
      });
      const bundle = await installPinned(synthetic.pins("https://release.invalid/v0"), {
        env,
        platform: bundlePlatform(),
      });
      expect(await readSetup(bundle)).toBeDefined();
      expect(flaky.requests()).toBe(2);
    } finally {
      await flaky.close();
    }
    const missing = await fileServer((_req, res) => res.writeHead(404).end());
    try {
      const env = pinsEnv(dir.path, synthetic, missing.url, {
        MOSTRA_CACHE_DIR: join(dir.path, "cache2"),
      });
      const started = Date.now();
      const error = await installPinned(synthetic.pins(missing.url), {
        env,
        platform: bundlePlatform(),
      }).catch((caught: RpcError) => caught);
      expect((error as RpcError).diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED");
      expect((error as RpcError).diagnostic.message).toContain("HTTP 404");
      expect(missing.requests()).toBe(1);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await missing.close();
    }
  });

  it("downloads once for installers racing on one bundle, and both get it", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const bytes = readFileSync(synthetic.archive);
    const server = await fileServer((_req, res) => {
      // Slow enough that both installers are waiting at once.
      setTimeout(() => res.writeHead(200).end(bytes), 300);
    });
    try {
      const log = join(dir.path, "installs.log");
      const env = pinsEnv(dir.path, synthetic, server.url, { FAKE_INSTALL_LOG: log });
      const install = (): ReturnType<typeof installPinned> =>
        installPinned(synthetic.pins(server.url), { env, platform: bundlePlatform() });
      const [first, second] = await Promise.all([install(), install()]);
      expect(first.root).toBe(second.root);
      expect(server.requests()).toBe(1);
      expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
      expect(cached(env)).toEqual([synthetic.sha256]);
    } finally {
      await server.close();
    }
  });

  it("touches its lock while the install runs, so a long install is never taken from it (Opus review of WP-12, finding 10)", async () => {
    const { existsSync, statSync, utimesSync } = await import("node:fs");
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      const synthetic = await syntheticBundle(dir.path);
      const release = pathToFileURL(dir.path).href;
      const env: Record<string, string> = {
        ...pinsEnv(dir.path, synthetic, release),
        FAKE_BROWSER_SLEEP_MS: "3000",
      };
      const lockPath = join(
        env["MOSTRA_CACHE_DIR"] as string,
        "bundles",
        `${synthetic.sha256}.lock`,
      );
      const install = installPinned(synthetic.pins(release), { env, platform: bundlePlatform() });
      while (!existsSync(lockPath)) await new Promise((done) => setTimeout(done, 10));
      // As if the install had run for two hours.
      const old = new Date(Date.now() - 2 * 60 * 60_000);
      utimesSync(lockPath, old, old);
      vi.advanceTimersByTime(61_000);
      let fresh = false;
      for (let i = 0; i < 100 && !fresh; i += 1) {
        await new Promise((done) => setTimeout(done, 20));
        fresh = existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs < 60_000;
      }
      expect(fresh, "the held lock wasn't touched").toBe(true);
      await install;
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes what an interrupted install left, and takes over a lock its owner no longer holds", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release);
    const bundles = join(env["MOSTRA_CACHE_DIR"] as string, "bundles");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(bundles, ".tmp-999999-deadbeef0000", "root"), { recursive: true });
    writeFileSync(join(bundles, `${synthetic.sha256}.lock`), "999999 token\n");
    const bundle = await installPinned(synthetic.pins(release), {
      env,
      platform: bundlePlatform(),
    });
    expect(await readSetup(bundle)).toBeDefined();
    expect(cached(env)).toEqual([synthetic.sha256]);
  });
});

describe("checking a bundle that is already installed", () => {
  it("finds a file changed after setup (what doctor --deep runs) and refuses to set it up again", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const bundle = await readBundle(synthetic.root);
    await setupBundle(synthetic.root, { env: { PATH: process.env["PATH"] ?? "" } });
    await expect(checkFiles(bundle)).resolves.toBeUndefined();
    writeFileSync(join(synthetic.root, "lib/node_modules/fake-playwright/cli.js"), "// tampered\n");
    await expect(checkFiles(bundle)).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_ENV_BUNDLE_INVALID" },
    });
    expect(
      await failure(setupBundle(synthetic.root, { env: { PATH: process.env["PATH"] ?? "" } })),
    ).toBe("MOSTRA_ENV_BUNDLE_INVALID");
  });

  it("finds a link that leaves the tree, a missing link and an execute bit that changed", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const manifest = await describeTree(
      synthetic.root,
      (path) => path === "bundle.json" || path === "files.json",
    );
    const { chmodSync, rmSync, symlinkSync } = await import("node:fs");
    chmodSync(join(synthetic.root, "node/bin/node"), 0o644);
    rmSync(join(synthetic.root, "lib/node_modules/.bin/fake-playwright"));
    symlinkSync("/etc/passwd", join(synthetic.root, "lib/escape"));
    const problems = await checkTree(synthetic.root, manifest, {
      allowExtra: (path) => path === "bundle.json" || path === "files.json",
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        "node/bin/node: not executable",
        "lib/node_modules/.bin/fake-playwright: missing link",
        "lib/escape: not in the bundle's file list",
      ]),
    );
    await expect(describeTree(synthetic.root)).rejects.toThrow("links outside the tree");
  });
});

describe("finding the runtime", () => {
  it("uses MOSTRA_BUNDLE, setting it up first, and reports its entry points", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const runtime = await resolveRuntime({
      env: { PATH: process.env["PATH"] ?? "", MOSTRA_BUNDLE: synthetic.root },
    });
    expect(runtime.source).toBe("bundle");
    expect(runtime.node).toBe(join(synthetic.root, "node/bin/node"));
    expect(runtime.runtimeEntry).toBe(
      join(synthetic.root, "lib/node_modules/@mostra/runtime/dist/bin.js"),
    );
    expect(await readSetup(await readBundle(synthetic.root))).toBeDefined();
  });

  it("downloads the pinned bundle when nothing nearer exists", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const env = pinsEnv(dir.path, synthetic, "https://release.invalid/v0", {
      MOSTRA_BUNDLE_MIRROR: pathToFileURL(dir.path).href,
    });
    const runtime = await resolveRuntime({ env });
    expect(runtime.source).toBe("bundle");
    expect(runtime.bundle?.root).toBe(bundleDir(env, synthetic.sha256));
  });

  it("names a MOSTRA_RUNTIME_BIN that doesn't exist", async () => {
    expect(
      await failure(resolveRuntime({ env: { MOSTRA_RUNTIME_BIN: join(dir.path, "nothing.js") } })),
    ).toBe("MOSTRA_ENV_RUNTIME_MISSING");
  });
});

describe("the platform gate", () => {
  it("refuses Windows, other architectures and Linux without glibc before any download", () => {
    const code = (facts: Parameters<typeof bundlePlatform>[0]): string => {
      try {
        bundlePlatform(facts);
        return "ok";
      } catch (error) {
        return (error as RpcError).diagnostic.code;
      }
    };
    expect(code({ platform: "win32", arch: "x64" })).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
    expect(code({ platform: "linux", arch: "ia32", glibc: "2.39" })).toBe(
      "MOSTRA_PLATFORM_UNSUPPORTED",
    );
    expect(code({ platform: "linux", arch: "x64" })).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
    expect(code({ platform: "linux", arch: "arm64", glibc: "2.39" })).toBe("ok");
    expect(code({ platform: "darwin", arch: "x64" })).toBe("ok");
  });
});

describe("a bundle's links (RT-01)", () => {
  let scratch: ReturnType<typeof tempDir>;
  beforeEach(() => {
    scratch = tempDir("mlink");
  });
  afterEach(() => scratch.cleanup());

  it("refuses a link that leaves the bundle, even when its file list names it", async () => {
    const root = join(scratch.path, "bundle");
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(join(root, "lib", "a.js"), "a");
    symlinkSync("a.js", join(root, "lib", "inside"));
    symlinkSync("../../outside", join(root, "lib", "escape"));
    // describeTree never lists such a link …
    await expect(describeTree(root)).rejects.toThrow("links outside the tree");
    // … and a list that does (a tampered or hand-made bundle) fails the check.
    const listed = {
      schemaVersion: 1 as const,
      files: [
        {
          path: "lib/a.js",
          size: 1,
          sha256: createHash("sha256").update("a").digest("hex"),
          executable: false,
        },
      ],
      links: [
        { path: "lib/escape", target: "../../outside" },
        { path: "lib/inside", target: "a.js" },
      ],
    };
    const problems = await checkTree(root, listed);
    expect(problems.join("\n")).toContain("lib/escape: links outside the bundle");
    expect(problems.join("\n")).not.toContain("lib/inside");
  });

  it("fetches a browser that differs from its pin again into an empty directory, and never downloads the bundle again (Opus review finding 5)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const wrong = pinsEnv(dir.path, synthetic, release, {
      FAKE_BROWSER_CONTENT: "another build\n",
    });
    expect(
      await failure(
        installPinned(synthetic.pins(release), { env: wrong, platform: bundlePlatform() }),
      ),
    ).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    const root = bundleDir(wrong, synthetic.sha256);
    // The browser can be fetched again; the bundle's own files were never in question.
    expect(existsSync(join(root, "bundle.json"))).toBe(true);
    const { rmSync } = await import("node:fs");
    rmSync(synthetic.archive); // any download of the bundle would now fail
    expect(
      await failure(
        installPinned(synthetic.pins(release), { env: wrong, platform: bundlePlatform() }),
      ),
    ).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(existsSync(join(root, "bundle.json"))).toBe(true);
    // Once the browser served is the pinned one, setup finishes from the cache: the old
    // directory, marked complete as Playwright marks it, didn't stop the fetch.
    const right = { ...wrong, FAKE_BROWSER_CONTENT: "" };
    delete (right as Record<string, string>)["FAKE_BROWSER_CONTENT"];
    const bundle = await installPinned(synthetic.pins(release), {
      env: right,
      platform: bundlePlatform(),
    });
    expect(await readSetup(bundle)).toBeDefined();
  });

  it("keeps a bundle whose check fails for a reason that isn't the bundle's, and says why (Opus review finding 5)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release, { FAKE_BROWSER_FAIL: "1" });
    await failure(installPinned(synthetic.pins(release), { env, platform: bundlePlatform() }));
    const root = bundleDir(env, synthetic.sha256);
    const { chmodSync } = await import("node:fs");
    const unreadable = join(root, "lib/node_modules/@mostra/cli/dist/bin.js");
    chmodSync(unreadable, 0o000);
    try {
      const error = await installPinned(synthetic.pins(release), {
        env,
        platform: bundlePlatform(),
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(
        error instanceof RpcError && error.diagnostic.code === "MOSTRA_ENV_BUNDLE_INVALID",
      ).toBe(false);
      expect(existsSync(join(root, "bundle.json"))).toBe(true);
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  it("names no credential a mirror's or proxy's URL carries when the browser can't be fetched (Opus review finding 3)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release, {
      FAKE_BROWSER_FAIL: "1",
      FAKE_BROWSER_SAY:
        "Downloading https://mirror-user:m1rr0r-secret@mirror.example/builds/cft/1/x.zip?sig=q4ery-secret via proxy-user:pr0xy-secret@proxy.example:3128",
      PLAYWRIGHT_DOWNLOAD_HOST: "https://mirror-user:m1rr0r-secret@mirror.example",
      HTTPS_PROXY: "proxy-user:pr0xy-secret@proxy.example:3128",
    });
    const error = await installPinned(synthetic.pins(release), {
      env,
      platform: bundlePlatform(),
    }).catch((caught: RpcError) => caught);
    const said = JSON.stringify((error as RpcError).diagnostic);
    expect((error as RpcError).diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED");
    expect(said).toContain("mirror.example");
    for (const secret of ["m1rr0r-secret", "q4ery-secret", "pr0xy-secret"])
      expect(said).not.toContain(secret);
  });

  it("refuses pins whose asset isn't named as its release's archive, before anything is written (Opus review finding 8)", async () => {
    const synthetic = await syntheticBundle(dir.path);
    const release = pathToFileURL(dir.path).href;
    const env = pinsEnv(dir.path, synthetic, release);
    const pins = synthetic.pins(release);
    const asset = pins.assets[bundlePlatform()];
    const crafted = {
      ...pins,
      assets: { [bundlePlatform()]: { ...asset, file: "../../escaped.tar.gz" } },
    } as typeof pins;
    expect(await failure(installPinned(crafted, { env, platform: bundlePlatform() }))).toBe(
      "MOSTRA_ENV_BUNDLE_INVALID",
    );
    expect(existsSync(join(dir.path, "cache"))).toBe(false);
    expect(existsSync(join(dir.path, "escaped.tar.gz"))).toBe(false);
  });
});
