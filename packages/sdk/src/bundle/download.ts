/**
 * Fetching a pinned archive (RT-01): streamed to disk while it is hashed, never longer than the
 * pin says, through the environment's proxy (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`), retried on
 * failures that a retry can cure, and checked against the pin before anyone reads it.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { EnvHttpProxyAgent, fetch } from "undici";

/** What a download must match. */
export interface Expected {
  readonly sha256: string;
  readonly size: number;
}

/** Progress of one download, in bytes. */
export interface DownloadProgress {
  /** Bytes received so far. */
  readonly received: number;
  /** Bytes the pin says the archive has. */
  readonly total: number;
}

/** Options of {@link download}. */
export interface DownloadOptions {
  /**
   * The environment whose proxy settings apply (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, either
   * case): a host's own, never silently `process.env`'s. Default `process.env`.
   */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
  /** How long the connection may stay silent. Default 60 s. */
  readonly stallMs?: number | undefined;
  /** Attempts in all, for failures a retry can cure. Default 3. */
  readonly attempts?: number | undefined;
}

/** A failure a retry won't cure (an HTTP 4xx other than 408 and 429, a wrong size or digest). */
class Final extends Error {}

/**
 * Downloads `url` (`https:`, `http:` or `file:`) to `dest` and checks its size and SHA-256.
 * Throws `MOSTRA_ENV_BUNDLE_INVALID` when the bytes aren't the pinned ones and
 * `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED` otherwise; `dest` never survives a failure.
 */
export async function download(
  url: string,
  dest: string,
  expected: Expected,
  options: DownloadOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const actual = await once(url, dest, expected, options);
      if (actual !== expected.sha256) {
        throw invalid(
          `The download from ${redactUrl(url)} has SHA-256 ${actual}, not the pinned ${expected.sha256}.`,
        );
      }
      return;
    } catch (error) {
      await rm(dest, { force: true });
      last = error;
      if (error instanceof RpcError || error instanceof Final || options.signal?.aborted) break;
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") break;
      if (attempt < attempts) await delay(1000 * 4 ** (attempt - 1), options.signal);
    }
  }
  if (last instanceof RpcError) throw last;
  if (options.signal?.aborted) throw options.signal.reason;
  throw new RpcError(
    createDiagnostic("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", {
      message: `Couldn't download ${redactUrl(url)}: ${scrubUrls(describe(last))}`,
    }),
  );
}

async function once(
  url: string,
  dest: string,
  expected: Expected,
  options: DownloadOptions,
): Promise<string> {
  const hash = createHash("sha256");
  let received = 0;
  const stallMs = options.stallMs ?? 60_000;
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`no data for ${stallMs / 1000} s`)),
      stallMs,
    );
  };
  try {
    arm();
    const body = await open(url, controller.signal, options.env ?? process.env);
    const counter = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        arm();
        received += chunk.length;
        if (received > expected.size) {
          throw invalid(
            `The download from ${redactUrl(url)} is larger than the pinned ${expected.size} bytes.`,
          );
        }
        hash.update(chunk);
        options.onProgress?.({ received, total: expected.size });
        yield chunk;
      }
    };
    await pipeline(body, counter, createWriteStream(dest, { mode: 0o600 }), {
      signal: controller.signal,
    });
    if (received !== expected.size) {
      throw invalid(
        `The download from ${redactUrl(url)} has ${received} bytes, not the pinned ${expected.size}.`,
      );
    }
    return hash.digest("hex");
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof RpcError)) {
      const reason: unknown = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** The body of `url` as a stream. */
async function open(
  url: string,
  signal: AbortSignal,
  env: Readonly<Record<string, string | undefined>>,
): Promise<AsyncIterable<Uint8Array>> {
  const parsed = new URL(url);
  if (parsed.protocol === "file:") {
    return createReadStream(fileURLToPath(parsed), { signal }) as AsyncIterable<Uint8Array>;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Final(`${parsed.protocol} URLs aren't supported`);
  }
  // fetch refuses a URL with credentials, so a mirror's (`https://user:pass@host/…`) travel as
  // Basic authorization, which fetch drops on a redirect to another origin.
  const headers: Record<string, string> = {
    "user-agent": "mostra-sdk",
    accept: "application/octet-stream",
  };
  if (parsed.username !== "" || parsed.password !== "") {
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    headers["authorization"] = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    parsed.username = "";
    parsed.password = "";
  }
  const response = await fetch(parsed, {
    dispatcher: proxyAgent(env),
    redirect: "follow",
    signal,
    headers,
  });
  if (!response.ok || response.body === null) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    const message = `HTTP ${status}${response.statusText ? ` ${response.statusText}` : ""}`;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw new Final(message);
    throw new Error(message);
  }
  return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
}

const agents = new Map<string, EnvHttpProxyAgent>();
/**
 * The agent for `env`'s `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (lowercase first, as curl
 * reads them), one per distinct setting. Each is passed explicitly, an empty one included, so
 * undici never falls back to `process.env` (GPT review finding 6).
 */
function proxyAgent(env: Readonly<Record<string, string | undefined>>): EnvHttpProxyAgent {
  const settings = {
    httpProxy: env["http_proxy"] ?? env["HTTP_PROXY"] ?? "",
    httpsProxy: env["https_proxy"] ?? env["HTTPS_PROXY"] ?? "",
    noProxy: env["no_proxy"] ?? env["NO_PROXY"] ?? "",
  };
  const key = JSON.stringify(settings);
  let agent = agents.get(key);
  if (agent === undefined) {
    agent = new EnvHttpProxyAgent(settings);
    agents.set(key, agent);
  }
  return agent;
}

/**
 * `text` with every URL in it reduced to {@link redactUrl}'s form: an error from the network stack
 * repeats the URL it failed on, credentials, query and all (a mirror's or a proxy's), and a
 * diagnostic is printed (GPT review finding 2).
 */
export function scrubUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, (url) => redactUrl(url));
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", { message }));
}

/** A URL without credentials or a query, safe to print. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "(an invalid URL)";
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code ?? (error as { code?: string }).code;
  return code !== undefined && !error.message.includes(code)
    ? `${error.message} (${code})`
    : error.message;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
}
