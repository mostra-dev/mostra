/**
 * The client runtime's store (INTERFACES §2.3; D22, D52, D110; IN-01 to IN-04): one per page. It
 * holds what the gateway says each field is, the viewer's edits it hasn't confirmed, and the
 * mounted fields, and hooks read it through `useSyncExternalStore`.
 *
 * - **Edits** show at once, are journaled in IndexedDB at once, and are sent after a short
 *   debounce, or at once on blur, when the page is hidden or closed, and before a submit (IN-02).
 * - **Bases.** Each edit remembers the revision the field had when the viewer made it, so the
 *   gateway turns an edit made over a change the viewer never saw into a conflict, never a silent
 *   overwrite (D22). The page's own answers move a field's revision; another writer's change moves
 *   it only when the event stream delivers it, in order.
 * - **Conflicts** keep both values: the viewer's (mine) stays shown until they keep it or take
 *   theirs (FAILURE_MODEL §5).
 * - **Offline**, mutations stay in the journal with their IDs and replay in order (IN-04); a tab
 *   that closed with unsent edits leaves them for the next page of the artifact to adopt.
 * - **Tabs** converge through the event stream; a BroadcastChannel only shortens the delay.
 */
import {
  type Actor,
  type EventRecord,
  type FieldConflict,
  type FieldOp,
  type FieldScope,
  isFieldId,
  MutationId,
  type MutationResult,
  SIGNAL_NAME_PATTERN,
  type StreamSnapshot,
  type SubmissionSummary,
  type SubmitBlocker,
  type ViewContext,
  type Viewer,
} from "@mostra/protocol";
import { MostraError, targetUnavailable } from "./errors.ts";
import type { Journal, JournalEntry, MutationEntry, PendingEntry } from "./journal.ts";
import { NetworkError, type Transport } from "./transport.ts";

/** How long the page waits after the last edit before it saves (INTERFACES §2.3). */
export const SAVE_DEBOUNCE_MS = 400;

/** How long a submit waits for the event stream to reach the page's own last save. */
const CATCH_UP_MS = 5_000;

/** How soon waiting saves try again once the event stream shows the gateway answers. */
const RETRY_SOON_MS = 250;

/** The most ops one mutation carries (the browser protocol's limit). */
const OPS_PER_MUTATION = 1000;

/** A field's key in the store: its scope and ID. */
export type FieldKey = `${FieldScope}:${string}`;

/** A field's key. */
export const fieldKey = (scope: FieldScope, id: string): FieldKey => `${scope}:${id}`;

/** What the gateway says a field holds. */
interface ServerField {
  readonly value: unknown;
  /** The revision that last wrote it. */
  readonly revision: number;
  readonly deleted: boolean;
  readonly updatedBy?: Actor;
}

/** A conflict the viewer hasn't resolved: what the field holds now. */
export interface OpenConflict {
  readonly theirs: unknown;
  readonly deleted: boolean;
  /** The revision that wrote theirs: keeping mine writes over it. */
  readonly revision: number;
  readonly updatedBy?: Actor;
}

/** A mounted field, as `useField` declares it. */
export interface Registration {
  readonly id: string;
  readonly scope: FieldScope;
  readonly initial: unknown;
  readonly label?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  /** The current value's validation message, if any. */
  readonly error?: string;
}

/** The page's save state (D47): what the shell's rail and `FieldMeta.save` show. */
export type PageSave = "saved" | "saving" | "offline" | "conflict";

/** Where the runtime runs and what it may do. */
export type RuntimeMode =
  /** Behind Mostra's gateway in a shell's frame: everything works. */
  | "live"
  /** No gateway (a static export, a page opened outside its shell): values stay in this browser. */
  | "local";

/** The submission state `useSubmit` reports (INTERFACES §2.3). */
export type SubmitState =
  | "open"
  | "submitting"
  | "submitted"
  | "delivered"
  | "pending-delivery"
  | "undeliverable"
  | "closed";

/** Options for {@link Store}. */
export interface StoreOptions {
  readonly mode: RuntimeMode;
  /** The browser protocol, in live mode. */
  readonly transport?: Transport;
  /** The journal of unconfirmed edits. */
  readonly journal: Journal;
  /** The view this page is, in live mode (D104). */
  readonly view?: ViewContext;
  /** The link's scopes (D97): without `draft` the page saves nothing. */
  readonly scopes?: readonly string[];
  /** This tab's ID, unique per page load. */
  readonly tab: string;
  /** The tabs whose journal entries this page may adopt: those no longer open. */
  readonly goneTabs?: (tabs: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Runs `fn` while no other page of the artifact adopts journal entries (Web Locks). */
  readonly exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Where `local` mode keeps values; `localStorage` by default. */
  readonly local?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** The same-browser latency path (D22); never a source of truth. */
  readonly channel?: (name: string) => BroadcastChannel | undefined;
  /** Timers, replaceable in tests. */
  readonly timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** What a flush ends with: the draft revision every save reached, and whether some still wait. */
export interface FlushOutcome {
  readonly revision: number;
  readonly unsaved: boolean;
}

/** Deep equality for JSON values. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Whether a required field's value counts as missing. */
export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

const keyParts = (key: FieldKey): { scope: FieldScope; id: string } => {
  const at = key.indexOf(":");
  return { scope: key.slice(0, at) as FieldScope, id: key.slice(at + 1) };
};

/** The runtime's store of one page. */
export class Store {
  readonly mode: RuntimeMode;
  readonly view: ViewContext | undefined;
  readonly #options: StoreOptions;
  readonly #timers: NonNullable<StoreOptions["timers"]>;

  // What the gateway says.
  readonly #server = new Map<FieldKey, ServerField>();
  /** The revision the event stream reached, per document: every change up to it was seen. */
  readonly #seen: Record<FieldScope, number> = { viewer: 0, artifact: 0 };
  #epoch = 1;
  #viewer: Viewer | undefined;
  #submission: SubmissionSummary | undefined;
  /** Whether a submission closed the viewer's draft (`once`, D106). */
  #closed = false;

  // What the page holds that the gateway hasn't confirmed.
  readonly #pending = new Map<FieldKey, PendingEntry>();
  readonly #inflight = new Map<string, MutationEntry>();
  /** The value each in-flight mutation sends, per field. */
  readonly #sending = new Map<FieldKey, { readonly value: unknown; readonly mutationId: string }>();
  readonly #conflicts = new Map<FieldKey, OpenConflict>();
  /** Edits the gateway refused for good (too large, invalid): kept, shown with the reason. */
  readonly #refused = new Map<FieldKey, { readonly code: string; readonly message: string }>();
  /** Mutations waiting for the network, in order. */
  readonly #queue: MutationEntry[] = [];

  // Mounted fields.
  readonly #registrations = new Map<FieldKey, { registration: Registration; count: number }>();

  #ready = false;
  #readyWaiters: (() => void)[] = [];
  #online = true;
  #revoked = false;
  #debounce: unknown;
  #retry: unknown;
  #retryMs = 1_000;
  #sendingQueue = false;
  #seq = 0;
  #version = 0;
  readonly #listeners = new Set<() => void>();
  readonly #keyVersions = new Map<FieldKey, number>();
  #broadcast: BroadcastChannel | undefined;
  #submitState: SubmitState = "open";
  #catchUp: (() => void)[] = [];
  /**
   * Fields another writer changed whose new value the page hasn't got (a sensitive value isn't in
   * events, D52): an edit of one is based on what the page last had, so it conflicts instead of
   * overwriting, and a submit waits until a snapshot brings the value.
   */
  readonly #unknown = new Set<FieldKey>();
  #resyncing: Promise<void> | undefined;
  readonly #beforeSubmit = new Set<() => Promise<void>>();
  #stopStream: (() => void) | undefined;

  constructor(options: StoreOptions) {
    this.#options = options;
    this.mode = options.mode;
    this.view = options.view;
    this.#timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    if (options.view?.policy.policy === "none") this.#submitState = "closed";
  }

  // ── Subscription ───────────────────────────────────────────────────────────────────────

  /** Calls `listener` after every change; returns the function that stops. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** A number that changes with every change, for `useSyncExternalStore`. */
  version = (): number => this.#version;

  /** A number that changes whenever the field's value or meta may have. */
  keyVersion(key: FieldKey): number {
    return this.#keyVersions.get(key) ?? 0;
  }

  #changed(keys: Iterable<FieldKey> = []): void {
    this.#version += 1;
    for (const key of keys) this.#keyVersions.set(key, (this.#keyVersions.get(key) ?? 0) + 1);
    for (const listener of [...this.#listeners]) listener();
  }

  // ── Start ──────────────────────────────────────────────────────────────────────────────

  /** Whether the first snapshot arrived (or, in local mode, at once). */
  get ready(): boolean {
    return this.#ready;
  }

  /** Resolves once the store is ready, or after `timeoutMs`. */
  whenReady(timeoutMs: number = Number.POSITIVE_INFINITY): Promise<void> {
    if (this.#ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.#readyWaiters.push(resolve);
      if (Number.isFinite(timeoutMs)) this.#timers.setTimeout(resolve, timeoutMs);
    });
  }

  #markReady(): void {
    if (this.#ready) return;
    this.#ready = true;
    for (const resolve of this.#readyWaiters.splice(0)) resolve();
    this.#changed(this.#allKeys());
  }

  #allKeys(): FieldKey[] {
    return [...new Set([...this.#server.keys(), ...this.#registrations.keys()])];
  }

  /** Starts: subscribes to the event stream (live) or reads this browser's values (local). */
  start(): void {
    if (this.mode === "local") {
      this.#markReady();
      return;
    }
    const transport = this.#transport();
    this.#stopStream = transport.subscribe(undefined, {
      onSnapshot: (snapshot) => this.#applySnapshot(snapshot),
      onEvents: (events) => this.#applyEvents(events),
      onStatus: (status) => {
        if (status === "revoked") this.#revoked = true;
        const online = status === "live";
        if (online !== this.#online) {
          this.#online = online;
          if (online) this.#kickQueue();
          this.#changed(this.#allKeys());
        }
      },
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.#kickQueue());
    }
  }

  /** Stops the stream and timers (the page is going away, or a test ends). */
  stop(): void {
    this.#stopStream?.();
    this.#broadcast?.close();
    if (this.#debounce !== undefined) this.#timers.clearTimeout(this.#debounce);
    if (this.#retry !== undefined) this.#timers.clearTimeout(this.#retry);
  }

  #transport(): Transport {
    const transport = this.#options.transport;
    if (!transport) throw targetUnavailable("Saving");
    return transport;
  }

  // ── What the gateway says ──────────────────────────────────────────────────────────────

  #applySnapshot(snapshot: StreamSnapshot): void {
    this.#gatewayHeard();
    const first = this.#viewer === undefined;
    this.#viewer = snapshot.viewer;
    const touched = new Set<FieldKey>(this.#allKeys());
    // A snapshot replaces a document the page knows no newer revision of. One that is older than
    // events already applied (a resync answered after the stream moved on) only adds what it
    // knows newer, field by field: the stream's cursor is past those events, so they would never
    // come again (GPT review finding 11).
    const load = (scope: FieldScope, document: StreamSnapshot["draft"]): boolean => {
      const revision = Number(document.revision);
      const replace = first || revision >= this.#seen[scope];
      if (replace) {
        for (const key of [...this.#server.keys()]) {
          if (keyParts(key).scope === scope) this.#server.delete(key);
        }
        for (const key of [...this.#unknown]) {
          if (keyParts(key).scope === scope) this.#unknown.delete(key);
        }
        this.#seen[scope] = revision;
      }
      for (const [id, field] of Object.entries(document.fields)) {
        const key = fieldKey(scope, id);
        const current = this.#server.get(key);
        if (!replace && current && current.revision >= Number(field.revision)) continue;
        touched.add(key);
        this.#unknown.delete(key);
        this.#server.set(key, {
          value: field.value,
          revision: Number(field.revision),
          deleted: false,
          ...(field.updatedBy ? { updatedBy: field.updatedBy } : {}),
        });
      }
      return replace;
    };
    if (load("viewer", snapshot.draft)) this.#epoch = snapshot.draft.epoch;
    load("artifact", snapshot.state);
    if (snapshot.submission) this.#adoptSubmission(snapshot.submission, true);
    this.#resolveCatchUp();
    this.#changed(touched);
    if (first) {
      this.#openChannel();
      void this.#recoverJournal().finally(() => this.#markReady());
    }
  }

  #applyEvents(events: readonly EventRecord[]): void {
    this.#gatewayHeard();
    const touched = new Set<FieldKey>();
    let resync = false;
    for (const event of events) {
      const ownMutation =
        event.causation?.["mutationId"] !== undefined &&
        (this.#inflight.has(event.causation["mutationId"]) ||
          [...this.#sending.values()].some(
            (s) => s.mutationId === event.causation?.["mutationId"],
          ));
      if (event.type === "draft.changed" || event.type === "state.changed") {
        const scope: FieldScope = event.type === "draft.changed" ? "viewer" : "artifact";
        const payload = event.payload as {
          revision: string;
          epoch?: number;
          changes: { id: string; value?: unknown; deleted?: true; sensitive?: true }[];
        };
        const revision = Number(payload.revision);
        if (scope === "viewer" && payload.epoch !== undefined && payload.epoch > this.#epoch) {
          this.#epoch = payload.epoch;
        }
        for (const change of payload.changes) {
          const key = fieldKey(scope, change.id);
          touched.add(key);
          const current = this.#server.get(key);
          if (current && current.revision >= revision) continue;
          if (change.sensitive && !change.deleted) {
            // A sensitive value isn't in events (D52): the page's own value is known, another
            // writer's comes with a fresh snapshot.
            const mine = this.#sending.get(key);
            if (ownMutation && mine) {
              this.#server.set(key, {
                value: mine.value,
                revision,
                deleted: false,
                updatedBy: event.actor,
              });
            } else {
              // The page still shows the old value: until the snapshot brings the new one, an
              // edit conflicts and a submit waits (GPT review finding 4).
              this.#unknown.add(key);
              resync = true;
            }
            continue;
          }
          this.#unknown.delete(key);
          this.#server.set(key, {
            value: change.deleted ? undefined : change.value,
            revision,
            deleted: change.deleted === true,
            updatedBy: event.actor,
          });
        }
        this.#seen[scope] = Math.max(this.#seen[scope], revision);
      } else if (event.type === "submission.created") {
        const payload = event.payload as { submissionId: string; viewerId?: string };
        const own = payload.viewerId !== undefined && payload.viewerId === this.#viewer?.id;
        if (own && this.#submission?.id !== payload.submissionId) {
          // The viewer's own submission, made in another tab or by the shell's trusted Submit:
          // the snapshot carries it whole, with its deliveries.
          resync = true;
        } else if (!own && this.view?.policy.policy === "once") {
          // Under `once` for the whole artifact anyone's submission closes the draft (D106).
          if (this.view.policy.scope !== "per-viewer") {
            this.#closed = true;
            this.#submitState = "closed";
            for (const key of this.#allKeys()) touched.add(key);
          }
        }
      } else if (event.type.startsWith("submission.")) {
        this.#deliveryEvent(event);
      }
    }
    this.#resolveCatchUp();
    if (resync) void this.#resync();
    if (touched.size > 0) this.#changed(touched);
  }

  /** Loads a fresh snapshot, once at a time; a failure leaves it to the next event or submit. */
  #resync(): Promise<void> {
    this.#resyncing ??= (async () => {
      try {
        this.#applySnapshot(await this.#transport().snapshot());
      } catch {
        // The next event, reconnect or submit asks again.
      } finally {
        this.#resyncing = undefined;
      }
    })();
    return this.#resyncing;
  }

  // ── Reading ────────────────────────────────────────────────────────────────────────────

  /** Whether the gateway holds a value for the field (deleted fields don't count). */
  stored(key: FieldKey): boolean {
    const server = this.#server.get(key);
    return server !== undefined && !server.deleted;
  }

  /** The field's value as the viewer sees it: their edit, else the gateway's, else `fallback`. */
  value(key: FieldKey, fallback: unknown): unknown {
    if (this.mode === "local") {
      const stored = this.#localRead(key);
      const pending = this.#pending.get(key);
      if (pending) return pending.op.delete ? fallback : pending.op.value;
      return stored === undefined ? fallback : stored;
    }
    const pending = this.#pending.get(key);
    if (pending) return pending.op.delete ? fallback : pending.op.value;
    const sending = this.#sending.get(key);
    if (sending) return sending.value === undefined ? fallback : sending.value;
    const server = this.#server.get(key);
    if (server && !server.deleted) return server.value;
    return fallback;
  }

  /** The field's open conflict, if any. */
  conflict(key: FieldKey): OpenConflict | undefined {
    return this.#conflicts.get(key);
  }

  /** Who last wrote the field (artifact state, D63). */
  updatedBy(key: FieldKey): Actor | undefined {
    return this.#server.get(key)?.updatedBy;
  }

  /** Why the gateway refused the field's edit for good, if it did: its code and message. */
  refusal(key: FieldKey): { readonly code: string; readonly message: string } | undefined {
    return this.#refused.get(key);
  }

  /** Whether the field takes edits: not a closed draft, not a view-only link. */
  writable(key: FieldKey): boolean {
    if (this.mode === "local") return true;
    const { scope } = keyParts(key);
    if (!this.#canSave()) return false;
    return scope === "artifact" || !this.#closed;
  }

  /** Whether the link may submit (D97): its `submit` scope. */
  canSubmit(): boolean {
    return this.#options.scopes === undefined || this.#options.scopes.includes("submit");
  }

  #canSave(): boolean {
    return this.#options.scopes === undefined || this.#options.scopes.includes("draft");
  }

  /** The field's save state (INTERFACES §2.3). */
  save(key: FieldKey): "saved" | "saving" | "offline" | "conflict" | "readonly" {
    if (this.mode === "local") return "readonly";
    if (this.#conflicts.has(key)) return "conflict";
    if (!this.writable(key)) return "readonly";
    if (this.#refused.has(key)) return "offline";
    const unsent = this.#pending.has(key) || this.#sending.has(key);
    if (!unsent) return "saved";
    return this.#online && !this.#revoked ? "saving" : "offline";
  }

  /** The page's save state, for the shell's rail. */
  pageSave(): PageSave {
    if (this.mode === "local") return "saved";
    if (this.#conflicts.size > 0) return "conflict";
    const unsent = this.#pending.size > 0 || this.#inflight.size > 0 || this.#queue.length > 0;
    if (!unsent && this.#refused.size === 0) return "saved";
    return this.#online && !this.#revoked && this.#refused.size === 0 ? "saving" : "offline";
  }

  /** Whether edits wait to be saved. */
  unsaved(): boolean {
    return (
      this.#pending.size > 0 ||
      this.#inflight.size > 0 ||
      this.#queue.length > 0 ||
      this.#refused.size > 0
    );
  }

  /** The viewer the page acts as, once known. */
  viewer(): Viewer | undefined {
    return this.#viewer;
  }

  /** Every field ID of a scope the viewer sees, with its value (for `window.storage.list`). */
  ids(scope: FieldScope): string[] {
    const ids = new Set<string>();
    if (this.mode === "local") {
      for (const id of this.#localIds(scope)) ids.add(id);
    }
    for (const [key, server] of this.#server) {
      if (!server.deleted && key.startsWith(`${scope}:`)) ids.add(keyParts(key).id);
    }
    for (const key of [...this.#pending.keys(), ...this.#sending.keys()]) {
      if (key.startsWith(`${scope}:`)) ids.add(keyParts(key).id);
    }
    return [...ids].filter((id) => this.value(fieldKey(scope, id), undefined) !== undefined).sort();
  }

  // ── Mounted fields ─────────────────────────────────────────────────────────────────────

  /** Registers a mounted field; returns the function that unregisters it. */
  register(registration: Registration): () => void {
    const key = fieldKey(registration.scope, registration.id);
    const existing = this.#registrations.get(key);
    if (existing) {
      existing.count += 1;
      existing.registration = { ...registration, initial: existing.registration.initial };
    } else this.#registrations.set(key, { registration, count: 1 });
    this.#changed([key]);
    return () => {
      const entry = this.#registrations.get(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) this.#registrations.delete(key);
      this.#changed([key]);
    };
  }

  /** Updates a mounted field's options or validation message. */
  updateRegistration(registration: Registration): void {
    const key = fieldKey(registration.scope, registration.id);
    const entry = this.#registrations.get(key);
    if (!entry) return;
    const next = { ...registration, initial: entry.registration.initial };
    if (
      entry.registration.label === next.label &&
      entry.registration.required === next.required &&
      entry.registration.sensitive === next.sensitive &&
      entry.registration.error === next.error
    )
      return;
    entry.registration = next;
    this.#changed([key]);
  }

  /** Every mounted field. */
  registrations(): Registration[] {
    return [...this.#registrations.values()].map((entry) => entry.registration);
  }

  /** What blocks a submit now (INTERFACES §2.3): required, invalid and conflicting fields. */
  blockers(): SubmitBlocker[] {
    const blockers: SubmitBlocker[] = [];
    for (const [key, { registration }] of this.#registrations) {
      const label = registration.label !== undefined ? { label: registration.label } : {};
      if (this.#conflicts.has(key)) {
        blockers.push({ fieldId: registration.id, ...label, reason: "conflict" });
      } else if (registration.error !== undefined) {
        blockers.push({ fieldId: registration.id, ...label, reason: "invalid" });
      } else if (registration.required && isEmpty(this.value(key, registration.initial))) {
        blockers.push({ fieldId: registration.id, ...label, reason: "required" });
      }
    }
    return blockers.sort((a, b) => (a.fieldId < b.fieldId ? -1 : a.fieldId > b.fieldId ? 1 : 0));
  }

  // ── Editing ────────────────────────────────────────────────────────────────────────────

  /**
   * Sets a field: shown at once, journaled at once, sent after the debounce (`immediate` sends
   * now). Refused with `MOSTRA_FIELD_ID_INVALID` for an ID that isn't one; a closed draft or a
   * view-only link refuses with `MOSTRA_SUBMIT_ALREADY` or `MOSTRA_HYGIENE_SCOPE_DENIED`.
   */
  set(
    scope: FieldScope,
    id: string,
    value: unknown,
    options: {
      readonly label?: string;
      readonly required?: boolean;
      readonly sensitive?: boolean;
      readonly immediate?: boolean;
      readonly delete?: boolean;
    } = {},
  ): void {
    if (!isFieldId(id)) {
      throw new MostraError("MOSTRA_FIELD_ID_INVALID", `${JSON.stringify(id)} isn't a field ID.`);
    }
    const key = fieldKey(scope, id);
    if (!this.writable(key)) {
      throw this.#closed && scope === "viewer"
        ? new MostraError("MOSTRA_SUBMIT_ALREADY", "This draft was submitted and takes no edits.")
        : new MostraError("MOSTRA_HYGIENE_SCOPE_DENIED", "This link can't save answers.");
    }
    if (value !== undefined) {
      try {
        JSON.stringify(value);
      } catch {
        throw new MostraError("MOSTRA_HOST_INVALID_PARAMS", `The value of ${id} isn't JSON.`);
      }
    }
    // An edit keeps the field's label, `required` and `sensitive`: from this call, else the
    // earlier unsent edit, else the mounted field.
    const earlierOp = this.#pending.get(fieldKey(scope, id))?.op;
    const registered = this.#registrations.get(fieldKey(scope, id))?.registration;
    const label = options.label ?? earlierOp?.label ?? registered?.label;
    const required = options.required ?? earlierOp?.required ?? registered?.required;
    const sensitive = options.sensitive ?? earlierOp?.sensitive ?? registered?.sensitive;
    const op: FieldOp = {
      id,
      ...(options.delete || value === undefined ? { delete: true as const } : { value }),
      ...(label !== undefined ? { label } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
    };
    if (this.mode === "local") {
      this.#localWrite(key, op.delete ? undefined : op.value);
      this.#changed([key]);
      return;
    }
    const earlier = this.#pending.get(key);
    const entry: PendingEntry = {
      kind: "pending",
      viewerId: this.#viewer?.id ?? "",
      tab: this.#options.tab,
      viewId: this.view?.viewId ?? "",
      scope,
      op,
      base: earlier ? earlier.base : this.#baseFor(key),
      at: Date.now(),
    };
    this.#refused.delete(key);
    this.#pending.set(key, entry);
    // A conflict stays open until the viewer resolves it; the edit waits with it.
    if (entry.viewerId !== "") void this.#options.journal.putPending(entry).catch(() => undefined);
    this.#changed([key]);
    if (options.immediate) void this.flush();
    else this.#schedule();
  }

  /** The base of a new edit: what the page has seen of the field (null while it is in flight). */
  #baseFor(key: FieldKey): number | null {
    if (this.#sending.has(key)) return null;
    // A value the page hasn't got: based on what it last had, so the write conflicts.
    if (this.#unknown.has(key)) return this.#server.get(key)?.revision ?? 0;
    const { scope } = keyParts(key);
    return Math.max(this.#server.get(key)?.revision ?? 0, this.#seen[scope]);
  }

  #schedule(): void {
    if (this.#debounce !== undefined) this.#timers.clearTimeout(this.#debounce);
    this.#debounce = this.#timers.setTimeout(() => {
      this.#debounce = undefined;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Keeps the viewer's value of a conflicting field: written over theirs (FAILURE_MODEL §5). */
  keepMine(key: FieldKey): void {
    const conflict = this.#conflicts.get(key);
    const pending = this.#pending.get(key);
    if (!conflict || !pending) return;
    this.#conflicts.delete(key);
    const entry = { ...pending, base: conflict.revision, at: Date.now() };
    this.#pending.set(key, entry);
    void this.#options.journal.putPending(entry).catch(() => undefined);
    this.#changed([key]);
    void this.flush();
  }

  /** Takes the other writer's value of a conflicting field and drops the viewer's. */
  takeTheirs(key: FieldKey): void {
    const pending = this.#pending.get(key);
    this.#conflicts.delete(key);
    this.#refused.delete(key);
    this.#pending.delete(key);
    if (pending) void this.#options.journal.dropPending(pending).catch(() => undefined);
    this.#changed([key]);
  }

  // ── Saving ─────────────────────────────────────────────────────────────────────────────

  /**
   * Sends every edit now and waits for the answers. `keepalive` is for `pagehide`: the requests
   * outlive the page, and the journal keeps whatever they don't deliver (IN-02).
   */
  async flush(options: { readonly keepalive?: boolean } = {}): Promise<FlushOutcome> {
    if (this.mode === "local" || this.#viewer === undefined) {
      return { revision: this.#seen.viewer, unsaved: this.unsaved() };
    }
    if (this.#debounce !== undefined) {
      this.#timers.clearTimeout(this.#debounce);
      this.#debounce = undefined;
    }
    // Edits whose base waits for an earlier save stay until it answers; conflicts until resolved.
    const ready = [...this.#pending.entries()].filter(
      ([key, entry]) => entry.base !== null && !this.#conflicts.has(key) && !this.#refused.has(key),
    );
    const groups = new Map<string, PendingEntry[]>();
    for (const [, entry] of ready) {
      const group = `${entry.scope}\u0000${entry.base}`;
      const list = groups.get(group) ?? [];
      list.push(entry);
      groups.set(group, list);
    }
    const created: MutationEntry[] = [];
    for (const entries of groups.values()) {
      for (let start = 0; start < entries.length; start += OPS_PER_MUTATION) {
        const chunk = entries.slice(start, start + OPS_PER_MUTATION);
        const first = chunk[0] as PendingEntry;
        const mutation: MutationEntry = {
          kind: "mutation",
          viewerId: this.#viewer.id,
          tab: this.#options.tab,
          viewId: this.view?.viewId ?? first.viewId,
          scope: first.scope,
          mutationId: MutationId.create(),
          baseRevision: first.base as number,
          ops: chunk.map((entry) => entry.op),
          seq: Date.now() * 1000 + (this.#seq++ % 1000),
        };
        for (const entry of chunk) {
          const key = fieldKey(entry.scope, entry.op.id);
          this.#pending.delete(key);
          this.#sending.set(key, {
            value: entry.op.delete ? undefined : entry.op.value,
            mutationId: mutation.mutationId,
          });
        }
        void this.#options.journal.promote(mutation, chunk).catch(() => undefined);
        created.push(mutation);
        this.#queue.push(mutation);
      }
    }
    if (created.length > 0)
      this.#changed(created.flatMap((m) => m.ops.map((op) => fieldKey(m.scope, op.id))));
    await this.#drain(options.keepalive === true);
    return { revision: this.#ownRevision(), unsaved: this.unsaved() };
  }

  /** The draft revision the page's own saves reached. */
  #ownRevision(): number {
    let revision = this.#seen.viewer;
    for (const [key, server] of this.#server) {
      if (key.startsWith("viewer:")) revision = Math.max(revision, server.revision);
    }
    return revision;
  }

  /** Sends queued mutations one at a time, in order, until the queue is empty or the page is offline. */
  async #drain(keepalive: boolean): Promise<void> {
    if (keepalive) {
      // The page is closing: every request goes out now, outliving it.
      // A hidden page may come back: each answered request leaves the queue (GPT review finding 9).
      for (const mutation of [...this.#queue]) {
        void this.#send(mutation, true)
          .then((outcome) => {
            if (outcome === "done") this.#dequeue(mutation);
          })
          .catch(() => undefined);
      }
      return;
    }
    if (this.#sendingQueue) {
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (!this.#sendingQueue) resolve();
          else this.#timers.setTimeout(check, 20);
        };
        check();
      });
      if (this.#queue.length === 0) return;
    }
    this.#sendingQueue = true;
    try {
      while (this.#queue.length > 0 && !this.#revoked) {
        const head = this.#queue[0] as MutationEntry;
        const outcome = await this.#send(head, false);
        if (outcome === "retry") {
          this.#scheduleRetry();
          return;
        }
        this.#dequeue(head);
      }
      this.#retryMs = 1_000;
    } finally {
      this.#sendingQueue = false;
    }
  }

  /** Removes an answered mutation from the queue; the page's save state changes only now. */
  #dequeue(mutation: MutationEntry): void {
    const index = this.#queue.indexOf(mutation);
    if (index === -1) return;
    this.#queue.splice(index, 1);
    this.#changed(mutation.ops.map((op) => fieldKey(mutation.scope, op.id)));
  }

  /**
   * The event stream just brought something, so the gateway is reachable: saves waiting out a
   * backoff after a network failure try again soon instead of after up to 30 s (FAILURE_MODEL
   * §5, "on reconnect the journal replays"). The backoff itself isn't reset, so a path that keeps
   * failing while the stream works (a proxy refusing POSTs) is tried at most once per message.
   */
  #gatewayHeard(): void {
    if (this.#retry === undefined) return;
    this.#timers.clearTimeout(this.#retry);
    this.#retry = this.#timers.setTimeout(() => {
      this.#retry = undefined;
      void this.#drain(false);
    }, RETRY_SOON_MS);
  }

  #scheduleRetry(): void {
    if (this.#retry !== undefined) return;
    this.#retry = this.#timers.setTimeout(() => {
      this.#retry = undefined;
      void this.#drain(false);
    }, this.#retryMs);
    this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
  }

  #kickQueue(): void {
    if (this.#retry !== undefined) {
      this.#timers.clearTimeout(this.#retry);
      this.#retry = undefined;
    }
    this.#retryMs = 1_000;
    void this.flush();
  }

  /** Sends one mutation; `retry` when the network failed and it stays queued. */
  async #send(mutation: MutationEntry, keepalive: boolean): Promise<"done" | "retry"> {
    this.#inflight.set(mutation.mutationId, mutation);
    let result: MutationResult;
    try {
      result = await this.#transport().mutate(
        {
          mutationId: mutation.mutationId,
          scope: mutation.scope,
          baseRevision: String(mutation.baseRevision),
          viewId: mutation.viewId,
          ops: mutation.ops,
        },
        { keepalive },
      );
    } catch (error) {
      if (error instanceof NetworkError) {
        this.#online = false;
        this.#changed(mutation.ops.map((op) => fieldKey(mutation.scope, op.id)));
        return "retry";
      }
      return this.#refusedMutation(mutation, error);
    } finally {
      this.#inflight.delete(mutation.mutationId);
    }
    if (!this.#online) this.#online = true;
    this.#answered(mutation, result);
    return "done";
  }

  /** A mutation the gateway answered. */
  #answered(mutation: MutationEntry, result: MutationResult): void {
    const revision = Number(result.revision);
    const touched: FieldKey[] = [];
    const conflicts = new Map(result.conflicts.map((conflict) => [conflict.id, conflict]));
    const applied: { id: string; value: unknown }[] = [];
    for (const op of mutation.ops) {
      const key = fieldKey(mutation.scope, op.id);
      touched.push(key);
      const sending = this.#sending.get(key);
      const mine = op.delete ? undefined : op.value;
      if (sending?.mutationId === mutation.mutationId) this.#sending.delete(key);
      const conflict = conflicts.get(op.id);
      if (conflict) {
        this.#conflicted(key, op, conflict, mutation);
        continue;
      }
      if (result.applied.includes(op.id)) {
        const current = this.#server.get(key);
        if (!current || current.revision < revision) {
          this.#server.set(key, {
            value: mine,
            revision,
            deleted: op.delete === true,
            updatedBy: { kind: "viewer", ...(this.#viewer ? { id: this.#viewer.id } : {}) },
          });
        }
        applied.push({ id: op.id, value: mine });
        // A later edit of the field, made while this one was in flight, is based on it.
        const later = this.#pending.get(key);
        if (later && later.base === null) {
          const based = { ...later, base: revision };
          this.#pending.set(key, based);
          void this.#options.journal.putPending(based).catch(() => undefined);
        }
      }
    }
    void this.#options.journal.remove(mutation.mutationId).catch(() => undefined);
    if (applied.length > 0) {
      this.#broadcast?.postMessage({
        kind: "applied",
        scope: mutation.scope,
        revision,
        changes: applied,
      });
    }
    this.#resolveCatchUp();
    this.#changed(touched);
    // Edits that waited for this answer can go now.
    if ([...this.#pending.values()].some((entry) => entry.base !== null)) this.#schedule();
  }

  #conflicted(key: FieldKey, op: FieldOp, conflict: FieldConflict, mutation: MutationEntry): void {
    const theirs = conflict.deleted ? undefined : conflict.value;
    const mine = op.delete ? undefined : op.value;
    this.#unknown.delete(key);
    this.#server.set(key, {
      value: theirs,
      revision: Number(conflict.revision),
      deleted: conflict.deleted === true,
      ...(conflict.updatedBy ? { updatedBy: conflict.updatedBy } : {}),
    });
    const later = this.#pending.get(key);
    // The same value written twice (a replay of an edit that already landed) is no conflict.
    if (same(theirs, later ? (later.op.delete ? undefined : later.op.value) : mine)) {
      if (later) {
        this.#pending.delete(key);
        void this.#options.journal.dropPending(later).catch(() => undefined);
      }
      return;
    }
    // The viewer's value stays as a held edit, shown as theirs to keep or drop. It keeps the
    // base it was made on, so a page that replays it from the journal meets the same conflict
    // instead of writing over theirs; only `keepMine()` moves it to their revision (GPT review
    // finding 1).
    const held: PendingEntry =
      later !== undefined
        ? later.base === null
          ? { ...later, base: mutation.baseRevision }
          : later
        : {
            kind: "pending",
            viewerId: mutation.viewerId,
            tab: this.#options.tab,
            viewId: mutation.viewId,
            scope: mutation.scope,
            op,
            base: mutation.baseRevision,
            at: Date.now(),
          };
    this.#pending.set(key, held);
    void this.#options.journal.putPending(held).catch(() => undefined);
    this.#conflicts.set(key, {
      theirs,
      deleted: conflict.deleted === true,
      revision: Number(conflict.revision),
      ...(conflict.updatedBy ? { updatedBy: conflict.updatedBy } : {}),
    });
  }

  /** A mutation the gateway refused: dropped from the queue, its values handled per refusal. */
  async #refusedMutation(mutation: MutationEntry, error: unknown): Promise<"done" | "retry"> {
    const code = error instanceof MostraError ? error.code : "MOSTRA_HOST_INTERNAL_ERROR";
    const keys = mutation.ops.map((op) => fieldKey(mutation.scope, op.id));
    const forget = (): void => {
      for (const key of keys) {
        const sending = this.#sending.get(key);
        if (sending?.mutationId === mutation.mutationId) this.#sending.delete(key);
      }
      void this.#options.journal.remove(mutation.mutationId).catch(() => undefined);
    };
    switch (code) {
      case "MOSTRA_HYGIENE_TOKEN_REVOKED":
        // The link died: the journal keeps the edits for a working link (FAILURE_MODEL §8).
        this.#revoked = true;
        this.#changed(keys);
        return "retry";
      case "MOSTRA_SUBMIT_VIEW_INVALID":
        // A view another link opened (an adopted entry): replay it as this page's view.
        if (this.view && mutation.viewId !== this.view.viewId) {
          const moved = { ...mutation, viewId: this.view.viewId };
          this.#queue[0] = moved;
          void this.#options.journal.promote(moved, []).catch(() => undefined);
          return this.#send(moved, false);
        }
        break;
      case "MOSTRA_SUBMIT_ALREADY":
        // A `once` submission closed the draft; these edits can't land (D106).
        this.#closed = true;
        forget();
        this.#changed(this.#allKeys());
        return "done";
      case "MOSTRA_HOME_DISK_FULL":
      case "MOSTRA_HOME_GONE":
      case "MOSTRA_HOST_INTERNAL_ERROR":
        // The gateway's trouble, not the edit's: it waits and retries (FAILURE_MODEL §3).
        this.#online = false;
        this.#changed(keys);
        return "retry";
      default:
        break;
    }
    // Refused for good (too large, an invalid ID or value): the value stays on the page, not
    // truncated, with the reason, and isn't sent again until the viewer changes it.
    const message = error instanceof Error ? error.message : String(error);
    for (const op of mutation.ops) {
      const key = fieldKey(mutation.scope, op.id);
      if (!this.#pending.has(key)) {
        const held: PendingEntry = {
          kind: "pending",
          viewerId: mutation.viewerId,
          tab: this.#options.tab,
          viewId: mutation.viewId,
          scope: mutation.scope,
          op,
          base: mutation.baseRevision,
          at: Date.now(),
        };
        this.#pending.set(key, held);
        // Journaled before the mutation is forgotten: the next page still has the value (GPT
        // review finding 7).
        void this.#options.journal.putPending(held).catch(() => undefined);
      }
      this.#refused.set(key, { code, message });
    }
    forget();
    this.#changed(keys);
    return "done";
  }

  // ── The journal ────────────────────────────────────────────────────────────────────────

  /**
   * Replays what earlier pages left: this tab's entries (none on a fresh load) and those of tabs
   * that are gone, mutations first in their order, then pending edits (IN-02, IN-04).
   */
  #recoverJournal(): Promise<void> {
    const exclusive = this.#options.exclusive ?? (<T>(fn: () => Promise<T>) => fn());
    return exclusive(() => this.#adoptJournal()).catch(() => undefined);
  }

  async #adoptJournal(): Promise<void> {
    const viewerId = this.#viewer?.id;
    if (!viewerId) return;
    let contents: Awaited<ReturnType<Journal["load"]>>;
    try {
      contents = await this.#options.journal.load(viewerId);
    } catch {
      return;
    }
    const tabs = [
      ...new Set([...contents.pending, ...contents.mutations].map((entry) => entry.tab)),
    ].filter((tab) => tab !== this.#options.tab);
    const gone = this.#options.goneTabs ? await this.#options.goneTabs(tabs) : new Set(tabs);
    const mutations = contents.mutations.filter((entry) => gone.has(entry.tab));
    // Edits of one field left by several closed tabs: the newest stays an edit, the older ones
    // become mutations of their own, sent first, so each is saved or meets the others as a
    // conflict; adopting them under this tab would otherwise keep only one (GPT review finding 6).
    const pending: PendingEntry[] = [];
    const newest = new Map<FieldKey, PendingEntry>();
    for (const entry of contents.pending
      .filter((candidate) => gone.has(candidate.tab))
      .sort((a, b) => a.at - b.at)) {
      const key = fieldKey(entry.scope, entry.op.id);
      const earlier = newest.get(key);
      if (earlier) {
        const promoted: MutationEntry = {
          kind: "mutation",
          viewerId: earlier.viewerId,
          tab: earlier.tab,
          viewId: earlier.viewId,
          scope: earlier.scope,
          mutationId: MutationId.create(),
          baseRevision:
            earlier.base ?? this.#server.get(key)?.revision ?? this.#seen[earlier.scope],
          ops: [earlier.op],
          seq: earlier.at * 1000,
        };
        try {
          await this.#options.journal.promote(promoted, [earlier]);
        } catch {
          return;
        }
        mutations.push(promoted);
        pending.splice(pending.indexOf(earlier), 1);
      }
      newest.set(key, entry);
      pending.push(entry);
    }
    const adopted: JournalEntry[] = [...mutations.sort((a, b) => a.seq - b.seq), ...pending];
    if (adopted.length === 0) return;
    try {
      await this.#options.journal.adopt(adopted, this.#options.tab);
    } catch {
      return;
    }
    const touched: FieldKey[] = [];
    for (const entry of adopted) {
      if (entry.kind !== "mutation") continue;
      const mutation = { ...entry, tab: this.#options.tab };
      for (const op of mutation.ops) {
        const key = fieldKey(mutation.scope, op.id);
        touched.push(key);
        this.#sending.set(key, {
          value: op.delete ? undefined : op.value,
          mutationId: mutation.mutationId,
        });
      }
      this.#queue.push(mutation);
    }
    for (const entry of adopted) {
      if (entry.kind !== "pending") continue;
      const key = fieldKey(entry.scope, entry.op.id);
      touched.push(key);
      if (this.#pending.has(key)) continue;
      const base = entry.base ?? (this.#sending.has(key) ? null : this.#baseFor(key));
      this.#pending.set(key, { ...entry, tab: this.#options.tab, base });
    }
    this.#changed(touched);
    void this.flush();
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────────────────

  #openChannel(): void {
    const viewerId = this.#viewer?.id;
    const artifactId = this.view?.artifactId;
    if (!viewerId || !artifactId || !this.#options.channel) return;
    this.#broadcast = this.#options.channel(`mostra:${artifactId}:${viewerId}`);
    if (!this.#broadcast) return;
    this.#broadcast.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        kind?: string;
        scope?: FieldScope;
        revision?: number;
        changes?: { id: string; value: unknown }[];
      };
      if (data.kind !== "applied" || !data.scope || typeof data.revision !== "number") return;
      const touched: FieldKey[] = [];
      for (const change of data.changes ?? []) {
        const key = fieldKey(data.scope, change.id);
        const current = this.#server.get(key);
        // Only ever newer: the event stream stays the source of truth (D22).
        if (current && current.revision >= data.revision) continue;
        this.#server.set(key, {
          value: change.value,
          revision: data.revision,
          deleted: change.value === undefined,
          ...(current?.updatedBy ? { updatedBy: current.updatedBy } : {}),
        });
        touched.push(key);
      }
      if (touched.length > 0) this.#changed(touched);
    };
  }

  // ── Submitting ─────────────────────────────────────────────────────────────────────────

  /** The submission state (INTERFACES §2.3). */
  submitState(): SubmitState {
    return this.#submitState;
  }

  /** The viewer's submission, once made or known. */
  submission(): SubmissionSummary | undefined {
    return this.#submission;
  }

  /** Whether a submission closed the viewer's draft. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Gets the draft ready for a submit (D110, IN-02): writes the initial values of mounted viewer
   * fields the gateway never stored, saves everything, waits until the event stream reached the
   * page's own last save, and reports what still blocks.
   */
  /**
   * Adds a check that runs before every submit, either channel's: an adapter whose library
   * validates on its own schedule (react-hook-form validates on submit by default) runs its
   * validation here and updates its registrations, so the blockers are current. Returns the
   * function that removes it.
   */
  beforeSubmit(check: () => Promise<void>): () => void {
    this.#beforeSubmit.add(check);
    return () => this.#beforeSubmit.delete(check);
  }

  async prepareSubmit(): Promise<{
    readonly revision: number;
    readonly unsaved: boolean;
    readonly blockers: SubmitBlocker[];
  }> {
    if (this.mode === "local") throw targetUnavailable("Submitting");
    await this.whenReady(CATCH_UP_MS);
    // A check that fails can't stop the viewer's submit: it is the adapter's, and its own
    // errors stay visible on its fields.
    await Promise.allSettled([...this.#beforeSubmit].map((check) => check()));
    for (const [key, { registration }] of this.#registrations) {
      if (registration.scope !== "viewer" || !this.writable(key)) continue;
      if (this.stored(key) || this.#pending.has(key) || this.#sending.has(key)) continue;
      if (registration.initial === undefined) continue;
      this.set("viewer", registration.id, registration.initial, {
        ...(registration.label !== undefined ? { label: registration.label } : {}),
        ...(registration.required !== undefined ? { required: registration.required } : {}),
        ...(registration.sensitive !== undefined ? { sensitive: registration.sensitive } : {}),
      });
    }
    const flushed = await this.flush();
    await this.#caughtUp(flushed.revision);
    // A value another writer changed that the page hasn't got: the page doesn't show what would
    // be submitted until a snapshot brings it.
    if (this.#unknown.size > 0) await this.#resync();
    return {
      revision: Math.max(this.#seen.viewer, flushed.revision),
      unsaved: this.unsaved() || this.#unknown.size > 0,
      blockers: this.blockers(),
    };
  }

  /** Waits until the event stream reached `revision` of the draft, or a while. */
  #caughtUp(revision: number): Promise<void> {
    if (this.#seen.viewer >= revision) return Promise.resolve();
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.#seen.viewer >= revision) resolve();
        else this.#catchUp.push(check);
      };
      this.#catchUp.push(check);
      this.#timers.setTimeout(resolve, CATCH_UP_MS);
    });
  }

  #resolveCatchUp(): void {
    for (const check of this.#catchUp.splice(0)) check();
  }

  /**
   * Submits through the artifact channel (D40), where the view allows it: prepares the draft,
   * refuses with `MOSTRA_SUBMIT_BLOCKED` while a field blocks, and submits the revision the
   * viewer saw.
   */
  async submit(): Promise<SubmissionSummary> {
    if (this.mode === "local") throw targetUnavailable("Submitting");
    const view = this.view;
    if (view && !view.submitChannels.includes("artifact")) {
      throw new MostraError(
        "MOSTRA_SUBMIT_CHANNEL_DENIED",
        "This host takes submissions from the shell's trusted Submit only.",
      );
    }
    if (view?.policy.policy === "none") {
      throw new MostraError(
        "MOSTRA_SUBMIT_POLICY_NONE",
        "This artifact's submission policy is none: it takes no submissions.",
      );
    }
    if (!this.canSubmit()) {
      throw new MostraError(
        "MOSTRA_HYGIENE_SCOPE_DENIED",
        "This link doesn't carry the submit scope.",
      );
    }
    const previous = this.#submitState;
    this.#submitState = "submitting";
    this.#changed();
    try {
      const prepared = await this.prepareSubmit();
      if (prepared.blockers.length > 0) {
        throw new MostraError(
          "MOSTRA_SUBMIT_BLOCKED",
          `Not submitted: ${prepared.blockers.map((b) => b.label ?? b.fieldId).join(", ")} ${prepared.blockers.length === 1 ? "needs" : "need"} attention.`,
          { body: { blockers: prepared.blockers } },
        );
      }
      if (prepared.unsaved) {
        throw new MostraError(
          "MOSTRA_SUBMIT_BLOCKED",
          "Not submitted: some answers aren't saved yet. Try again when the page is back online.",
          { body: { blockers: [] } },
        );
      }
      const submission = await this.#transport().submit({
        viewId: view?.viewId ?? "",
        expectedRevision: String(prepared.revision),
        channel: "artifact",
      });
      this.#adoptSubmission(submission, false);
      // The page sees the submission, and a closed draft, at once (IN-13).
      this.#changed(this.#allKeys());
      return submission;
    } catch (error) {
      if (error instanceof MostraError && error.code === "MOSTRA_SUBMIT_ALREADY") {
        const existing = error.body?.["submission"] as SubmissionSummary | undefined;
        if (existing) this.#adoptSubmission(existing, false);
        else this.#submitState = "closed";
      } else {
        this.#submitState = previous === "submitting" ? "open" : previous;
        if (error instanceof MostraError && error.code === "MOSTRA_SUBMIT_REVISION_MOVED") {
          // The draft changed elsewhere: the page shows it before the viewer submits again.
          await this.#resync();
        }
      }
      this.#changed();
      throw error;
    }
  }

  /** Raises a signal for the host's attention (IN-09). */
  async signal(name: string, payload?: unknown): Promise<void> {
    if (this.mode === "local") throw targetUnavailable("Sending a signal");
    if (!SIGNAL_NAME_PATTERN.test(name) || name === "submit") {
      throw new MostraError(
        "MOSTRA_SUBMIT_SIGNAL_INVALID",
        `${JSON.stringify(name)} isn't a signal name: use letters, digits, ".", "_" and "-"; "submit" is the shell's.`,
      );
    }
    await this.#transport().signal({
      viewId: this.view?.viewId ?? "",
      name,
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  /** Takes a submission the page made, or learned of, as the viewer's. */
  adoptSubmission(submission: SubmissionSummary): void {
    this.#adoptSubmission(submission, false);
    this.#changed();
  }

  #adoptSubmission(submission: SubmissionSummary, fromSnapshot: boolean): void {
    this.#submission = submission;
    const policy = this.view?.policy;
    // Under `epochs` the draft goes on to the next round; under `once` it is closed.
    if (policy?.policy !== "epochs" || submission.epoch === this.#epoch) {
      if (policy?.policy === "once" || policy === undefined) this.#closed = true;
    }
    if (policy?.policy === "epochs" && fromSnapshot && submission.epoch < this.#epoch) {
      this.#submitState = "open";
      return;
    }
    this.#submitState = deliveryState(submission);
  }

  #deliveryEvent(event: EventRecord): void {
    const submission = this.#submission;
    const payload = event.payload as {
      submissionId?: string;
      deliveryId?: string;
      owner?: string;
      reason?: string;
    };
    if (!submission || payload.submissionId !== submission.id) return;
    const kind = event.type.slice("submission.".length);
    const state =
      kind === "delivered"
        ? "delivered"
        : kind === "rejected"
          ? "rejected"
          : kind === "undeliverable"
            ? "undeliverable"
            : "pending";
    const deliveries = (submission.deliveries ?? []).map((delivery) =>
      delivery.deliveryId === payload.deliveryId
        ? {
            ...delivery,
            state,
            ...(kind === "retrying" ? { waiting: true as const } : {}),
            ...(payload.reason !== undefined && kind !== "retrying"
              ? { reason: payload.reason }
              : {}),
            updatedAt: event.at,
          }
        : delivery,
    ) as NonNullable<SubmissionSummary["deliveries"]>;
    this.#submission = { ...submission, deliveries, delivery: worst(deliveries) };
    this.#submitState = deliveryState(this.#submission);
    this.#changed();
  }

  // ── Local mode ─────────────────────────────────────────────────────────────────────────

  #localStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
    if (this.#options.local) return this.#options.local;
    try {
      return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      return undefined;
    }
  }

  #localRead(key: FieldKey): unknown {
    const text = this.#localStorage()?.getItem(`mostra.field.${key}`);
    if (text === null || text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  #localWrite(key: FieldKey, value: unknown): void {
    const storage = this.#localStorage();
    try {
      if (value === undefined) storage?.removeItem(`mostra.field.${key}`);
      else storage?.setItem(`mostra.field.${key}`, JSON.stringify(value));
    } catch {
      // A full or refused localStorage keeps the value for this page only.
      this.#pending.set(key, {
        kind: "pending",
        viewerId: "",
        tab: this.#options.tab,
        viewId: "",
        scope: keyParts(key).scope,
        op:
          value === undefined
            ? { id: keyParts(key).id, delete: true }
            : { id: keyParts(key).id, value },
        base: 0,
        at: Date.now(),
      });
    }
  }

  #localIds(scope: FieldScope): string[] {
    const storage = this.#localStorage() as Storage | undefined;
    if (!storage || typeof storage.length !== "number") return [];
    const prefix = `mostra.field.${scope}:`;
    const ids: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index);
      if (name?.startsWith(prefix)) ids.push(name.slice(prefix.length));
    }
    return ids;
  }
}

const SEVERITY = { delivered: 0, pending: 1, rejected: 2, undeliverable: 3 } as const;

function worst(
  deliveries: NonNullable<SubmissionSummary["deliveries"]>,
): SubmissionSummary["delivery"] {
  let result: SubmissionSummary["delivery"] = "delivered";
  for (const delivery of deliveries) {
    if (SEVERITY[delivery.state] > SEVERITY[result]) result = delivery.state;
  }
  return result;
}

/** The submission's state as the viewer sees it (IN-13, D47). */
export function deliveryState(submission: SubmissionSummary): SubmitState {
  const deliveries = submission.deliveries ?? [];
  if (submission.delivery === "undeliverable" || submission.delivery === "rejected") {
    return "undeliverable";
  }
  if (submission.delivery === "delivered") return "delivered";
  return deliveries.some((delivery) => delivery.state === "pending" && delivery.waiting)
    ? "pending-delivery"
    : "submitted";
}
