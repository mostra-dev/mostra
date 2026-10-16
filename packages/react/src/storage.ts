/**
 * `window.storage`, compatible with Claude artifacts' persistent storage (D53, D112): agents that
 * learned `await window.storage.get(key)` keep working, and their values become Mostra fields.
 * Personal keys are the viewer's draft fields `storage.<key>`, carried over between versions and
 * delivered with the submission; `shared: true` keys are artifact state, every viewer's (D63).
 *
 * Differences from Claude's, by design (D112): a value is any JSON value up to 1 MiB (Mostra's
 * field limit; a larger one rejects with `MOSTRA_FIELD_TOO_LARGE`, never truncated), a missing key
 * resolves `null`, and two writers of one key end with the last write.
 */
import { isFieldId } from "@mostra/protocol";
import { MostraError } from "./runtime/errors.ts";
import { fieldKey, type Store } from "./runtime/store.ts";

/** What `get` and `set` resolve with. */
export interface StorageEntry {
  /** The key. */
  readonly key: string;
  /** Its value: any JSON value. */
  readonly value: unknown;
  /** Whether it is shared by every viewer (artifact state) or the viewer's own. */
  readonly shared: boolean;
}

/** The storage API of Claude artifacts, backed by Mostra fields (D53). */
export interface ClaudeCompatibleStorage {
  /** The value of `key`, or `null` when it has none. */
  get(key: string, shared?: boolean): Promise<StorageEntry | null>;
  /** Stores `value` under `key`; resolves once Mostra saved it. */
  set(key: string, value: unknown, shared?: boolean): Promise<StorageEntry>;
  /** Removes `key`; resolves once Mostra saved that. */
  delete(
    key: string,
    shared?: boolean,
  ): Promise<{ readonly key: string; readonly deleted: true; readonly shared: boolean }>;
  /** The keys stored, those starting with `prefix` when it is given. */
  list(
    prefix?: string,
    shared?: boolean,
  ): Promise<{ readonly keys: string[]; readonly prefix?: string; readonly shared: boolean }>;
}

const PREFIX = "storage.";

/** How many times a write over another writer's change is retried (last write wins, D112). */
const ATTEMPTS = 3;

function fieldIdOf(key: unknown): string {
  if (typeof key !== "string" || !isFieldId(`${PREFIX}${key}`)) {
    throw new MostraError(
      "MOSTRA_FIELD_ID_INVALID",
      `${JSON.stringify(key)} can't be a storage key: use 1 to 248 characters without control characters or empty dot-separated parts.`,
    );
  }
  return `${PREFIX}${key}`;
}

/** Creates the `window.storage` of a page's store. */
export function createStorage(store: Store): ClaudeCompatibleStorage {
  const write = async (key: string, value: unknown, shared: boolean): Promise<void> => {
    const id = fieldIdOf(key);
    const scope = shared ? "artifact" : "viewer";
    await store.whenReady();
    if (value !== undefined) {
      const text = JSON.stringify(value);
      if (text === undefined) {
        throw new MostraError("MOSTRA_HOST_INVALID_PARAMS", `The value of ${key} isn't JSON.`);
      }
    }
    store.set(scope, id, value, {
      immediate: true,
      ...(value === undefined ? { delete: true } : {}),
    });
    const k = fieldKey(scope, id);
    // Settled: saved, refused or in conflict. Offline, the write waits in the journal and the
    // promise with it: it resolves when Mostra has the value, never before (GPT review finding 10).
    const settled = (): Promise<void> =>
      new Promise((resolve) => {
        const done = (): boolean =>
          store.refusal(k) !== undefined ||
          store.conflict(k) !== undefined ||
          store.save(k) === "saved" ||
          store.save(k) === "readonly";
        if (done()) {
          resolve();
          return;
        }
        const stop = store.subscribe(() => {
          if (!done()) return;
          stop();
          resolve();
        });
      });
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await store.flush();
      await settled();
      const refused = store.refusal(k);
      if (refused !== undefined) {
        store.takeTheirs(k);
        throw new MostraError(refused.code, refused.message);
      }
      if (!store.conflict(k)) return;
      store.keepMine(k);
    }
  };
  return {
    async get(key, shared = false) {
      const id = fieldIdOf(key);
      await store.whenReady();
      const value = store.value(fieldKey(shared ? "artifact" : "viewer", id), undefined);
      return value === undefined ? null : { key, value, shared };
    },
    async set(key, value, shared = false) {
      await write(key, value, shared);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      await write(key, undefined, shared);
      return { key, deleted: true as const, shared };
    },
    async list(prefix, shared = false) {
      await store.whenReady();
      const keys = store
        .ids(shared ? "artifact" : "viewer")
        .filter((id) => id.startsWith(PREFIX))
        .map((id) => id.slice(PREFIX.length))
        .filter((key) => prefix === undefined || key.startsWith(prefix));
      return { keys, ...(prefix !== undefined ? { prefix } : {}), shared };
    },
  };
}

declare global {
  interface Window {
    /** Claude-compatible persistent storage, backed by Mostra fields (D53). */
    storage: ClaudeCompatibleStorage;
  }
}

/** Installs `window.storage` for the page's store. */
export function installStorage(store: Store): void {
  if (typeof window === "undefined") return;
  Object.defineProperty(window, "storage", {
    value: createStorage(store),
    configurable: true,
    enumerable: false,
    writable: true,
  });
}
