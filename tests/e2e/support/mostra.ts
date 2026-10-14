/**
 * The Mostra side of the end-to-end suites: one real `mostra-runtime daemon` per run on a fresh
 * home, a minimal host protocol client over its socket (newline-delimited JSON-RPC, as any host
 * speaks it), and the fixtures it publishes. Global set-up starts it and records what the specs
 * need in a file inside the run's private directory, named by `MOSTRA_E2E_RUN`; global teardown
 * stops it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The runtime's binary, built by `pnpm --filter @mostra/runtime build`. */
export const BIN = join(ROOT, "packages", "runtime", "dist", "bin.js");
/** The shell's built files, which the gateway serves. */
export const SHELL = join(ROOT, "packages", "shell", "dist", "index.html");
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
    Record<"tsx" | "mdx" | "directory", { readonly artifactId: string; readonly url: string }>
  >;
}

/** Reads the run global set-up recorded. */
export function readRun(): Run {
  const file = process.env[RUN_VARIABLE];
  if (!file)
    throw new Error(`${RUN_VARIABLE} isn't set: run the specs through Playwright's global set-up.`);
  return JSON.parse(readFileSync(file, "utf8")) as Run;
}

/** A host protocol connection to the daemon's socket. */
export class Client {
  readonly #socket: Socket;
  readonly #pending = new Map<number, (message: Record<string, unknown>) => void>();
  #buffer = "";
  #next = 1;

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.#buffer += chunk;
      for (let index = this.#buffer.indexOf("\n"); index >= 0; index = this.#buffer.indexOf("\n")) {
        const line = this.#buffer.slice(0, index);
        this.#buffer = this.#buffer.slice(index + 1);
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        const resolve = this.#pending.get(message["id"] as number);
        if (resolve) {
          this.#pending.delete(message["id"] as number);
          resolve(message);
        }
      }
    });
  }

  /** Connects and initializes. */
  static async connect(socketPath: string): Promise<Client> {
    const socket = createConnection(socketPath);
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const client = new Client(socket);
    await client.call("mostra/initialize", {
      client: { name: "e2e", version: "0" },
      revisions: ["2026-10-10"],
      capabilities: {},
      ports: [],
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

/** Starts a daemon on a fresh home; resolves with its status line and the process. */
export async function startDaemon(): Promise<{
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
  const root = realpathSync(mkdtempSync("/tmp/mostra-e2e-"));
  const home = join(root, "home");
  const { MOSTRA_HOME: _home, ...inherited } = process.env;
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !/^npm_config_/i.test(name)),
  );
  const child = spawn(process.execPath, [BIN, "daemon", "--home", home], {
    env: { ...env, MOSTRA_RUNTIME_DIR: join(root, "run") },
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
    child.once("exit", (code) =>
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
): Promise<{ artifactId: string; url: string }> {
  const dir = join(dirname(home), "sources", fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return client.call("artifact/publish", { source: { path: entry ? join(dir, entry) : dir } });
}
