/**
 * The client runtime's hooks (INTERFACES §2.3, D52, D53, D113): fields that behave like
 * `useState` with a stable ID, the artifact channel's submit, the shell's trusted Submit label,
 * signals, choices, the viewer and the artifact. Every hook works in every delivery target: where
 * there is no Mostra server (a static export), fields keep their values in this browser, and
 * submit and signals reject with `MOSTRA_TARGET_UNAVAILABLE`.
 */
import {
  type Actor,
  type ControlRequest,
  type FieldScope,
  mostraControlsRequest,
  type SubmissionSummary,
  type SubmitBlocker,
} from "@mostra/protocol";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { MostraError } from "./runtime/errors.ts";
import { MemoryJournal } from "./runtime/journal.ts";
import { type FieldKey, fieldKey, Store, type SubmitState } from "./runtime/store.ts";
import { connectShell } from "./shell-bridge.ts";

/** Where the artifact runs (D111): Mostra's gateway, a static export, an MCP App, or `verify`. */
export type ArtifactMode = "live" | "static" | "mcp-app" | "verify";

interface RuntimeValue {
  readonly store: Store;
  readonly mode: ArtifactMode;
}

const RuntimeContext = createContext<RuntimeValue | undefined>(undefined);

let fallback: RuntimeValue | undefined;

/** The runtime of a tree rendered outside `mountArtifact` (a test, a component gallery): local. */
function fallbackRuntime(): RuntimeValue {
  if (!fallback) {
    const store = new Store({ mode: "local", journal: new MemoryJournal(), tab: "fallback" });
    store.start();
    fallback = { store, mode: "static" };
  }
  return fallback;
}

/** Provides a runtime to a tree; `mountArtifact` renders the page inside it. */
export function RuntimeProvider(props: {
  readonly store: Store;
  readonly mode: ArtifactMode;
  readonly children?: ReactNode;
}): ReactNode {
  const value = useMemo(
    () => ({ store: props.store, mode: props.mode }),
    [props.store, props.mode],
  );
  return createElement(RuntimeContext.Provider, { value }, props.children);
}

function useRuntime(): RuntimeValue {
  return useContext(RuntimeContext) ?? fallbackRuntime();
}

/** The page's store, for the package's own adapters (`@mostra/react/form`). @internal */
export function useStore(): Store {
  return useRuntime().store;
}

/** Re-renders on every change of the store; returns its version. */
function useStoreVersion(store: Store): number {
  return useSyncExternalStore(store.subscribe, store.version, store.version);
}

// ── useField ────────────────────────────────────────────────────────────────────────────

/**
 * A Standard Schema validator (`~standard`), such as a Zod 4 schema: what `validate` takes besides
 * a function.
 */
export interface StandardSchema<T> {
  /** The Standard Schema interface (version 1). */
  readonly "~standard": {
    /** Checks a value: issues when it is invalid. */
    validate(
      value: unknown,
    ): { readonly issues?: readonly { readonly message: string }[] } | Promise<unknown>;
    /** The type the schema accepts. */
    readonly types?: { readonly input: T; readonly output: T } | undefined;
  };
}

/** Options of {@link useField} (D52). */
export interface FieldOptions<T> {
  /** The label people see in results and the shell's list of missing answers. */
  readonly label?: string;
  /** A submit needs a value: the shell and `useSubmit` list it until it has one. */
  readonly required?: boolean;
  /** Kept in the submission, left out of events and logs. */
  readonly sensitive?: boolean;
  /** A Zod (or any Standard Schema) schema, or a function returning a message for a bad value. */
  readonly validate?: StandardSchema<T> | ((value: T) => string | undefined);
  /** `viewer` (default): the viewer's draft. `artifact`: shared state every viewer sees (D63). */
  readonly scope?: FieldScope;
}

/** What a field is doing (INTERFACES §2.3). */
export interface FieldMeta<T> {
  /**
   * `saved`; `saving`; `offline` (not saved yet: no connection, or the gateway refused it, with
   * `error`); `conflict` (another writer changed it: see `conflict`); `readonly` (submitted under
   * `once`, a view-only link, or a copy of the page without a Mostra server).
   */
  readonly save: "saved" | "saving" | "offline" | "conflict" | "readonly";
  /** The validation message for the current value, or why the gateway refused it. */
  readonly error?: string;
  /** Another writer changed the field since the viewer's edit: keep theirs or mine. */
  readonly conflict?: { readonly theirs: T; keepMine(): void; takeTheirs(): void };
  /** Who last wrote the field (artifact scope, D63). */
  readonly updatedBy?: { readonly kind: "viewer" | "agent" | "host"; readonly name?: string };
}

/** What a field's validator says of a value: now, or once its asynchronous check settles. */
type Validation =
  | { readonly kind: "now"; readonly error: string | undefined }
  | { readonly kind: "later"; readonly settled: Promise<string | undefined> };

/** The message shown while an asynchronous check runs; it blocks a submit until it settles. */
const CHECKING = "Checking this answer…";

function messageOf(result: unknown): string | undefined {
  const issues = (result as { issues?: readonly { message: string }[] } | undefined)?.issues;
  return issues && issues.length > 0 ? (issues[0]?.message ?? "Invalid value.") : undefined;
}

function validationOf<T>(validate: FieldOptions<T>["validate"], value: T): Validation {
  if (validate === undefined) return { kind: "now", error: undefined };
  if (typeof validate === "function") return { kind: "now", error: validate(value) ?? undefined };
  const result = validate["~standard"].validate(value);
  if (result instanceof Promise) {
    // A Standard Schema may check asynchronously (Zod's async refinements): the answer counts
    // only once the check settles (GPT review finding 14).
    return {
      kind: "later",
      settled: result.then(messageOf, () => "This answer couldn't be checked."),
    };
  }
  return { kind: "now", error: messageOf(result) };
}

function updatedByOf(actor: Actor | undefined): FieldMeta<unknown>["updatedBy"] {
  if (!actor || actor.kind === "mostra") return undefined;
  return { kind: actor.kind, ...(actor.name !== undefined ? { name: actor.name } : {}) };
}

const warned = new Set<string>();

/**
 * A persisted value with a stable field ID (D52). It behaves like `useState`: the value the viewer
 * sees, a setter, and what the field is doing. Edits save to Mostra as the viewer works, survive
 * reloads, closed tabs and other devices, reach other tabs, and carry over to newer versions by
 * ID. Dotted IDs (`reply.m1`) nest in results.
 *
 * ```tsx
 * const [layout, setLayout, meta] = useField("layout", "a", { label: "Layout", required: true });
 * ```
 */
export function useField<T>(
  id: string,
  initial: T,
  // `NoInfer`: the type comes from `initial`, as `useState`'s does; a validator annotated
  // `(value: number)` must not narrow `useField("count", 1)` to the literal type `1`.
  options: FieldOptions<NoInfer<T>> = {},
): [T, (next: T | ((previous: T) => T)) => void, FieldMeta<T>] {
  const { store } = useRuntime();
  const scope = options.scope ?? "viewer";
  const key = fieldKey(scope, id);
  // The first render's initial value, as `useState` keeps it.
  const [first] = useState(() => initial);
  useSyncExternalStore(
    store.subscribe,
    () => store.keyVersion(key),
    () => store.keyVersion(key),
  );
  const value = store.value(key, first) as T;
  const { validate } = options;
  const validation = useMemo(() => validationOf(validate, value), [validate, value]);
  const [settled, setSettled] = useState<{ of: Validation; error: string | undefined }>();
  useEffect(() => {
    if (validation.kind !== "later") return;
    let current = true;
    void validation.settled.then((message) => {
      if (current) setSettled({ of: validation, error: message });
    });
    return () => {
      current = false;
    };
  }, [validation]);
  const error =
    validation.kind === "now"
      ? validation.error
      : settled?.of === validation
        ? settled.error
        : CHECKING;
  const { label, required, sensitive } = options;

  // Registered once per mount and ID; the next effect keeps its options current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: options change through updateRegistration.
  useEffect(
    () =>
      store.register({
        id,
        scope,
        initial: first,
        ...(label !== undefined ? { label } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(sensitive !== undefined ? { sensitive } : {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the next effect keeps the options current.
    [store, id, scope, first],
  );
  useEffect(() => {
    store.updateRegistration({
      id,
      scope,
      initial: first,
      ...(label !== undefined ? { label } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  });
  // A submit waits for an asynchronous check of the value it would send, then counts its answer.
  useEffect(() => {
    if (validation.kind !== "later") return;
    return store.beforeSubmit(async () => {
      const message = await validation.settled;
      store.updateRegistration({
        id,
        scope,
        initial: first,
        ...(label !== undefined ? { label } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(sensitive !== undefined ? { sensitive } : {}),
        ...(message !== undefined ? { error: message } : {}),
      });
    });
  }, [store, validation, id, scope, first, label, required, sensitive]);

  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      if (!store.writable(key)) {
        if (!warned.has(key)) {
          warned.add(key);
          console.warn(
            `Mostra: the field ${id} is read-only here (submitted, or a view-only link); the change was not kept.`,
          );
        }
        return;
      }
      const previous = store.value(key, first) as T;
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(previous) : (next as T);
      store.set(scope, id, resolved, {
        ...(label !== undefined ? { label } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(sensitive !== undefined ? { sensitive } : {}),
      });
    },
    [store, key, scope, id, label, required, sensitive, first],
  );

  const conflict = store.conflict(key);
  const refusal = store.refusal(key);
  const save = store.save(key);
  const writer = updatedByOf(store.updatedBy(key));
  const writerKind = writer?.kind;
  const writerName = writer?.name;
  const meta = useMemo((): FieldMeta<T> => {
    const message = error ?? refusal?.message;
    const updatedBy =
      writerKind === undefined
        ? undefined
        : { kind: writerKind, ...(writerName !== undefined ? { name: writerName } : {}) };
    return {
      save,
      ...(message !== undefined ? { error: message } : {}),
      ...(conflict
        ? {
            conflict: {
              theirs: (conflict.deleted ? first : conflict.theirs) as T,
              keepMine: () => store.keepMine(key),
              takeTheirs: () => store.takeTheirs(key),
            },
          }
        : {}),
      ...(scope === "artifact" && updatedBy ? { updatedBy } : {}),
    };
  }, [save, error, refusal, conflict, writerKind, writerName, store, key, scope, first]);
  return [value, set, meta];
}

// ── useSubmit ───────────────────────────────────────────────────────────────────────────

/** What `useSubmit` returns (INTERFACES §2.3). */
export interface SubmitHandle {
  /**
   * Submits the viewer's draft through the artifact's own code (D40). Rejects with
   * `MOSTRA_SUBMIT_CHANNEL_DENIED` where the host takes the shell's trusted Submit only,
   * `MOSTRA_SUBMIT_BLOCKED` while a field blocks, `MOSTRA_SUBMIT_ALREADY` under a closed `once`.
   */
  submit(): Promise<SubmissionSummary>;
  /** Whether `submit()` can work here: the host allows the artifact channel and the draft is open. */
  readonly allowed: boolean;
  /** What blocks a submit now. */
  readonly blockers: readonly SubmitBlocker[];
  /** Where the submission stands (IN-13). */
  readonly state: SubmitState;
  /** The viewer's submission, once made. */
  readonly submission?: { readonly id: string; readonly at: string };
}

/** The artifact channel's submit, the blockers and the submission's state (D40, IN-13). */
export function useSubmit(): SubmitHandle {
  const { store } = useRuntime();
  const version = useStoreVersion(store);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version stands for the store's state.
  return useMemo((): SubmitHandle => {
    const view = store.view;
    const state = store.submitState();
    const submission = store.submission();
    const openState =
      state === "open" || (view?.policy.policy === "epochs" && state !== "submitting");
    const allowed =
      store.mode === "live" &&
      view !== undefined &&
      view.submitChannels.includes("artifact") &&
      view.policy.policy !== "none" &&
      store.canSubmit() &&
      !store.closed &&
      openState;
    return {
      submit: () => store.submit(),
      allowed,
      blockers: store.blockers(),
      state,
      ...(submission ? { submission: { id: submission.id, at: submission.at } } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the store's state.
  }, [store, version]);
}

/** Asks the shell for a trusted control while mounted, and withdraws it on unmount. */
function useControl(request: ControlRequest | undefined, release: ControlRequest): void {
  const text = request === undefined ? undefined : JSON.stringify(request);
  const releaseText = JSON.stringify(release);
  useEffect(() => {
    if (text === undefined) return;
    let active = true;
    void connectShell().then((connection) => {
      if (!active || !connection) return;
      void connection.bridge
        .call(mostraControlsRequest, JSON.parse(text) as ControlRequest)
        .catch(() => undefined);
    });
    return () => {
      active = false;
      void connectShell().then((connection) => {
        void connection?.bridge
          .call(mostraControlsRequest, JSON.parse(releaseText) as ControlRequest)
          .catch(() => undefined);
      });
    };
  }, [text, releaseText]);
}

/**
 * Relabels the shell's trusted Submit while mounted, and asks the shell to confirm with `confirm`
 * first (D06, SH-02). The artifact asks; the shell renders the control in its own origin, where
 * the artifact can't reach it.
 */
export function useSubmitControl(options: {
  readonly label?: string;
  readonly confirm?: string;
}): void {
  useControl(
    {
      control: "submit",
      ...(options.label !== undefined ? { label: options.label } : {}),
      ...(options.confirm !== undefined ? { confirm: options.confirm } : {}),
    },
    { control: "release", submit: true },
  );
}

// ── useSignal ───────────────────────────────────────────────────────────────────────────

/** A named signal for the host's attention (IN-09), such as "Ping the agent". */
export function useSignal(name: string): { send(payload?: unknown): Promise<void> } {
  const { store } = useRuntime();
  return useMemo(
    () => ({ send: (payload?: unknown) => store.signal(name, payload) }),
    [store, name],
  );
}

// ── useChoice ───────────────────────────────────────────────────────────────────────────

/** A review set's candidate, as the trusted Choose names it. */
export interface ChoiceCandidate {
  /** The candidate's ID: the choice's value. */
  readonly id: string;
  /** The name the trusted Choose shows ("Choose Dense"), and results label it with. */
  readonly label?: string;
}

/**
 * A review set's choice (D65, D113): the field `review.<reviewSetId>.choice`. With `candidates`,
 * the shell renders a trusted Choose for the candidate the page shows (`current`); `choose()`
 * chooses from inside the page where the host allows the artifact channel (D40), else rejects
 * with `MOSTRA_SUBMIT_CHANNEL_DENIED`.
 */
export function useChoice(
  reviewSetId: string,
  options?: { readonly candidates?: readonly ChoiceCandidate[]; readonly current?: string },
): { readonly choice?: string; choose(candidateId: string): Promise<void> } {
  const { store } = useRuntime();
  const id = `review.${reviewSetId}.choice`;
  const key: FieldKey = fieldKey("viewer", id);
  useSyncExternalStore(
    store.subscribe,
    () => store.keyVersion(key),
    () => store.keyVersion(key),
  );
  const choice = store.value(key, undefined);
  const candidates = options?.candidates;
  useControl(
    candidates && candidates.length > 0
      ? {
          control: "choose",
          reviewSetId,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            ...(candidate.label !== undefined ? { label: candidate.label } : {}),
          })),
          ...(options?.current !== undefined ? { current: options.current } : {}),
        }
      : undefined,
    { control: "release", reviewSetId },
  );
  const labels = useMemo(
    () => new Map((candidates ?? []).map((candidate) => [candidate.id, candidate.label])),
    [candidates],
  );
  const choose = useCallback(
    async (candidateId: string) => {
      const view = store.view;
      if (store.mode === "live" && view && !view.submitChannels.includes("artifact")) {
        throw new MostraError(
          "MOSTRA_SUBMIT_CHANNEL_DENIED",
          "This host takes choices from the shell's trusted Choose only.",
        );
      }
      const label = labels.get(candidateId);
      store.set("viewer", id, candidateId, {
        ...(label !== undefined ? { label } : {}),
        immediate: true,
      });
      await store.flush();
    },
    [store, id, labels],
  );
  return {
    ...(typeof choice === "string" ? { choice } : {}),
    choose,
  };
}

// ── useViewer and useArtifact ───────────────────────────────────────────────────────────

/** Who the page acts as (D104): the home's local user, a tailnet user, or a link's person. */
export function useViewer(): {
  readonly id: string;
  readonly name?: string;
  readonly source: "local" | "tailnet" | "token" | "host";
} {
  const { store } = useRuntime();
  useStoreVersion(store);
  const viewer = store.viewer();
  return viewer
    ? {
        id: viewer.id,
        ...(viewer.name !== undefined ? { name: viewer.name } : {}),
        source: viewer.kind,
      }
    : { id: "", source: "local" };
}

/** The artifact, the version and the view the page shows, and where it runs (D104, D111). */
export function useArtifact(): {
  readonly id: string;
  readonly versionId: string;
  readonly version: number;
  readonly viewId: string;
  readonly mode: ArtifactMode;
} {
  const { store, mode } = useRuntime();
  const view = store.view;
  return {
    id: view?.artifactId ?? "",
    versionId: view?.version.id ?? "",
    version: view?.version.number ?? 0,
    viewId: view?.viewId ?? "",
    mode,
  };
}
