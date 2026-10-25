/**
 * What the CLI's integration suites share: a temporary home with its own runtime directory and
 * config directory, the built `mostra` run as a real process, its envelope read and checked, a
 * viewer that submits through the browser protocol, and a fake telemetry collector.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import { expect } from "vitest";

/** The built binary. */
export const BIN: string = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

/** Whether the tests run on Windows (D146). */
export const WINDOWS: boolean = process.platform === "win32";

/** The Windows helper a checkout's Cargo build made (`MOSTRA_WIN_HELPER` overrides it). */
export function windowsHelper(): string {
  return (
    process.env["MOSTRA_WIN_HELPER"] ||
    fileURLToPath(new URL("../../../target/release/mostra-win.exe", import.meta.url))
  );
}

/** Windows: the helper's test probe (`mostra-win-probe`), beside the helper Cargo built. */
export function probePath(): string {
  return join(dirname(windowsHelper()), "mostra-win-probe.exe");
}

/**
 * Windows: what the second local user the CI leg creates (`MOSTRA_TEST_OTHER_USER`) can open of
 * each `file:` or `dir:` path, through the helper's test probe. A missing user is a failure, never
 * a skip (docs/agents/run-on-windows.md).
 */
export function asOtherUser(
  ...targets: string[]
): { path: string; read: boolean; readWrite: boolean }[] {
  const user = process.env["MOSTRA_TEST_OTHER_USER"];
  const password = process.env["MOSTRA_TEST_OTHER_PASSWORD"];
  if (!user || !password) {
    throw new Error("Set MOSTRA_TEST_OTHER_USER and MOSTRA_TEST_OTHER_PASSWORD (the CI leg does).");
  }
  const out = execFileSync(probePath(), ["as-user", user, password, ...targets], {
    encoding: "utf8",
  });
  const answer = JSON.parse(out) as {
    ok: boolean;
    result?: { path: string; read: boolean; readWrite: boolean }[];
  };
  if (!answer.ok || !answer.result) throw new Error(`probe failed: ${out}`);
  return answer.result;
}

/**
 * A test's own home, runtime and config directories: under /tmp on POSIX (macOS socket paths are
 * short), under the system's temporary folder on Windows, whose control endpoint is a pipe.
 */
export interface TestHome {
  readonly root: string;
  readonly home: string;
  readonly config: string;
  readonly env: Record<string, string>;
  /** Stops any daemon of the home and removes everything. */
  cleanup(): Promise<void>;
}

/** The environment a test's CLI runs in: the process's, without npm's and Mostra's own. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.startsWith("npm_") || name === "DO_NOT_TRACK") continue;
    // Mostra's own variables stay out, but for the helper the Windows legs name (D150).
    if (name.startsWith("MOSTRA_") && name !== "MOSTRA_WIN_HELPER") continue;
    // No agent's marker leaks from the shell that runs the tests into the CLI under test.
    if (
      [
        "AI_AGENT",
        "AGENT",
        "CLAUDECODE",
        "CODEX_THREAD_ID",
        "GEMINI_CLI",
        "OPENCODE",
        "CURSOR_AGENT",
        "CI",
      ].includes(name)
    )
      continue;
    env[name] = value;
  }
  return env;
}

/** Where Playwright keeps its browsers by default (playwright-core's registry). */
function playwrightBrowsers(): string {
  if (WINDOWS)
    return join(
      process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "ms-playwright")
    : join(process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache"), "ms-playwright");
}

/** Makes a fresh home. Tests of other features than telemetry run with no collector. */
export function testHome(extra: Record<string, string> = {}): TestHome {
  const root = mkdtempSync(join(WINDOWS ? tmpdir() : "/tmp", "mcli-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const env = {
    ...baseEnv(),
    // The test's own user home, so `daemon install` writes its launchd agent or systemd unit there,
    // never into the developer's; Playwright's browsers stay where they were installed.
    HOME: join(root, "user"),
    PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? playwrightBrowsers(),
    MOSTRA_HOME: home,
    MOSTRA_RUNTIME_DIR: join(root, "run"),
    MOSTRA_CONFIG_DIR: config,
    // Other features' suites publish without verify's gate (D138, runtime's testHome does too).
    MOSTRA_TEST_UNVERIFIED_PUBLISH: "1",
    ...extra,
  };
  return {
    root,
    home,
    config,
    env,
    async cleanup() {
      if (WINDOWS) {
        await removeOnWindows(root, home, env);
        return;
      }
      await cli(["daemon", "stop", "--json"], { env }).catch(() => undefined);
      // Versions are sealed read-only; open them up before removing.
      await new Promise((done) => spawn("chmod", ["-R", "u+w", root]).on("exit", done));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The daemon `instance.json` names, if any. */
function daemonOf(home: string): number | undefined {
  try {
    return (JSON.parse(readFileSync(join(home, "instance.json"), "utf8")) as { pid: number }).pid;
  } catch {
    return undefined;
  }
}

/**
 * Removes a test's directory on Windows, which refuses to remove what a running process holds
 * open (a daemon's ledger and log, or its working directory). A daemon may still be starting
 * when a test ends (one that a timed-out command started writes `instance.json` later), so this
 * stops whatever daemon the home names, waits for it to exit, and tries again until the
 * directory is gone, for at most 30 s.
 */
async function removeOnWindows(
  root: string,
  home: string,
  env: Record<string, string>,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const daemon = daemonOf(home);
    if (daemon !== undefined) {
      await cli(["daemon", "stop", "--json"], { env }).catch(() => undefined);
      while (Date.now() < deadline && alive(daemon)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // Versions are sealed read-only; open them up before removing.
    await new Promise((done) =>
      spawn(windowsHelper(), ["unseal", root]).on("exit", done).on("error", done),
    );
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** What one run of the CLI did. */
export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** How long until stdout closed, in milliseconds. */
  readonly ms: number;
}

/** Runs the built CLI; stdin is a pipe (never a terminal), closed after `input`. */
export function cli(
  args: readonly string[],
  options: { env: Record<string, string>; input?: string; cwd?: string; timeoutMs?: number },
): Promise<Ran> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: options.env,
      cwd:
        options.cwd ??
        (options.env["MOSTRA_HOME"] ? dirname(options.env["MOSTRA_HOME"]) : process.cwd()),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`mostra ${args.join(" ")} hung (a prompt, or a holder of stdout): ${stderr}`),
      );
    }, options.timeoutMs ?? 90_000);
    // `close` waits for every holder of stdout and stderr: a detached child that kept them would show here.
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started });
    });
    child.stdin.end(options.input ?? "");
  });
}

/** The one envelope `--json` printed, checked for its shape. */
export interface Envelope {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { code: string; message: string; severity: string; docs: string; hint?: string };
  readonly instance?: {
    home: string;
    socket: string;
    pid: number;
    mode: string;
    version: string;
    started: boolean;
  };
  readonly warnings: unknown[];
}

/** Checks that stdout is exactly one JSON envelope and returns it (AX-01, D140 item 16). */
export function envelope(ran: Ran): Envelope {
  const lines = ran.stdout.split("\n").filter((line) => line.length > 0);
  expect(lines, `stdout of exit ${ran.code}: ${ran.stdout}\nstderr: ${ran.stderr}`).toHaveLength(1);
  const value = JSON.parse(lines[0] as string) as Envelope;
  expect(typeof value.ok).toBe("boolean");
  expect(Array.isArray(value.warnings)).toBe(true);
  if (value.ok) expect("result" in value).toBe(true);
  else {
    expect(value.error?.code).toMatch(/^MOSTRA_[A-Z0-9]+_[A-Z0-9_]+$/);
    expect(typeof value.error?.message).toBe("string");
    expect(value.error?.docs).toMatch(/^https:\/\//);
  }
  if (value.instance !== undefined) {
    expect(value.instance.pid).toBeGreaterThan(0);
    expect(["daemon", "host"]).toContain(value.instance.mode);
  }
  return value;
}

/** One HTTP request and its answer, with the cookie headers it set. */
interface Answer {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string[]>;
}

function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers: init.headers,
        agent: false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          const headers: Record<string, string[]> = {};
          for (let index = 0; index + 1 < res.rawHeaders.length; index += 2) {
            const name = (res.rawHeaders[index] as string).toLowerCase();
            const values = headers[name] ?? [];
            values.push(res.rawHeaders[index + 1] as string);
            headers[name] = values;
          }
          resolve({ status: res.statusCode ?? 0, body, headers });
        });
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * A viewer that opens a capability link as the shell does (the token for a shell session, a frame
 * ticket, the frame's entry) and acts through the browser protocol, as a page would.
 */
export class Viewer {
  readonly #cookies = new Map<string, string>();
  #frameOrigin = "";
  #frameCsrf = "";
  viewId = "";

  async #ask(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Answer> {
    const cookie = [...this.#cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    const answer = await send(url, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...init.headers },
    });
    for (const line of answer.headers["set-cookie"] ?? []) {
      const pair = line.split(";")[0] as string;
      const at = pair.indexOf("=");
      this.#cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return answer;
  }

  #json(origin: string, path: string, body: unknown, csrf?: string): Promise<Answer> {
    return this.#ask(`${origin}${path}`, {
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

  /** Opens a link (`#t=…`) or a launch URL (`#l=…`). */
  async open(url: string): Promise<this> {
    const parsed = new URL(url);
    const artifactId = /^\/a\/(art_[0-9A-Z]{26})/.exec(parsed.pathname)?.[1] as string;
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    const credential = fragment.has("t")
      ? { token: fragment.get("t") }
      : { launch: fragment.get("l") };
    const api = `/a/${artifactId}/_mostra`;
    const exchange = await this.#json(parsed.origin, `${api}/session`, credential);
    if (exchange.status !== 200) throw new Error(`exchange: ${exchange.status} ${exchange.body}`);
    const shellCsrf = (JSON.parse(exchange.body) as { csrf: string }).csrf;
    const ticket = await this.#json(parsed.origin, `${api}/ticket`, {}, shellCsrf);
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
    this.#frameOrigin = artifactOrigin;
    this.#frameCsrf = (JSON.parse(session.body) as { csrf: string }).csrf;
    this.viewId = viewId;
    return this;
  }

  /** Writes draft fields, then submits on the artifact channel. */
  async answerAndSubmit(fields: Record<string, unknown>): Promise<Answer> {
    const revision = "2026-10-15";
    const written = await this.#json(
      this.#frameOrigin,
      `/_mostra/v/${revision}/fields`,
      {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: this.viewId,
        ops: Object.entries(fields).map(([id, value]) => ({ id, value })),
      },
      this.#frameCsrf,
    );
    if (written.status !== 200) throw new Error(`fields: ${written.status} ${written.body}`);
    const { revision: draft } = JSON.parse(written.body) as { revision: string };
    return this.#json(
      this.#frameOrigin,
      `/_mostra/v/${revision}/submit`,
      { viewId: this.viewId, expectedRevision: draft, channel: "artifact" },
      this.#frameCsrf,
    );
  }
}

/** A fake telemetry collector on loopback: every request it got, and whether to answer. */
export interface Collector {
  readonly url: string;
  readonly requests: { headers: IncomingMessage["headers"]; body: string }[];
  /** Holds every answer until released, to show the CLI never waits for the network. */
  hold(): void;
  release(): void;
  close(): Promise<void>;
}

/** Starts a fake collector. */
export async function collector(): Promise<Collector> {
  const requests: Collector["requests"] = [];
  let held = false;
  const waiting: (() => void)[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ headers: req.headers, body });
      const answer = (): void => {
        res.writeHead(204).end();
      };
      if (held) waiting.push(answer);
      else answer();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/v1/events`,
    requests,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      for (const answer of waiting.splice(0)) answer();
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Polls `condition` until it holds or the time runs out. */
export async function eventually(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((done) => setTimeout(done, 50));
  }
}
