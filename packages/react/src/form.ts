"use client";

/**
 * `@mostra/react/form`: react-hook-form on Mostra fields (D52, D26). `useForm` is react-hook-form's
 * own, with one more option, `id`: every answer persists as the Mostra field `<id>.<path>` (a
 * field array as one answer, `<id>.items`), so a large form saves as the viewer types, resets
 * included, survives reloads and other tabs, converges with other writers, and arrives in
 * results nested under `id`. Its `required` rules and validation errors become the shell's
 * blockers.
 *
 * ```tsx
 * import { useForm } from "@mostra/react/form";
 *
 * const form = useForm({ id: "intake", defaultValues: { name: "", team: "" }, labels: { name: "Your name" } });
 * <input {...form.register("name", { required: true })} />
 * ```
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type FieldPath,
  type FieldValues,
  get,
  type RegisterOptions,
  set as setPath,
  type UseFormProps,
  type UseFormReturn,
  useForm as useHookForm,
} from "react-hook-form";
import { useStore } from "./hooks.ts";

/** Whether two JSON values are the same. */
function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

import { fieldKey } from "./runtime/store.ts";

/** Whether a value is a plain object, whose keys the form's values nest by. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A form's answers as Mostra fields (Claude review finding 1): one field per leaf, where a leaf is
 * any value that isn't a plain object, arrays included. A field array is one answer, so a row
 * removed is gone from that answer, never left behind as a field of its own, and `items` and
 * `items.1` never both exist.
 */
function leaves(
  values: unknown,
  path = "",
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (isPlainObject(values)) {
    for (const [key, value] of Object.entries(values)) {
      leaves(value, path === "" ? key : `${path}.${key}`, out);
    }
  } else if (path !== "") {
    out.set(path, values);
  }
  return out;
}

/** The leaf a registered name lives in: the name itself, or the array it is inside. */
function leafOf(values: unknown, name: string): string {
  const parts = name.split(".");
  let current: unknown = values;
  for (let index = 0; index < parts.length; index += 1) {
    if (Array.isArray(current)) return parts.slice(0, index).join(".");
    if (!isPlainObject(current)) return name;
    current = current[parts[index] as string];
  }
  return name;
}

/** Options of {@link useForm}: react-hook-form's, and the form's field ID. */
export interface MostraFormOptions<TFieldValues extends FieldValues>
  extends Omit<UseFormProps<TFieldValues>, "values"> {
  /** The field ID every field of the form is persisted under: `<id>.<name>` (D52). */
  readonly id: string;
  /** Labels for results and the shell's blockers, by field name. */
  readonly labels?: Readonly<Partial<Record<FieldPath<TFieldValues>, string>>>;
  /** `viewer` (default): the viewer's draft. `artifact`: shared state (D63). */
  readonly scope?: "viewer" | "artifact";
  /** Field names kept out of events and logs (D52), still delivered with the submission. */
  readonly sensitive?: readonly FieldPath<TFieldValues>[];
}

/**
 * react-hook-form's `useForm`, persisted to Mostra fields under `id` (D52). Everything else is
 * react-hook-form's own: `register`, `handleSubmit`, `formState`, resolvers.
 */
export function useForm<TFieldValues extends FieldValues = FieldValues>(
  options: MostraFormOptions<TFieldValues>,
): UseFormReturn<TFieldValues> {
  const store = useStore();
  const { id, labels, scope = "viewer", sensitive, ...hookOptions } = options;
  const prefix = `${id}.`;
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);

  // The form starts from its answers as Mostra has them, over its defaults. After that, every
  // answer follows the store: the store's value of a field is the viewer's own unsaved edit while
  // there is one, else the gateway's, so another writer's change reaches the input once the
  // viewer's edit landed, and never overwrites it before (GPT review finding 5).
  const [defaults] = useState(() => hookOptions.defaultValues);
  const defaultOf = useCallback((leaf: string): unknown => get(defaults ?? {}, leaf), [defaults]);
  const storedValue = useCallback(
    (leaf: string): unknown => store.value(fieldKey(scope, `${prefix}${leaf}`), defaultOf(leaf)),
    [store, scope, prefix, defaultOf],
  );
  const stored = useCallback(
    (leaf: string): boolean =>
      store.value(fieldKey(scope, `${prefix}${leaf}`), undefined) !== undefined,
    [store, scope, prefix],
  );
  const [initial] = useState(() => {
    const base =
      typeof defaults === "object" && defaults !== null
        ? structuredClone(defaults as TFieldValues)
        : ({} as TFieldValues);
    for (const fieldId of store.ids(scope)) {
      if (!fieldId.startsWith(prefix)) continue;
      setPath(base, fieldId.slice(prefix.length), store.value(fieldKey(scope, fieldId), undefined));
    }
    return base;
  });

  const form = useHookForm<TFieldValues>({ ...hookOptions, defaultValues: initial as never });

  // Labels usually come as an object literal: the same labels are the same registration.
  const labelsKey = JSON.stringify(labels ?? {});
  const stableLabels = useMemo(
    () => JSON.parse(labelsKey) as MostraFormOptions<TFieldValues>["labels"],
    [labelsKey],
  );
  const sensitiveNames = useMemo(() => new Set<string>(sensitive ?? []), [sensitive]);

  // Every change saves the answers that differ from what Mostra holds, leaf by leaf: a typed
  // value, a row appended or removed, and a `reset()` alike, so what the viewer sees is what a
  // submit sends (Claude review findings 1 and 2). An answer still at its default and never
  // stored stays unstored: a default is written only before a submit (D110).
  const save = useCallback(
    (values: unknown): void => {
      const current = leaves(values);
      for (const [leaf, value] of current) {
        const key = fieldKey(scope, `${prefix}${leaf}`);
        if (!store.writable(key)) continue;
        if (stored(leaf) ? sameJson(value, storedValue(leaf)) : sameJson(value, defaultOf(leaf))) {
          continue;
        }
        const label = stableLabels?.[leaf as FieldPath<TFieldValues>];
        store.set(scope, `${prefix}${leaf}`, value, {
          ...(label !== undefined ? { label } : {}),
          ...(sensitiveNames.has(leaf) ? { sensitive: true } : {}),
        });
      }
      // A stored answer the form doesn't have is left alone: it may be an answer an earlier
      // version asked for, which is kept and delivered as not carried over (D42).
    },
    [store, scope, prefix, stored, storedValue, defaultOf, stableLabels, sensitiveNames],
  );
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values }) => save(values),
      }),
    [form, save],
  );

  // Answers that changed in the store (another writer, another tab, a snapshot) reach the form,
  // leaf by leaf; the store's own value coming back isn't saved again (`save` finds no change).
  const { getValues, setValue } = form;
  // `version` stands for the store's state, which the effect reads through `store`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above.
  useEffect(() => {
    // Only the form's own answers: a stored answer it doesn't have (an earlier version's) stays
    // out of its values.
    const current = leaves(getValues());
    for (const [leaf, value] of current) {
      const next = storedValue(leaf);
      if (sameJson(next, value)) continue;
      setValue(leaf as FieldPath<TFieldValues>, next as never, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [version, store, scope, prefix, storedValue, getValues, setValue]);

  // Registered fields become Mostra registrations of the leaves they live in, so the shell lists
  // their blockers. Only mounted ones: a field whose input left the page, or that `unregister`
  // removed, is released, so it neither blocks a submit nor has its default written (D110, GPT
  // review finding 11). A field inside a field array registers its array: its own rules run in
  // react-hook-form, whose errors block the submit (D106).
  const rules = useRef(new Map<string, boolean>());
  const mounted = useRef(new Map<string, { release: () => void; signature: string }>());
  // Bumped when a field is released: the render that follows lets its registration go.
  const [, setReleased] = useState(0);
  const release = useCallback((name: string): void => {
    rules.current.delete(name);
    // Inside React's commit (a ref callback): the store hears of it after, never re-entering it.
    queueMicrotask(() => setReleased((count) => count + 1));
  }, []);
  const { register, unregister } = form;
  // One ref callback per field, so React calls it on mount and unmount only, not every render.
  const refs = useRef(
    new Map<string, { latest: (element: unknown) => void; ref: (element: unknown) => void }>(),
  );
  const wrapped = useMemo(
    () =>
      ((name: FieldPath<TFieldValues>, ruleOptions?: RegisterOptions<TFieldValues>) => {
        const required = ruleOptions?.required !== undefined && ruleOptions.required !== false;
        rules.current.set(name, required);
        const registered = register(name, ruleOptions);
        let entry = refs.current.get(name);
        if (!entry) {
          const created = {
            latest: registered.ref as (element: unknown) => void,
            ref: (element: unknown): void => {
              created.latest(element);
              if (element === null) release(name);
              else rules.current.set(name, rules.current.get(name) ?? required);
            },
          };
          entry = created;
          refs.current.set(name, entry);
        }
        entry.latest = registered.ref as (element: unknown) => void;
        return { ...registered, ref: entry.ref };
      }) as UseFormReturn<TFieldValues>["register"],
    [register, release],
  );
  const wrappedUnregister = useMemo(
    () =>
      ((name?: FieldPath<TFieldValues> | readonly FieldPath<TFieldValues>[], options?: never) => {
        const names =
          name === undefined ? [...rules.current.keys()] : Array.isArray(name) ? name : [name];
        for (const each of names) release(each as string);
        unregister(name as never, options);
      }) as UseFormReturn<TFieldValues>["unregister"],
    [unregister, release],
  );
  const errors = form.formState.errors;
  // Registered on the first render that names a field, updated only when a rule, label or error
  // changes, and released when no mounted field lives in the leaf: re-registering on every
  // render would never settle.
  const sync = useCallback(
    (errorOf: (name: string) => unknown): void => {
      const values = getValues();
      const byLeaf = new Map<string, { required: boolean; message?: string }>();
      for (const [name, required] of rules.current) {
        const leaf = leafOf(values, name);
        const failure = errorOf(name) as { message?: unknown } | undefined;
        const message =
          failure === undefined
            ? undefined
            : typeof failure.message === "string" && failure.message !== ""
              ? failure.message
              : required
                ? "This answer is required."
                : "Invalid value.";
        const entry = byLeaf.get(leaf) ?? { required: false };
        // A required rule inside an array is react-hook-form's to check, not the leaf's.
        if (leaf === name && required) entry.required = true;
        if (entry.message === undefined && message !== undefined) entry.message = message;
        byLeaf.set(leaf, entry);
      }
      for (const [leaf, { required, message }] of byLeaf) {
        const fieldId = `${prefix}${leaf}`;
        const label = stableLabels?.[leaf as FieldPath<TFieldValues>];
        const registration = {
          id: fieldId,
          scope,
          initial: defaultOf(leaf),
          ...(label !== undefined ? { label } : {}),
          ...(required ? { required } : {}),
          ...(sensitiveNames.has(leaf) ? { sensitive: true } : {}),
          ...(message !== undefined ? { error: message } : {}),
        };
        const signature = JSON.stringify([label, required, sensitiveNames.has(leaf), message]);
        const current = mounted.current.get(fieldId);
        if (!current) {
          mounted.current.set(fieldId, { release: store.register(registration), signature });
          if (message !== undefined) store.updateRegistration(registration);
        } else if (current.signature !== signature) {
          current.signature = signature;
          store.updateRegistration(registration);
        }
      }
      for (const [fieldId, entry] of mounted.current) {
        if (byLeaf.has(fieldId.slice(prefix.length))) continue;
        entry.release();
        mounted.current.delete(fieldId);
      }
    },
    [prefix, scope, stableLabels, sensitiveNames, store, defaultOf, getValues],
  );
  useEffect(() => sync((name) => get(errors, name)));
  // react-hook-form validates on submit unless told otherwise; before either channel's submit
  // it validates now, so its errors are the submit's blockers (D106: the client checks), and
  // every answer the viewer sees is saved first.
  const { trigger, getFieldState } = form;
  useEffect(
    () =>
      store.beforeSubmit(async () => {
        save(getValues());
        await trigger();
        sync((name) => getFieldState(name as FieldPath<TFieldValues>).error);
      }),
    [store, trigger, getFieldState, sync, save, getValues],
  );
  useEffect(
    () => () => {
      for (const entry of mounted.current.values()) entry.release();
      mounted.current.clear();
    },
    [],
  );

  // A new object each render: react-hook-form renews `formState`'s proxy every render.
  return { ...form, register: wrapped, unregister: wrappedUnregister };
}
