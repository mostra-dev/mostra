/**
 * `@mostra/react/form`: react-hook-form on Mostra fields (D52, D26). `useForm` is react-hook-form's
 * own, with one more option, `id`: every registered field persists as the Mostra field
 * `<id>.<name>`, so a large form saves as the viewer types, survives reloads and other tabs,
 * converges with other writers, and arrives in results nested under `id`. Its `required` rules
 * and validation errors become the shell's blockers.
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
import { fieldKey } from "./runtime/store.ts";

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

  // The form's values as Mostra has them, over its defaults: react-hook-form takes them as
  // `values`, keeping what the viewer is editing (`keepDirtyValues`).
  const [defaults] = useState(() => hookOptions.defaultValues);
  // `version` stands for the store's state, which the memo reads through `store`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above.
  const stored = useMemo(() => {
    const base =
      typeof defaults === "object" && defaults !== null
        ? structuredClone(defaults as TFieldValues)
        : ({} as TFieldValues);
    for (const fieldId of store.ids(scope)) {
      if (!fieldId.startsWith(prefix)) continue;
      setPath(base, fieldId.slice(prefix.length), store.value(fieldKey(scope, fieldId), undefined));
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the store's state.
  }, [store, scope, prefix, version, defaults]);

  const form = useHookForm<TFieldValues>({
    ...hookOptions,
    values: stored,
    resetOptions: { keepDirtyValues: true, ...hookOptions.resetOptions },
  });

  // Labels usually come as an object literal: the same labels are the same registration.
  const labelsKey = JSON.stringify(labels ?? {});
  const stableLabels = useMemo(
    () => JSON.parse(labelsKey) as MostraFormOptions<TFieldValues>["labels"],
    [labelsKey],
  );

  // Every change the viewer makes is saved as its field.
  const sensitiveNames = useMemo(() => new Set<string>(sensitive ?? []), [sensitive]);
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values, name }) => {
          if (name === undefined) return; // A reset from Mostra's own values: nothing to save.
          const fieldId = `${prefix}${name}`;
          if (!store.writable(fieldKey(scope, fieldId))) return;
          const label = stableLabels?.[name as FieldPath<TFieldValues>];
          store.set(scope, fieldId, get(values, name), {
            ...(label !== undefined ? { label } : {}),
            ...(sensitiveNames.has(name) ? { sensitive: true } : {}),
          });
        },
      }),
    [form, store, scope, prefix, stableLabels, sensitiveNames],
  );

  // Registered fields become Mostra registrations, so the shell lists their blockers.
  const rules = useRef(new Map<string, boolean>());
  const register = form.register;
  const wrapped = useMemo(
    () =>
      ((name: FieldPath<TFieldValues>, ruleOptions?: RegisterOptions<TFieldValues>) => {
        rules.current.set(
          name,
          ruleOptions?.required !== undefined && ruleOptions.required !== false,
        );
        return register(name, ruleOptions);
      }) as UseFormReturn<TFieldValues>["register"],
    [register],
  );
  const errors = form.formState.errors;
  // Registered on the first render that names a field, updated only when a rule, label or error
  // changes, and released on unmount: re-registering on every render would never settle.
  const mounted = useRef(new Map<string, { release: () => void; signature: string }>());
  const sync = useCallback(
    (errorOf: (name: string) => unknown): void => {
      for (const [name, required] of rules.current) {
        const fieldId = `${prefix}${name}`;
        const label = stableLabels?.[name as FieldPath<TFieldValues>];
        const failure = errorOf(name) as { message?: unknown } | undefined;
        const message =
          failure === undefined
            ? undefined
            : typeof failure.message === "string" && failure.message !== ""
              ? failure.message
              : "Invalid value.";
        const registration = {
          id: fieldId,
          scope,
          initial: get(defaults ?? {}, name),
          ...(label !== undefined ? { label } : {}),
          ...(required ? { required } : {}),
          ...(sensitiveNames.has(name) ? { sensitive: true } : {}),
          ...(message !== undefined ? { error: message } : {}),
        };
        const signature = JSON.stringify([label, required, sensitiveNames.has(name), message]);
        const current = mounted.current.get(fieldId);
        if (!current) {
          mounted.current.set(fieldId, { release: store.register(registration), signature });
          if (message !== undefined) store.updateRegistration(registration);
        } else if (current.signature !== signature) {
          current.signature = signature;
          store.updateRegistration(registration);
        }
      }
    },
    [prefix, scope, stableLabels, sensitiveNames, store, defaults],
  );
  useEffect(() => sync((name) => get(errors, name)));
  // react-hook-form validates on submit unless told otherwise; before either channel's submit
  // it validates now, so its errors are the submit's blockers (D106: the client checks).
  const { trigger, getFieldState } = form;
  useEffect(
    () =>
      store.beforeSubmit(async () => {
        await trigger();
        sync((name) => getFieldState(name as FieldPath<TFieldValues>).error);
      }),
    [store, trigger, getFieldState, sync],
  );
  useEffect(
    () => () => {
      for (const entry of mounted.current.values()) entry.release();
      mounted.current.clear();
    },
    [],
  );

  // A new object each render: react-hook-form renews `formState`'s proxy every render.
  return { ...form, register: wrapped };
}
