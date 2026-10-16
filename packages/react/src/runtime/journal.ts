/**
 * The offline journal (D22, IN-02, IN-04): every edit the gateway hasn't confirmed, kept in the
 * artifact origin's IndexedDB so a closed tab, a crash or a lost connection loses nothing. Two
 * kinds of entry: a field's pending edit (not sent yet; its newest value wins), and a mutation that
 * was sent or is about to be, kept with its mutation ID so a replay is idempotent. Every entry
 * names its viewer and the tab that wrote it: a page replays only its own viewer's entries, and
 * adopts another tab's only once that tab is gone, so two open tabs never overwrite each other's
 * unsent edits. Where IndexedDB can't be used the journal lives in memory and says so.
 */
import type { FieldOp } from "@mostra/protocol";

/** A field's edit, not sent yet. */
export interface PendingEntry {
  readonly kind: "pending";
  readonly viewerId: string;
  /** The tab that made the edit. */
  readonly tab: string;
  readonly viewId: string;
  readonly scope: "viewer" | "artifact";
  readonly op: FieldOp;
  /**
   * The revision the edit was based on: the field was unchanged since it (D22). `null` while an
   * earlier mutation of the same field is in flight; its answer sets it.
   */
  readonly base: number | null;
  /** When the edit was made (ms since the epoch). */
  readonly at: number;
}

/** A mutation, sent or about to be, replayed with its own ID. */
export interface MutationEntry {
  readonly kind: "mutation";
  readonly viewerId: string;
  readonly tab: string;
  readonly viewId: string;
  readonly scope: "viewer" | "artifact";
  readonly mutationId: string;
  readonly baseRevision: number;
  readonly ops: readonly FieldOp[];
  /** Its place in the journal: mutations replay in this order. */
  readonly seq: number;
}

/** One entry. */
export type JournalEntry = PendingEntry | MutationEntry;

/** A viewer's entries, mutations in journal order. */
export interface JournalContents {
  readonly pending: PendingEntry[];
  readonly mutations: MutationEntry[];
}

/** The journal's storage. */
export interface Journal {
  /** Whether entries survive the page (IndexedDB), or live only in memory. */
  readonly durable: boolean;
  /** Every entry of a viewer, mutations in order. */
  load(viewerId: string): Promise<JournalContents>;
  /** Records a pending edit, replacing the same tab's earlier one for the field. */
  putPending(entry: PendingEntry): Promise<void>;
  /** Turns pending edits into a mutation in one transaction. */
  promote(mutation: MutationEntry, consumed: readonly PendingEntry[]): Promise<void>;
  /** Forgets a mutation the gateway answered. */
  remove(mutationId: string): Promise<void>;
  /** Forgets a field's pending edit (taken back, or refused for good). */
  dropPending(entry: PendingEntry): Promise<void>;
  /** Moves entries of a tab that is gone to `tab`, in one transaction. */
  adopt(entries: readonly JournalEntry[], tab: string): Promise<void>;
}

/** The key of a pending edit: one per viewer, tab, scope and field. */
export const pendingKey = (
  entry: Pick<PendingEntry, "viewerId" | "tab" | "scope" | "op">,
): string => `p\u0000${entry.viewerId}\u0000${entry.tab}\u0000${entry.scope}\u0000${entry.op.id}`;

const mutationKey = (mutationId: string): string => `m\u0000${mutationId}`;

const keyOf = (entry: JournalEntry): string =>
  entry.kind === "pending" ? pendingKey(entry) : mutationKey(entry.mutationId);

function split(entries: readonly JournalEntry[], viewerId: string): JournalContents {
  const mine = entries.filter((entry) => entry.viewerId === viewerId);
  return {
    pending: mine.filter((entry): entry is PendingEntry => entry.kind === "pending"),
    mutations: mine
      .filter((entry): entry is MutationEntry => entry.kind === "mutation")
      .sort((a, b) => a.seq - b.seq),
  };
}

/** The journal in memory: for targets without IndexedDB, and for tests. */
export class MemoryJournal implements Journal {
  readonly durable: boolean = false;
  readonly #entries = new Map<string, JournalEntry>();

  async load(viewerId: string): Promise<JournalContents> {
    return split([...this.#entries.values()], viewerId);
  }

  async putPending(entry: PendingEntry): Promise<void> {
    this.#entries.set(pendingKey(entry), entry);
  }

  async promote(mutation: MutationEntry, consumed: readonly PendingEntry[]): Promise<void> {
    for (const entry of consumed) this.#entries.delete(pendingKey(entry));
    this.#entries.set(mutationKey(mutation.mutationId), mutation);
  }

  async remove(mutationId: string): Promise<void> {
    this.#entries.delete(mutationKey(mutationId));
  }

  async dropPending(entry: PendingEntry): Promise<void> {
    this.#entries.delete(pendingKey(entry));
  }

  async adopt(entries: readonly JournalEntry[], tab: string): Promise<void> {
    for (const entry of entries) {
      this.#entries.delete(keyOf(entry));
      const moved = { ...entry, tab };
      const key = keyOf(moved);
      // A tab's own newer edit of the same field wins over an adopted one.
      if (!this.#entries.has(key)) this.#entries.set(key, moved);
    }
  }
}

const DB_NAME = "mostra";
const STORE = "journal";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("The transaction aborted."));
  });
}

/**
 * The journal in the artifact origin's IndexedDB: one database per origin, so per artifact (D38).
 * Each write starts its transaction at once, so an edit made just before the page closes is in it.
 */
export class IndexedDbJournal implements Journal {
  readonly durable: boolean = true;
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  /** Opens the journal; `undefined` where IndexedDB can't be used (a private mode, a sandbox). */
  static async open(): Promise<IndexedDbJournal | undefined> {
    if (typeof indexedDB === "undefined") return undefined;
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      };
      return new IndexedDbJournal(await request(open));
    } catch {
      return undefined;
    }
  }

  #write(change: (store: IDBObjectStore) => void): Promise<void> {
    const transaction = this.#db.transaction(STORE, "readwrite");
    change(transaction.objectStore(STORE));
    return done(transaction);
  }

  async load(viewerId: string): Promise<JournalContents> {
    const all = (await request(
      this.#db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
    )) as JournalEntry[];
    return split(all, viewerId);
  }

  putPending(entry: PendingEntry): Promise<void> {
    return this.#write((store) => store.put(entry, pendingKey(entry)));
  }

  promote(mutation: MutationEntry, consumed: readonly PendingEntry[]): Promise<void> {
    return this.#write((store) => {
      for (const entry of consumed) store.delete(pendingKey(entry));
      store.put(mutation, mutationKey(mutation.mutationId));
    });
  }

  remove(mutationId: string): Promise<void> {
    return this.#write((store) => store.delete(mutationKey(mutationId)));
  }

  dropPending(entry: PendingEntry): Promise<void> {
    return this.#write((store) => store.delete(pendingKey(entry)));
  }

  async adopt(entries: readonly JournalEntry[], tab: string): Promise<void> {
    const transaction = this.#db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const entry of entries) {
      store.delete(keyOf(entry));
      const moved = { ...entry, tab };
      // `add` fails on an existing key: a tab's own newer edit wins over an adopted one.
      const added = store.add(moved, keyOf(moved));
      added.onerror = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
    }
    await done(transaction);
  }
}
