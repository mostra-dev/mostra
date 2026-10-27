/**
 * The Mostra side of the end-to-end suites: one real `mostra-runtime daemon` per run on a fresh
 * home, a minimal host protocol client over its socket (newline-delimited JSON-RPC, as any host
 * speaks it), and the fixtures it publishes. Global set-up starts it and records what the specs
 * need in a file inside the run's private directory, named by `MOSTRA_E2E_RUN`; global teardown
 * stops it.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { connectControl, resolveRuntime } from "@mostra/sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The runtime's binary, built by `pnpm --filter @mostra/runtime build`. */
export const BIN = join(ROOT, "packages", "runtime", "dist", "bin.js");
/** The built `mostra` CLI. */
export const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
/** The shell's built files, which the gateway serves. */
export const SHELL = join(ROOT, "packages", "shell", "dist", "index.html");
/** Whether the suites run on Windows (D146). */
export const WINDOWS: boolean = process.platform === "win32";
/** The Windows helper Cargo built, which opens the daemon's pipe and unseals versions (D150). */
/** The Windows helper, for the harness's own cleanup (unsealing a test home's versions). */
export const WIN_HELPER: string =
  process.env["MOSTRA_WIN_HELPER"] || join(ROOT, "target", "release", "mostra-win.exe");
/**
 * Where runs live: the real `/tmp` on POSIX (macOS limits socket paths to 103 bytes), the user's
 * own temporary folder on Windows, in its long spelling.
 */
export const SCRATCH: string = WINDOWS ? realpathSync.native(tmpdir()) : realpathSync("/tmp");
/** The artifacts WP-03 rendered from a test server; here they go through the gateway. */
export const FIXTURES = join(ROOT, "packages", "runtime", "test", "fixtures", "artifacts");
/**
 * The variable naming the file where global set-up records the run. The file holds capability
 * links, so it lives in the run's own mode-0700 directory, never at a predictable shared path.
 */
export const RUN_VARIABLE = "MOSTRA_E2E_RUN";

/** What the specs read: the daemon, its socket and the published fixtures' receipts. */
export interface Run {
  readonly pid: number;
  readonly home: string;
  readonly socket: string;
  readonly receipts: Readonly<
    Record<
      "tsx" | "mdx" | "directory" | "survey",
      { readonly artifactId: string; readonly url: string }
    >
  >;
}

/** Reads the run global set-up recorded. */
export function readRun(): Run {
  const file = process.env[RUN_VARIABLE];
  if (!file)
    throw new Error(`${RUN_VARIABLE} isn't set: run the specs through Playwright's global set-up.`);
  return JSON.parse(readFileSync(file, "utf8")) as Run;
}

/** Answers the instance's port calls (`port/<name>.<method>`) on a host's connection. */
export type PortHandler = (method: string, params: unknown) => unknown;

/** How a test connects: as which host, with which ports and home settings. */
export interface ConnectOptions {
  /** The client name: a host's identity for deliveries (D105). */
  readonly name?: string;
  /** The ports this connection registers. */
  readonly ports?: readonly string[];
  /** `HomeConfig` (`submitChannels`, `ports`, `submission`). */
  readonly home?: Record<string, unknown>;
  /** Answers port calls; without one, they are left unanswered. */
  readonly onPortCall?: PortHandler;
}

/** A host protocol connection to the daemon's socket, or on Windows its pipe. */
export class Client {
  readonly #socket: Duplex;
  readonly #pending = new Map<number, (message: Record<string, unknown>) => void>();
  #buffer = "";
  #next = 1;
  #onPortCall: PortHandler | undefined;

  private constructor(socket: Duplex) {
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.#buffer += chunk;
      for (let index = this.#buffer.indexOf("\n"); index >= 0; index = this.#buffer.indexOf("\n")) {
        const line = this.#buffer.slice(0, index);
        this.#buffer = this.#buffer.slice(index + 1);
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message["method"] === "string" && message["id"] !== undefined) {
          void this.#answer(message);
          continue;
        }
        const resolve = this.#pending.get(message["id"] as number);
        if (resolve) {
          this.#pending.delete(message["id"] as number);
          resolve(message);
        }
      }
    });
  }

  /** Answers a port call with the handler's result, or an error when it throws. */
  async #answer(message: Record<string, unknown>): Promise<void> {
    const reply = (body: Record<string, unknown>): void => {
      if (!this.#socket.writable) return;
      this.#socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: message["id"], ...body })}\n`);
    };
    if (!this.#onPortCall) return;
    try {
      reply({ result: await this.#onPortCall(message["method"] as string, message["params"]) });
    } catch (error) {
      reply({ error: { code: -32000, message: (error as Error).message } });
    }
  }

  /** Connects and initializes, as the e2e client or as a host with ports and home settings. */
  static async connect(socketPath: string, options: ConnectOptions = {}): Promise<Client> {
    // As every client reaches it: on Windows through the helper beside the runtime the SDK
    // resolves, which refuses a pipe another user created under the name (D150 item 4).
    const socket = await connectControl(socketPath, {
      runtime: await resolveRuntime({ env: { ...process.env, MOSTRA_RUNTIME_BIN: BIN } }),
    });
    const client = new Client(socket);
    client.#onPortCall = options.onPortCall;
    await client.call("mostra/initialize", {
      client: { name: options.name ?? "e2e", version: "0" },
      revisions: ["2026-10-10"],
      capabilities: {},
      ports: options.ports ?? [],
      ...(options.home ? { home: options.home } : {}),
    });
    return client;
  }

  /** Calls a method; rejects with the diagnostic's code and message on an error. */
  call<T = Record<string, unknown>>(method: string, params: unknown): Promise<T> {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (message) => {
        const error = message["error"] as
          | { data?: { code?: string; message?: string } }
          | undefined;
        if (error) reject(new Error(`${error.data?.code}: ${error.data?.message}`));
        else resolve(message["result"] as T);
      });
      this.#socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  close(): void {
    this.#socket.end();
  }
}

/**
 * Copies what a daemon's home says about a run (its supervisor log and its ledger, never its keys
 * or secrets) into `MOSTRA_E2E_LOG_DIR`, when it is set: CI keeps them for a failed run, since a
 * trace shows only what the browser saw, not whether a request reached Mostra (#39, MT-02). Every
 * run copies them, since a teardown can't know whether its tests failed: about 2 MB for a whole
 * suite's daemons.
 */
function keepEvidence(root: string): void {
  const into = process.env["MOSTRA_E2E_LOG_DIR"];
  if (!into) return;
  for (const part of ["logs", "store"]) {
    const from = join(root, "home", part);
    if (!existsSync(from)) continue;
    try {
      cpSync(from, join(into, basename(root), part), { recursive: true });
    } catch {
      // A file still being written is kept as far as it could be read.
    }
  }
}

/**
 * Removes a run's directory. Published versions are sealed read-only (DATA_MODEL §1), so each
 * directory is made writable before its entries go.
 */
export function removeTree(root: string): void {
  // Only a run directory this harness made: `mostra-e2e-*` directly in the scratch directory.
  if (dirname(root) !== SCRATCH || !basename(root).startsWith("mostra-e2e-")) {
    throw new Error(`refusing to remove ${root}`);
  }
  keepEvidence(root);
  if (WINDOWS) {
    // Sealed versions keep a read-only access list, which the helper resets (D150 item 3).
    spawnSync(WIN_HELPER, ["unseal", root], { windowsHide: true });
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    return;
  }
  const open = (dir: string): void => {
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) open(join(dir, entry.name));
    }
  };
  open(root);
  rmSync(root, { recursive: true, force: true });
}

/**
 * Starts a daemon on a fresh home, or again on the home of an earlier one (`root`); resolves with
 * its status line and the process.
 */
export async function startDaemon(options: { readonly root?: string } = {}): Promise<{
  child: ChildProcess;
  root: string;
  home: string;
  socket: string;
}> {
  for (const file of [BIN, SHELL]) {
    if (!existsSync(file))
      throw new Error(`${file} is missing: build @mostra/runtime and @mostra/shell first.`);
  }
  // Short paths: macOS limits socket paths to 103 bytes.
  const root = options.root ?? realpathSync.native(mkdtempSync(join(SCRATCH, "mostra-e2e-")));
  const home = join(root, "home");
  const { MOSTRA_HOME: _home, ...inherited } = process.env;
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !/^npm_config_/i.test(name)),
  );
  const child = spawn(process.execPath, [BIN, "daemon", "--home", home], {
    env: {
      ...env,
      MOSTRA_RUNTIME_DIR: join(root, "run"),
      // The browser suites test other features; verify and its gate have their own (D138).
      MOSTRA_TEST_UNVERIFIED_PUBLISH: "1",
    },
    stdio: ["ignore", "pipe", "inherit"],
    detached: false,
  });
  const line = await new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const end = out.indexOf("\n");
      if (end >= 0) resolve(out.slice(0, end));
    });
    // `close` comes after stdout was read to its end; `exit` can come before the status line is.
    child.once("close", (code) =>
      reject(new Error(`the daemon exited (${code}) before it started`)),
    );
  });
  const status = JSON.parse(line) as { status: string; socket?: string };
  if (status.status !== "started" || !status.socket) throw new Error(`daemon: ${line}`);
  return { child, root, home, socket: status.socket };
}

/** Copies a fixture beside the home and publishes it. */
export async function publishFixture(
  client: Client,
  home: string,
  fixture: string,
  entry = "",
  options: { readonly copy?: string; readonly policy?: unknown } = {},
): Promise<{ artifactId: string; url: string }> {
  const dir = join(dirname(home), "sources", options.copy ?? fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  const source = { path: entry ? join(dir, entry) : dir };
  return client.call("artifact/publish", {
    source,
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
  });
}
