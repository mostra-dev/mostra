/**
 * Test support for the SDK: synthetic runtime bundles (real `bundle.json`, `files.json` and
 * archive, a `node` that forwards to this process's Node, and a fake Playwright installer that
 * writes a known browser), a local HTTP server for downloads, and temporary directories.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUNDLE_NAME,
  type BundleInfo,
  type BundlePins,
  type BundlePlatform,
  bundleAssetName,
  MutationId,
} from "@mostra/protocol";
import { bundlePlatform, describeTree } from "@mostra/sdk";
import { c } from "tar";

/** Whether the tests run on Windows, whose bundles are shaped their own way (D153). */
export const WINDOWS = process.platform === "win32";

/**
 * A synthetic bundle's one link: on POSIX a link to a file, as `.bin` entries are; on Windows a
 * link to a directory, the only kind a Windows bundle has, made a junction by setup (D153).
 */
export const LINK_PATH = WINDOWS
  ? "lib/node_modules/.links/fake-playwright"
  : "lib/node_modules/.bin/fake-playwright";

/** The synthetic bundle's Node.js: a launcher script on POSIX, Node.js itself on Windows. */
export const NODE_PATH = WINDOWS ? "node/node.exe" : "node/bin/node";

/**
 * A temporary directory under /tmp (short, for sockets), or the system's temporary directory on
 * Windows, removed by `cleanup`.
 */
export function tempDir(prefix: string): { path: string; cleanup(): void } {
  const path = mkdtempSync(WINDOWS ? join(tmpdir(), `${prefix}-`) : `/tmp/${prefix}-`);
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

/** The browser file the fake installer writes, and what the pin expects of it. */
export const BROWSER_FILE = "chromium_headless_shell-1/shell/chrome";
export const BROWSER_CONTENT = "#!/bin/sh\necho fake browser\n";

/** The fake Playwright CLI: `install chromium-headless-shell` writes the browser; `FAKE_INSTALL_LOG` counts runs. */
const FAKE_INSTALLER = `
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (process.argv[2] !== "install" || process.argv[3] !== "chromium-headless-shell") process.exit(2);
if (process.env.FAKE_INSTALL_LOG) appendFileSync(process.env.FAKE_INSTALL_LOG, "install\\n");
if (process.env.FAKE_BROWSER_SAY) console.log(process.env.FAKE_BROWSER_SAY);
if (process.env.FAKE_BROWSER_FAIL) { console.error("ERROR: connect ECONNREFUSED"); process.exit(1); }
if (process.env.FAKE_BROWSER_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_BROWSER_SLEEP_MS));
// As Playwright does: a browser marked complete is never fetched again.
if (require("node:fs").existsSync(join(browsers, "chromium_headless_shell-1", "INSTALLATION_COMPLETE"))) process.exit(0);
const file = join(browsers, ${JSON.stringify(BROWSER_FILE)});
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, process.env.FAKE_BROWSER_CONTENT ?? ${JSON.stringify(BROWSER_CONTENT)}, { mode: 0o755 });
writeFileSync(join(browsers, "chromium_headless_shell-1", "INSTALLATION_COMPLETE"), "");
`;

/** What a synthetic bundle is made of. */
export interface Synthetic {
  /** The extracted tree: `<parent>/mostra-<version>-<platform>`. */
  readonly root: string;
  /** The archive, and its pin. */
  readonly archive: string;
  readonly sha256: string;
  readonly size: number;
  readonly version: string;
  readonly platform: BundlePlatform;
  /** Pins for this archive under `release`. */
  pins(release: string): BundlePins;
}

/** Options of {@link syntheticBundle}. */
export interface SyntheticOptions {
  readonly version?: string;
  /** Changes the tree after `files.json` is written, so the archive differs from its list. */
  readonly afterListing?: (root: string) => void;
  /** Changes the tree before it is listed (an entry a bundle never has). */
  readonly beforeListing?: (root: string) => void;
  /** Extra paths for the archive besides the bundle's top directory, relative to its parent. */
  readonly extraEntries?: readonly string[];
}

/** Builds a synthetic bundle and its archive under `dir`. */
export async function syntheticBundle(
  dir: string,
  options: SyntheticOptions = {},
): Promise<Synthetic> {
  const version = options.version ?? "0.0.0-test";
  const platform = bundlePlatform();
  const top = bundleAssetName(version, platform).replace(/\.tar\.gz$/, "");
  const root = join(dir, top);
  const write = (path: string, text: string, mode = 0o644): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), mode);
  };
  if (WINDOWS) {
    // Windows runs no script as a program: the bundle's Node.js is this one, linked (or copied).
    mkdirSync(join(root, "node"), { recursive: true });
    try {
      linkSync(process.execPath, join(root, NODE_PATH));
    } catch {
      copyFileSync(process.execPath, join(root, NODE_PATH));
    }
  } else {
    write(NODE_PATH, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, 0o755);
  }
  write("lib/node_modules/fake-playwright/cli.js", FAKE_INSTALLER);
  write("lib/node_modules/@mostra/runtime/dist/bin.js", "// not run by unit tests\n");
  write("lib/node_modules/@mostra/cli/dist/bin.js", "// not run by unit tests\n");
  write("lib/node_modules/@mostra/sdk/dist/setup-main.js", "// not run by unit tests\n");
  mkdirSync(dirname(join(root, LINK_PATH)), { recursive: true });
  if (WINDOWS)
    symlinkSync(join(root, "lib/node_modules/fake-playwright"), join(root, LINK_PATH), "junction");
  else symlinkSync("../fake-playwright/cli.js", join(root, LINK_PATH));
  options.beforeListing?.(root);
  const files = await describeTree(root, (path) => path === "bundle.json" || path === "files.json");
  writeFileSync(join(root, "files.json"), JSON.stringify(files));
  const info: BundleInfo = {
    schemaVersion: 1,
    name: BUNDLE_NAME,
    version,
    platform,
    node: { version: process.versions.node, path: NODE_PATH },
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
  writeFileSync(join(root, "bundle.json"), JSON.stringify(info, null, 2));
  options.afterListing?.(root);
  const archive = join(dir, bundleAssetName(version, platform));
  // A Windows archive carries no links (D153): its file list names them, and setup makes them.
  // Its Node.js is large, so it is packed fast.
  const entries = [top, ...(options.extraEntries ?? [])];
  if (WINDOWS) {
    await c(
      {
        gzip: { level: 1 },
        file: archive,
        cwd: dir,
        portable: true,
        filter: (_path, stat) => !("isSymbolicLink" in stat && stat.isSymbolicLink()),
      },
      entries,
    );
  } else {
    await c({ gzip: true, file: archive, cwd: dir, portable: true }, entries);
  }
  const bytes = readFileSync(archive);
  const digest = sha256(bytes);
  return {
    root,
    archive,
    sha256: digest,
    size: bytes.length,
    version,
    platform,
    pins: (release) => ({
      schemaVersion: 1,
      version,
      release,
      assets: {
        [platform]: {
          file: bundleAssetName(version, platform),
          sha256: digest,
          size: bytes.length,
          unpackedSize: 1024 * 1024,
        },
      },
    }),
  };
}

/** A local HTTP server for downloads; `answer` decides each response. */
export async function fileServer(
  answer: (req: IncomingMessage, res: ServerResponse, count: number) => void,
): Promise<{ url: string; requests: () => number; close(): Promise<void> }> {
  let count = 0;
  const server = createServer((req, res) => answer(req, res, ++count));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => count,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Writes pins for `synthetic` and returns the env that points the SDK at them. */
export function pinsEnv(
  dir: string,
  synthetic: Synthetic,
  release: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const file = join(dir, `pins-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(synthetic.pins(release)));
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: join(dir, "user"),
    MOSTRA_CACHE_DIR: join(dir, "cache"),
    MOSTRA_TEST_BUNDLE_PINS: file,
    ...extra,
  };
}

/** One HTTP answer. */
interface Answer {
  readonly status: number;
  readonly body: string;
  readonly cookies: readonly string[];
}

function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: init.method ?? "GET", headers: init.headers ?? {} },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body, cookies: res.headers["set-cookie"] ?? [] }),
        );
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * A viewer that opens a capability link as the shell does (the token for a shell session, a frame
 * ticket, the frame's entry) and answers through the browser protocol, as a page would.
 */
export class Viewer {
  readonly #cookies = new Map<string, string>();
  #frame = "";
  #csrf = "";
  viewId = "";

  async #ask(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Answer> {
    const cookie = [...this.#cookies].map((pair) => pair.join("=")).join("; ");
    const answer = await send(url, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...init.headers },
    });
    for (const line of answer.cookies) {
      const pair = line.split(";")[0] as string;
      const at = pair.indexOf("=");
      this.#cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return answer;
  }

  #post(origin: string, path: string, body: unknown, csrf?: string): Promise<Answer> {
    return this.#ask(origin + path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        ...(csrf ? { "x-mostra-csrf": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  /** Opens a capability link (`…#t=<secret>`). */
  async open(link: string): Promise<this> {
    const url = new URL(link);
    const artifactId = /^\/a\/(art_[0-9A-Z]{26})/.exec(url.pathname)?.[1] as string;
    const token = new URLSearchParams(url.hash.slice(1)).get("t");
    const api = `/a/${artifactId}/_mostra`;
    const exchange = await this.#post(url.origin, `${api}/session`, { token });
    if (exchange.status !== 200) throw new Error(`exchange: ${exchange.status} ${exchange.body}`);
    const shellCsrf = (JSON.parse(exchange.body) as { csrf: string }).csrf;
    const ticket = await this.#post(url.origin, `${api}/ticket`, {}, shellCsrf);
    if (ticket.status !== 200) throw new Error(`ticket: ${ticket.status} ${ticket.body}`);
    const { src, artifactOrigin, viewId } = JSON.parse(ticket.body) as {
      src: string;
      artifactOrigin: string;
      viewId: string;
    };
    const enter = await this.#ask(src, {
      headers: {
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-site",
      },
    });
    if (enter.status !== 303) throw new Error(`enter: ${enter.status} ${enter.body}`);
    const session = await this.#ask(`${artifactOrigin}/_mostra/session`, {
      headers: {
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    });
    this.#frame = artifactOrigin;
    this.#csrf = (JSON.parse(session.body) as { csrf: string }).csrf;
    this.viewId = viewId;
    return this;
  }

  /** Writes draft fields, then submits on the artifact channel. */
  async answerAndSubmit(fields: Record<string, unknown>): Promise<Answer> {
    const revision = "2026-10-15";
    const written = await this.#post(
      this.#frame,
      `/_mostra/v/${revision}/fields`,
      {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: this.viewId,
        ops: Object.entries(fields).map(([id, value]) => ({ id, value })),
      },
      this.#csrf,
    );
    if (written.status !== 200) throw new Error(`fields: ${written.status} ${written.body}`);
    const { revision: draft } = JSON.parse(written.body) as { revision: string };
    return this.#post(
      this.#frame,
      `/_mostra/v/${revision}/submit`,
      { viewId: this.viewId, expectedRevision: draft, channel: "artifact" },
      this.#csrf,
    );
  }
}

/** Polls `condition` until it holds or the time runs out. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** Where Playwright keeps its browsers by default (playwright-core's registry). */
function playwrightBrowsers(): string {
  const home = process.env["HOME"] ?? "";
  return process.platform === "darwin"
    ? join(home, "Library", "Caches", "ms-playwright")
    : join(process.env["XDG_CACHE_HOME"] || join(home, ".cache"), "ms-playwright");
}

/** The environment of an SDK test's instance: its own user home, runtime and config directories. */
export function hostEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name.startsWith("npm_") || name.startsWith("MOSTRA_")) continue;
    env[name] = value;
  }
  return {
    ...env,
    HOME: join(root, "user"),
    PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? playwrightBrowsers(),
    MOSTRA_RUNTIME_DIR: join(root, "run"),
    MOSTRA_CONFIG_DIR: join(root, "config"),
    ...extra,
  };
}

/** Writes a one-file artifact and returns its directory. */
export function writeArtifact(root: string, name: string, body = "<h1>Plan</h1>"): string {
  const dir = join(root, "art", name);
  mkdirSync(dir, { recursive: true });
  const source = [
    'import { defineArtifact } from "@mostra/react";',
    `export const artifact = defineArtifact({ title: ${JSON.stringify(name)} });`,
    "export default function Page() {",
    `  return <main>${body}</main>;`,
    "}",
    "",
  ].join("\n");
  writeFileSync(join(dir, "index.tsx"), source);
  return dir;
}
