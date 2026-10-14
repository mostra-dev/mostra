/**
 * Idempotent requests (H-03, FAILURE_MODEL §1 rule 3): a mutating method records its result under
 * the caller's `requestId`, with a digest of the parameters it was called with, in the same
 * transaction as its effect. A retry with the same parameters gets the recorded result; the same
 * `requestId` with other parameters is refused with `MOSTRA_HOST_REQUEST_ID_REUSED`, never answered
 * with a result for a request nobody made.
 */
import { createHash } from "node:crypto";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { LedgerDb } from "./types.ts";

/** A request to record or replay: its method, the caller's `requestId` and a digest of its params. */
export interface RequestKey {
  readonly method: string;
  readonly requestId: string;
  readonly digest: string;
}

/** JSON with object keys sorted at every depth, so equal parameters give equal text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The key of a request, or `undefined` when the caller sent no `requestId`. The digest covers
 * every parameter but `requestId` itself.
 */
export function requestKey<P extends { readonly requestId?: string | undefined }>(
  method: string,
  params: P,
): RequestKey | undefined {
  const { requestId, ...rest } = params as { requestId?: string } & Record<string, unknown>;
  if (requestId === undefined) return undefined;
  return {
    method,
    requestId,
    digest: createHash("sha256").update(stableJson(rest), "utf8").digest("hex"),
  };
}

function reused(key: RequestKey): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_REQUEST_ID_REUSED", {
      message: `The requestId "${key.requestId}" was used for another ${key.method} request with other parameters.`,
    }),
  );
}

/**
 * The result recorded for `key`, or `undefined` when none is. Throws `MOSTRA_HOST_REQUEST_ID_REUSED`
 * when the `requestId` was recorded with other parameters. A row recorded before digests existed
 * replays as it always did.
 */
export function recordedResult<T>(db: LedgerDb, key: RequestKey): T | undefined {
  const row = db.get<{ result_json: string; params_digest: string | null }>(
    "SELECT result_json, params_digest FROM request WHERE method = ? AND request_id = ?",
    key.method,
    key.requestId,
  );
  if (!row) return undefined;
  if (row.params_digest !== null && row.params_digest !== key.digest) throw reused(key);
  return JSON.parse(row.result_json) as T;
}

/** Records `result` for `key` in the caller's transaction; a key already recorded is kept. */
export function recordResult(db: LedgerDb, key: RequestKey, result: unknown): void {
  db.run(
    "INSERT OR IGNORE INTO request (method, request_id, result_json, params_digest, created_at) VALUES (?, ?, ?, ?, ?)",
    key.method,
    key.requestId,
    JSON.stringify(result),
    key.digest,
    new Date().toISOString(),
  );
}

/**
 * Joins concurrent calls of one request, so a retry that arrives while the first attempt runs
 * waits for its result; the same `requestId` with other parameters is refused at once.
 */
export class InflightRequests {
  readonly #running = new Map<
    string,
    { readonly digest: string; readonly result: Promise<unknown> }
  >();

  run<T>(key: RequestKey, task: () => Promise<T>): Promise<T> {
    const id = `${key.method} ${key.requestId}`;
    const running = this.#running.get(id);
    if (running) {
      if (running.digest !== key.digest) return Promise.reject(reused(key));
      return running.result as Promise<T>;
    }
    const result = task().finally(() => this.#running.delete(id));
    this.#running.set(id, { digest: key.digest, result });
    return result;
  }
}
