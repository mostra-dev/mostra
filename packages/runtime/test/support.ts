/**
 * Shared test support: temporary directories that are removed after the file's tests, and a
 * line-level host protocol client that speaks to an instance exactly as an SDK would, using only
 * `@mostra/protocol`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { LineSplitter } from "@mostra/protocol";
import { afterAll } from "vitest";

const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) removeAll(dir);
});

/** Removes a tree, including sealed (read-only) version directories. */
export function removeAll(dir: string): void {
  const unseal = (path: string): void => {
    let entries: Dirent[];
    try {
      chmodSync(path, 0o755);
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory()) unseal(join(path, entry.name));
  };
  unseal(dir);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * A fresh directory, removed after the file's tests. `short` places it under `/tmp`, because
 * macOS limits socket paths to 103 bytes and its `os.tmpdir()` is long.
 */
export function tempDir(prefix: string, short = false): string {
  const dir = realpathSync(mkdtempSync(join(short ? "/tmp" : tmpdir(), `${prefix}-`)));
  created.push(dir);
  return dir;
}

/** The built runtime binary (`pnpm --filter @mostra/runtime build`). */
export const BIN: string = join(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");

/** A home and a runtime directory for one test. */
export interface TestHome {
  readonly home: string;
  readonly runtimeDir: string;
  /** The environment the binary runs with: the runtime directory, no MOSTRA_HOME and no npm configuration. */
  readonly env: NodeJS.ProcessEnv;
}

export function testHome(): TestHome {
  const root = tempDir("mrt", true);
  const runtimeDir = join(root, "run");
  const { MOSTRA_HOME: _home, ...inherited } = process.env;
  // npm and pnpm put their own configuration (`npm_config_userconfig` naming the developer's
  // ~/.npmrc, among others) into the environment of every script they run; a test home's installs
  // must not depend on it.
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !/^npm_config_/i.test(name)),
  );
  // Suites of other features publish without verify's gate (D138); `verifiedHome` keeps it.
  return {
    home: join(root, "home"),
    runtimeDir,
    env: { ...env, MOSTRA_RUNTIME_DIR: runtimeDir, MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" },
  };
}

/** A test home whose publishes go through verify's gate, as a user's do (D41, D138). */
export function verifiedHome(): TestHome {
  const home = testHome();
  const { MOSTRA_TEST_UNVERIFIED_PUBLISH: _unverified, ...env } = home.env;
  return { ...home, env };
}

/** A message received on a connection. */
export type Message = {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    code: number;
    message: string;
    data: {
      code: string;
      message: string;
      hint?: string;
      location?: unknown;
      fix?: { kind: string; command?: string };
    };
  };
  readonly method?: string;
};

/** A raw newline-delimited JSON-RPC connection. */
export class LineClient {
  readonly #output: Writable;
  readonly #received: Message[] = [];
  readonly #waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  #nextId = 1;
  readonly closed: Promise<void>;

  constructor(input: Readable, output: Writable) {
    this.#output = output;
    const splitter = new LineSplitter();
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as Message;
        const waiter = this.#waiters.findIndex((entry) => entry.match(message));
        if (waiter >= 0) this.#waiters.splice(waiter, 1)[0]?.resolve(message);
        else this.#received.push(message);
      }
    });
    this.closed = new Promise((resolve) => {
      input.once("close", () => resolve());
      input.once("end", () => resolve());
    });
  }

  /** Sends a raw line, exactly as given. */
  sendRaw(line: string): void {
    this.#output.write(`${line}\n`);
  }

  /** Waits for the first message matching `match` (already received or arriving later). */
  next(match: (message: Message) => boolean, timeoutMs = 10_000): Promise<Message> {
    const index = this.#received.findIndex(match);
    if (index >= 0) return Promise.resolve(this.#received.splice(index, 1)[0] as Message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No matching message arrived.")), timeoutMs);
      this.#waiters.push({
        match,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  /** Sends a request and waits for its response (builds take seconds, so the default is generous). */
  call(method: string, params?: unknown, timeoutMs = 60_000): Promise<Message> {
    const id = this.#nextId++;
    this.sendRaw(
      JSON.stringify(
        params === undefined
          ? { jsonrpc: "2.0", id, method }
          : { jsonrpc: "2.0", id, method, params },
      ),
    );
    return this.next((message) => message.id === id, timeoutMs);
  }

  close(): void {
    this.#output.end();
  }
}

/** The params of a well-formed `mostra/initialize`. */
export function initializeParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client: { name: "protocol-suite", version: "0" },
    revisions: ["2026-10-10"],
    capabilities: {},
    ports: [],
    ...overrides,
  };
}

/** Connects to a control socket. */
export async function connectTo(socket: string): Promise<LineClient> {
  const connection = createConnection(socket);
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("error", reject);
  });
  return new LineClient(connection, connection);
}

/** A started `mostra-runtime` process. */
export interface RuntimeProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  stderr(): string;
}

/** Starts the binary. */
export function runBin(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  nodeArgs: readonly string[] = [],
): RuntimeProcess {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing: build @mostra/runtime first.`);
  const child = spawn(process.execPath, [...nodeArgs, BIN, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, stderr: () => stderr };
}

/** The first stdout line of a `mostra-runtime daemon`, parsed. */
export interface DaemonStatus {
  readonly status: "started" | "attached" | "failed";
  readonly pid?: number;
  readonly home?: string;
  readonly socket?: string;
  readonly reaped?: number;
  readonly diagnostic?: { code: string; message: string; hint?: string };
}

/** Starts `mostra-runtime daemon` and waits for its status line. */
export async function startDaemon(
  testHome: TestHome,
  options: { env?: NodeJS.ProcessEnv; nodeArgs?: readonly string[]; args?: readonly string[] } = {},
): Promise<RuntimeProcess & { status: DaemonStatus }> {
  const started = runBin(
    ["daemon", "--home", testHome.home, ...(options.args ?? [])],
    options.env ?? testHome.env,
    options.nodeArgs,
  );
  const status = await new Promise<DaemonStatus>((resolve, reject) => {
    const splitter = new LineSplitter();
    started.child.stdout?.setEncoding("utf8");
    started.child.stdout?.on("data", (chunk: string) => {
      const [line] = splitter.push(chunk);
      if (line !== undefined) resolve(JSON.parse(line) as DaemonStatus);
    });
    // `exit` can come before the last of stdout is read (an attached starter prints its line and
    // exits at once): only the end of stdout means no line is coming. Seen on Linux CI after
    // WP-10's merge, as the CLI's daemon start saw it (its own fix, WP-10).
    started.child.stdout?.on("end", () => {
      void started.exited.then(({ code }) =>
        reject(new Error(`daemon exited (${code}) before a status line: ${started.stderr()}`)),
      );
    });
  });
  return { ...started, status };
}

/** Starts `mostra-runtime host` with a line client on its stdio. */
export function startHost(
  testHome: TestHome,
  options: { env?: NodeJS.ProcessEnv; nodeArgs?: readonly string[] } = {},
) {
  const started = runBin(
    ["host", "--home", testHome.home],
    options.env ?? testHome.env,
    options.nodeArgs,
  );
  const { stdout, stdin } = started.child;
  if (!stdout || !stdin) throw new Error("no stdio");
  return { ...started, client: new LineClient(stdout, stdin) };
}

/** Whether a process with this PID exists. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Polls `condition` until it holds, or fails after `timeoutMs`. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/** The TCP addresses a process listens on, from the operating system (`lsof` or `ss`). */
export function listening(pid: number): string[] {
  if (process.platform === "darwin") {
    const out = execFileSync(
      "lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      {
        encoding: "utf8",
      },
    );
    return out
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1));
  }
  let out: string;
  try {
    out = execFileSync("ss", ["-Hltnp"], { encoding: "utf8" });
  } catch (error) {
    // A machine without iproute2 (a minimal container): the kernel's own tables.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return listeningFromProc(pid);
    throw error;
  }
  return out
    .split("\n")
    .filter((line) => line.includes(`pid=${pid},`))
    .map((line) => line.trim().split(/\s+/)[3] ?? "");
}

/** Linux: the TCP listeners of `pid`, from its descriptors and `/proc/net/tcp{,6}` (proc(5)). */
function listeningFromProc(pid: number): string[] {
  const fds = join("/proc", String(pid), "fd");
  const inodes = new Set<string>();
  for (const fd of readdirSync(fds)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(join(fds, fd)));
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // Closed meanwhile.
    }
  }
  const found: string[] = [];
  for (const [file, v6] of [
    ["/proc/net/tcp", false],
    ["/proc/net/tcp6", true],
  ] as const) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      // local_address, state (0A is LISTEN) and inode, as proc(5) lays them out.
      const [local, state, inode] = [fields[1], fields[3], fields[9]];
      if (!local || state !== "0A" || !inode || !inodes.has(inode)) continue;
      const [hexAddress = "", hexPort = "0"] = local.split(":");
      const port = Number.parseInt(hexPort, 16);
      found.push(`${v6 ? `[${procAddress6(hexAddress)}]` : procAddress4(hexAddress)}:${port}`);
    }
  }
  return found;
}

/** An IPv4 address as /proc/net/tcp writes it: four bytes, little-endian, in hex. */
function procAddress4(hex: string): string {
  const bytes = (hex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  return bytes.reverse().join(".");
}

/** An IPv6 address as /proc/net/tcp6 writes it: four 32-bit words, each little-endian. */
function procAddress6(hex: string): string {
  const words = (hex.match(/.{8}/g) ?? []).map((word) =>
    (word.match(/../g) ?? []).reverse().join(""),
  );
  const groups = (words.join("").match(/.{4}/g) ?? []).map((group) =>
    group.replace(/^0+(?=.)/, ""),
  );
  const text = groups.join(":");
  if (text === "0:0:0:0:0:0:0:0") return "::";
  if (text === "0:0:0:0:0:0:0:1") return "::1";
  return text;
}
