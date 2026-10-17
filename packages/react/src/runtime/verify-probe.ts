"use client";

/**
 * `verify`'s field probe (D138 item 3): in the `verify` target only, the page keeps a record of
 * every field it mounts (the hook, the scope and the type of the initial value) and publishes it
 * on `globalThis[VERIFY_PROBE]`, where the verify runner reads it. Viewers' pages never install it.
 */
import { type ProbedField, VERIFY_PROBE } from "@mostra/protocol";
import type { Registration, Store } from "./store.ts";

/** `typeof`, with arrays and `null` named as such. */
function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

interface Entry {
  readonly first: { readonly hook: string; readonly scope: string; readonly initialType: string };
  mounts: number;
  readonly conflicts: Set<string>;
}

/** Records the store's field mounts on `globalThis[VERIFY_PROBE]`. */
export function installVerifyProbe(store: Store): void {
  const entries = new Map<string, Entry>();
  store.observeMounts((registration: Registration, mounted: boolean) => {
    const shape = {
      hook: registration.hook ?? "useField",
      scope: registration.scope,
      initialType: typeName(registration.initial),
    };
    let entry = entries.get(registration.id);
    if (!entry) {
      entry = { first: shape, mounts: 0, conflicts: new Set() };
      entries.set(registration.id, entry);
    }
    if (mounted) {
      entry.mounts += 1;
      if (shape.hook !== entry.first.hook)
        entry.conflicts.add(`${entry.first.hook} and ${shape.hook}`);
      if (shape.scope !== entry.first.scope)
        entry.conflicts.add(`scopes ${entry.first.scope} and ${shape.scope}`);
      if (shape.initialType !== entry.first.initialType)
        entry.conflicts.add(
          `initial values of types ${entry.first.initialType} and ${shape.initialType}`,
        );
    } else entry.mounts = Math.max(0, entry.mounts - 1);
  });
  const fields = (): ProbedField[] =>
    [...entries].map(([id, entry]) => ({
      id,
      scope: entry.first.scope as ProbedField["scope"],
      hook: entry.first.hook,
      initialType: entry.first.initialType,
      mounts: entry.mounts,
      conflicts: [...entry.conflicts],
    }));
  Object.defineProperty(globalThis, VERIFY_PROBE, { value: { fields }, configurable: true });
}
