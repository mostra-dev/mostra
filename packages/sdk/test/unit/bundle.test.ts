import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
