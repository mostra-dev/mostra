/**
 * The npm bootstrap (RT-01) through the built `mostra`: outside a bundle, with its release's pins,
 * the CLI installs the pinned bundle once (download, SHA-256 and file checks, the verify browser)
 * and runs the bundle's own `mostra` on the bundle's own Node.js with the same arguments, passing
 * its exit code on; a bundle whose bytes differ from the pin is refused with one `--json`
 * envelope, and nothing runs.
 *
 * The bundle is synthetic: its Node.js is a wrapper that marks the environment and runs this
 * Node.js, and its CLI records what it was given.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { BUNDLE_NAME, type BundleInfo, bundleAssetName } from "@mostra/protocol";
import { bundlePlatform, describeTree } from "@mostra/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BIN } from "../support.ts";

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const BROWSER_FILE = "chromium_headless_shell-1/shell/chrome";
const BROWSER_CONTENT = "#!/bin/sh\necho fake browser\n";
const INSTALLER = `
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const file = join(process.env.PLAYWRIGHT_BROWSERS_PATH, ${JSON.stringify(BROWSER_FILE)});
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, ${JSON.stringify(BROWSER_CONTENT)}, { mode: 0o755 });
`;
/** The bundle's CLI: records its arguments and environment, exits with `exit-<n>`'s code. */
const RECORDING_CLI = `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.BOOT_LOG, JSON.stringify({ args, viaBundleNode: process.env.VIA_BUNDLE_NODE === "1" }) + "\\n");
const exit = args.find((arg) => arg.startsWith("exit-"));
const signal = args.find((arg) => arg.startsWith("signal-"));
if (signal) process.kill(process.pid, signal.slice(7));
else if (args.includes("wait")) setInterval(() => {}, 1000);
else process.exit(exit ? Number(exit.slice(5)) : 0);
`;

/**
 * The npm bootstrap installs a runtime bundle, and Windows gets its bundles with WP-W3 (D146), which
 * runs this suite there; until then the SDK's `bundlePlatform()` refuses Windows.
 */
const NO_BUNDLE = process.platform === "win32";
const dir = NO_BUNDLE ? "" : mkdtempSync("/tmp/mcb-");
const version = "0.0.0-boot";
let pins = "";
let wrongPins = "";

beforeAll(async () => {
  if (NO_BUNDLE) return;
  const platform = bundlePlatform();
  const top = bundleAssetName(version, platform).replace(/\.tar\.gz$/, "");
  const root = join(dir, "build", top);
  const write = (path: string, text: string, mode = 0o644): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), mode);
  };
  write("node/bin/node", `#!/bin/sh\nVIA_BUNDLE_NODE=1 exec "${process.execPath}" "$@"\n`, 0o755);
  write("lib/node_modules/fake-playwright/cli.js", INSTALLER);
  write("lib/node_modules/@mostra/cli/dist/bin.js", RECORDING_CLI);
  write("lib/node_modules/@mostra/runtime/dist/bin.js", "// not run\n");
  write("lib/node_modules/@mostra/sdk/dist/setup-main.js", "// not run\n");
  mkdirSync(join(root, "lib/node_modules/.bin"), { recursive: true });
  symlinkSync("../fake-playwright/cli.js", join(root, "lib/node_modules/.bin/fake-playwright"));
  const files = await describeTree(root, (path) => path === "bundle.json" || path === "files.json");
  writeFileSync(join(root, "files.json"), JSON.stringify(files));
  const info: BundleInfo = {
    schemaVersion: 1,
    name: BUNDLE_NAME,
    version,
    platform,
    node: { version: process.versions.node, path: "node/bin/node" },
    entries: {
      runtime: "lib/node_modules/@mostra/runtime/dist/bin.js",
      cli: "lib/node_modules/@mostra/cli/dist/bin.js",
      setup: "lib/node_modules/@mostra/sdk/dist/setup-main.js",
    },
    files: { path: "files.json", sha256: sha256(readFileSync(join(root, "files.json"))) },
    browser: {
      name: "chromium-headless-shell",
      revision: "1",
      browserVersion: "1.0.0",
      installer: "lib/node_modules/fake-playwright/cli.js",
      files: [
        {
          path: BROWSER_FILE,
          size: Buffer.byteLength(BROWSER_CONTENT),
          sha256: sha256(BROWSER_CONTENT),
          executable: true,
        },
      ],
    },
  };
  writeFileSync(join(root, "bundle.json"), JSON.stringify(info));
  mkdirSync(join(dir, "release"));
  const archive = join(dir, "release", bundleAssetName(version, platform));
  // macOS's tar adds AppleDouble `._*` entries for extended attributes unless told not to; a
  // bundle refuses them (the assembler's node-tar writes none).
  const packed = spawnSync("tar", ["-czf", archive, "-C", join(dir, "build"), top], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  expect(packed.status, String(packed.stderr)).toBe(0);
  const bytes = readFileSync(archive);
  const asset = {
    file: bundleAssetName(version, platform),
    sha256: sha256(bytes),
    size: bytes.length,
    unpackedSize: 1024 * 1024,
  };
  const pinsOf = (sha: string) =>
    JSON.stringify({
      schemaVersion: 1,
      version,
      release: "https://github.com/mostra-dev/mostra/releases/download/v0.0.0-boot",
      assets: { [platform]: { ...asset, sha256: sha } },
    });
  pins = join(dir, "pins.json");
  wrongPins = join(dir, "wrong-pins.json");
  writeFileSync(pins, pinsOf(asset.sha256));
  writeFileSync(wrongPins, pinsOf("0".repeat(64)));
});
afterAll(() => {
  if (!NO_BUNDLE) rmSync(dir, { recursive: true, force: true });
});

/** The built `mostra`, outside any bundle, pointed at the synthetic release by a file: mirror. */
function mostra(
  args: string[],
  pinsFile: string,
  cache: string,
  mirror: string = join(dir, "release"),
  started?: (pid: number, log: string) => void,
): Promise<{ code: number; stdout: string; stderr: string; log: string }> {
  const log = join(dir, `boot-${Math.random().toString(36).slice(2)}.log`);
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: join(dir, "user"),
    MOSTRA_TEST_BUNDLE_PINS: pinsFile,
    MOSTRA_BUNDLE_MIRROR: pathToFileURL(mirror).href,
    MOSTRA_CACHE_DIR: cache,
    BOOT_LOG: log,
  };
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid !== undefined) started?.(child.pid, log);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) =>
      done({
        code: code ?? 1,
        stdout,
        stderr,
        log: existsSync(log) ? readFileSync(log, "utf8") : "",
      }),
    );
  });
}

describe.skipIf(NO_BUNDLE)("the npm bootstrap (RT-01)", () => {
  it("installs the pinned bundle once, then runs its mostra on its Node.js with the same arguments", async () => {
    const cache = join(dir, "cache-ok");
    const first = await mostra(["verify", "./my artifact", "--json", "exit-7"], pins, cache);
    expect(first.code, first.stderr).toBe(7);
    expect(JSON.parse(first.log.trim())).toEqual({
      args: ["verify", "./my artifact", "--json", "exit-7"],
      viaBundleNode: true,
    });
    const installed = readdirSync(join(cache, "bundles"));
    expect(installed).toHaveLength(1);
    // A second run uses the cache: a mirror with nothing in it is never needed.
    mkdirSync(join(dir, "empty"), { recursive: true });
    const again = await mostra(["list"], pins, cache, join(dir, "empty"));
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.log.trim()).args).toEqual(["list"]);
    expect(readdirSync(join(cache, "bundles"))).toEqual(installed);
  });

  it("exits as the bundle's mostra was ended, and passes a signal sent to it on", async () => {
    const cache = join(dir, "cache-signals");
    // Ended by a signal: 128 plus that signal's number, as a shell reports it.
    const killed = await mostra(["signal-SIGUSR2"], pins, cache);
    expect(killed.code, killed.stderr).toBe(128 + (constants.signals.SIGUSR2 as number));
    // No terminal is attached here, so a SIGINT sent to the npm mostra reaches the bundle's.
    const interrupted = await mostra(["wait"], pins, cache, join(dir, "release"), (pid, log) => {
      const poll = setInterval(() => {
        if (existsSync(log) && readFileSync(log, "utf8").includes('"wait"')) {
          clearInterval(poll);
          process.kill(pid, "SIGINT");
        }
      }, 50);
    });
    expect(interrupted.code, interrupted.stderr).toBe(128 + (constants.signals.SIGINT as number));
  });

  it("answers pins it can't read with one --json envelope, never a stack trace", async () => {
    for (const text of ["{not json", JSON.stringify({ schemaVersion: 1, version: 3 })]) {
      const broken = join(dir, `pins-broken-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(broken, text);
      const answered = await mostra(["list", "--json"], broken, join(dir, "cache-broken"));
      expect(answered.code, answered.stderr).toBe(3);
      const lines = answered.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string)).toMatchObject({
        ok: false,
        error: { code: "MOSTRA_ENV_BUNDLE_INVALID" },
      });
      expect(answered.stderr).not.toMatch(/at .*\.(js|ts):\d+/);
      expect(answered.log).toBe("");
    }
  });

  it("refuses a bundle whose SHA-256 isn't the pinned one, with one --json envelope, and runs nothing", async () => {
    const refused = await mostra(["list", "--json"], wrongPins, join(dir, "cache-wrong"));
    expect(refused.code).toBe(3);
    const lines = refused.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0] as string) as { ok: boolean; error: { code: string } };
    expect(envelope).toMatchObject({ ok: false, error: { code: "MOSTRA_ENV_BUNDLE_INVALID" } });
    expect(refused.log).toBe("");
    const bundles = join(dir, "cache-wrong", "bundles");
    const kept = existsSync(bundles)
      ? readdirSync(bundles).filter((name) => !name.startsWith("."))
      : [];
    expect(kept).toEqual([]);
  });

  it("serves mostra mcp at once from its own process while the pinned bundle installs (D164 item 7)", async () => {
    // A mirror that holds the archive back until the test lets it go, as a slow first download.
    let release: () => void = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const mirror = createServer((req, res) => {
      const file = join(dir, "release", decodeURIComponent((req.url ?? "/").slice(1)));
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      void held.then(() => res.end(readFileSync(file)));
    });
    await new Promise<void>((done) => mirror.listen(0, "127.0.0.1", done));
    const cache = join(dir, "cache-mcp");
    const log = join(dir, "boot-mcp.log");
    const client = new Client({ name: "boot-test", version: "1.0.0" });
    try {
      const startedAt = Date.now();
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [BIN, "mcp"],
          env: {
            PATH: process.env["PATH"] ?? "/usr/bin:/bin",
            HOME: join(dir, "user"),
            MOSTRA_TEST_BUNDLE_PINS: pins,
            MOSTRA_BUNDLE_MIRROR: `http://127.0.0.1:${(mirror.address() as AddressInfo).port}`,
            MOSTRA_CACHE_DIR: cache,
            MOSTRA_HOME: join(dir, "mcp-home"),
            MOSTRA_CONFIG_DIR: join(dir, "mcp-config"),
            MOSTRA_MCP_WORKSPACE: join(dir, "mcp-artifacts"),
            MOSTRA_TEST_RUNTIME_WAIT_MS: "1000",
            DO_NOT_TRACK: "1",
            BOOT_LOG: log,
          },
          stderr: "pipe",
        }),
      );
      const tools = await client.listTools();
      // The client's startup timeout never waits for the download: the handshake and the tool list
      // answer while the archive is still held, from this process (the bundle's CLI ran nothing).
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      expect(tools.tools.map((tool) => tool.name)).toContain("artifact_verify");
      expect(existsSync(log)).toBe(false);
      const text = (result: Awaited<ReturnType<typeof client.callTool>>): string =>
        (result.content as { text?: string }[])[0]?.text ?? "";
      // What needs no instance works during the install.
      const guide = await client.callTool({ name: "docs_search", arguments: { topic: "guide" } });
      expect(guide.isError).not.toBe(true);
      expect(text(guide)).toContain("# Mostra");
      // What needs the instance says the runtime is still installing, and how far it is.
      const early = await client.callTool({ name: "artifact_list", arguments: {} });
      expect(early.isError).toBe(true);
      const installing = JSON.parse(text(early)) as { error: { code: string; message: string } };
      expect(installing.error.code).toBe("MOSTRA_ENV_RUNTIME_INSTALLING");
      expect(installing.error.message).toMatch(/installing its runtime/);
      // Once the archive arrives, the same install (this process's) finishes, and the next call
      // goes on to the instance. The synthetic bundle's runtime starts no daemon, so that call
      // fails, but no longer for the install.
      release();
      let later = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const answer = await client.callTool({ name: "artifact_list", arguments: {} });
        later = text(answer);
        if (!later.includes("MOSTRA_ENV_RUNTIME_INSTALLING")) break;
      }
      expect(later).not.toContain("MOSTRA_ENV_RUNTIME_INSTALLING");
      expect(
        readdirSync(join(cache, "bundles")).filter((name) => !name.startsWith(".")),
      ).toHaveLength(1);
      expect(existsSync(log)).toBe(false);
    } finally {
      release();
      await client.close().catch(() => {});
      mirror.closeAllConnections();
      await new Promise((done) => mirror.close(done));
    }
  });
});
