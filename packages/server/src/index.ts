/**
 * `@mostra/server`: what server code imports (INTERFACES §2.4). Inside `"use server"` functions and
 * live sources, it tells who the call is for, reports progress and log lines to the page, reads
 * secrets, raises signals and host events, and reads and writes the artifact's shared state.
 * Server code runs with full capability (D05, AC-01): it can read files, start processes and call
 * any network service; this package only adds what Mostra knows.
 *
 * ```ts
 * "use server";
 * import { abortSignal, dryRun, progress, secret, signal } from "@mostra/server";
 *
 * export async function sendReply(messageId: string, body: string) {
 *   if (dryRun()) return { messageId, sent: false };
 *   progress({ message: "Sending…" });
 *   const response = await fetch("https://mail.example/api/send", {
 *     method: "POST",
 *     headers: { authorization: `Bearer ${secret("MAIL_TOKEN")}`, "idempotency-key": messageId },
 *     body: JSON.stringify({ messageId, body }),
 *     signal: abortSignal,
 *   });
 *   if (!response.ok) throw new Error(`Mail API returned ${response.status}`);
 *   signal("reply-sent", { messageId });
 *   return { messageId, sent: true };
 * }
 * ```
 *
 * @packageDocumentation
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { canonicalJson, type FieldOp, SIGNAL_NAME_PATTERN } from "@mostra/protocol";
import { currentCall, serverHost } from "./context.ts";

export { defineLive, type LiveSource, type LiveSourceOptions } from "./live.ts";

/** Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** An error with a Mostra diagnostic code, as `@mostra/server` throws them. */
export class MostraServerError extends Error {
  /** The diagnostic code, such as `MOSTRA_SECRET_MISSING`. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MostraServerError";
    this.code = code;
  }
}

const PAYLOAD_MAX = 64 * 1024;

function checkPayload(code: string, what: string, payload: unknown): void {
  if (payload === undefined) return;
  let text: string;
  try {
    text = canonicalJson(payload);
  } catch {
    throw new MostraServerError(code, `The payload of ${what} isn't JSON.`);
  }
  if (Buffer.byteLength(text, "utf8") > PAYLOAD_MAX) {
    throw new MostraServerError(code, `The payload of ${what} is larger than 64 KiB of JSON.`);
  }
}

/**
 * Whether this call is `verify`'s smoke test (D55). An action that checks it opts into the smoke
 * test, and should then return without real effects; one that never calls it is skipped there.
 */
export function dryRun(): boolean {
  return currentCall()?.dryRun ?? false;
}

/** Reports the run's progress to every page following it (ephemeral, never an event). */
export function progress(p: { fraction?: number; message?: string }): void {
  const call = currentCall();
  if (!call) return;
  const fraction = p.fraction === undefined ? undefined : Math.min(1, Math.max(0, p.fraction));
  serverHost().progress(call.callId, {
    ...(fraction === undefined || Number.isNaN(fraction) ? {} : { fraction }),
    ...(p.message === undefined ? {} : { message: String(p.message).slice(0, 1000) }),
  });
}

/**
 * Adds a line to the run's log (kept with the run, capped at 1 MB, D47); outside a run, to the
 * worker's own log. Secrets are redacted from it.
 */
export function log(line: string): void {
  serverHost().log(currentCall()?.callId, String(line));
}

/**
 * A secret's value, by name (D44): from the host's `secrets` port, the artifact's own secrets or
 * the home's shared ones. Never put the value in a result, a log or a signal.
 *
 * @throws MostraServerError `MOSTRA_SECRET_MISSING` when no store holds it.
 */
export function secret(name: string): string {
  return serverHost().secret(name);
}

/**
 * Raises a named signal for the host's attention (IN-09): one durable `signal.raised` event with
 * `source: "action"` and this run as its causation. Mostra wakes no one by itself (D10).
 *
 * @throws MostraServerError `MOSTRA_SUBMIT_SIGNAL_INVALID` for a bad name or a payload over 64 KiB.
 */
export function signal(name: string, payload?: Json): void {
  if (typeof name !== "string" || !SIGNAL_NAME_PATTERN.test(name) || name === "submit") {
    throw new MostraServerError(
      "MOSTRA_SUBMIT_SIGNAL_INVALID",
      `${JSON.stringify(name).slice(0, 80)} isn't a signal name: 1 to 64 letters, digits, ".", "_" and "-", and not "submit".`,
    );
  }
  checkPayload("MOSTRA_SUBMIT_SIGNAL_INVALID", `the signal ${name}`, payload);
  serverHost().signal(currentCall()?.callId, name, payload);
}

/**
 * Appends a host event, `host.<name>`, to the event log (AC-05), which hosts filter for.
 *
 * @throws MostraServerError `MOSTRA_ACTION_EVENT_INVALID` for a bad type or a payload over 64 KiB.
 */
export function emit(type: `host.${string}`, payload?: Json): void {
  const name = typeof type === "string" && type.startsWith("host.") ? type.slice(5) : "";
  if (!SIGNAL_NAME_PATTERN.test(name)) {
    throw new MostraServerError(
      "MOSTRA_ACTION_EVENT_INVALID",
      `${JSON.stringify(type).slice(0, 80)} isn't a host event type: "host." and 1 to 64 letters, digits, ".", "_" and "-".`,
    );
  }
  checkPayload("MOSTRA_ACTION_EVENT_INVALID", `the event ${type}`, payload);
  serverHost().emit(currentCall()?.callId, type, payload);
}

/** Who the call is for; `undefined` in live producers and outside calls. */
export function viewer(): { id: string; name?: string } | undefined {
  const who = currentCall()?.viewer;
  return who ? { ...who } : undefined;
}

const idle = new AbortController().signal;

/** Listeners as registered, by the bound copies that keep their call's context. */
const boundListeners = new WeakMap<object, (event: Event) => void>();

/** A listener that runs in the call it was added in, as `await`ed code does. */
function bindListener(listener: unknown): unknown {
  if (typeof listener !== "function" && (typeof listener !== "object" || listener === null)) {
    return listener;
  }
  let bound = boundListeners.get(listener);
  if (!bound) {
    const handle =
      typeof listener === "function"
        ? (listener as (event: Event) => void)
        : (event: Event) => (listener as { handleEvent(event: Event): void }).handleEvent(event);
    bound = AsyncLocalStorage.bind(handle);
    boundListeners.set(listener, bound);
  }
  return bound;
}

/**
 * The current call's cancellation (AC-04): aborted when a page cancels the run or the caller goes
 * away. Pass it to `fetch` and other cancellable work. Outside a call it never aborts. Listeners
 * added to it run in the call that added them, so they read `abortSignal.reason` of that call.
 */
export const abortSignal: AbortSignal = new Proxy(idle, {
  get(_target, property) {
    const target = currentCall()?.signal ?? idle;
    if (property === "addEventListener" || property === "removeEventListener") {
      const method = target[property].bind(target) as (
        type: string,
        listener: unknown,
        options?: unknown,
      ) => void;
      return (type: string, listener: unknown, options?: unknown) =>
        method(type, bindListener(listener), options);
    }
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_target, property, value) {
    const target = currentCall()?.signal ?? idle;
    return Reflect.set(
      target,
      property,
      property === "onabort" ? bindListener(value) : value,
      target,
    );
  },
  has(_target, property) {
    return Reflect.has(currentCall()?.signal ?? idle, property);
  },
});

/** Options of a state write. */
export interface StateWriteOptions {
  /** The change's ID: a retry with the same ID and contents returns the recorded result. */
  readonly mutationId?: string;
  /** The revision you read: a field changed after it is a conflict and keeps its value. */
  readonly baseRevision?: string;
}

/** The artifact's shared state, as server code reads and writes it. */
export interface ServerState {
  /** A field's value, or `undefined` when it isn't set. */
  get<T>(id: string): Promise<T | undefined>;
  /**
   * Sets one field.
   *
   * @throws MostraServerError `MOSTRA_FIELD_CONFLICT` when the field changed after `baseRevision`.
   */
  set<T>(id: string, value: T, options?: StateWriteOptions): Promise<{ revision: string }>;
  /** Sets and deletes several fields under one revision; conflicting ones are listed. */
  patch(
    ops: readonly { id: string; value?: Json; delete?: true }[],
    options?: StateWriteOptions,
  ): Promise<{ revision: string; conflicts: string[] }>;
}

/**
 * The artifact's shared state (D63): the artifact-scoped fields every viewer sees, written through
 * the same compare-and-set as viewers' edits, as the agent. Each write appends `state.changed`.
 */
export const state: ServerState = {
  async get<T>(id: string): Promise<T | undefined> {
    const snapshot = await serverHost().stateGet([id]);
    const field = snapshot.fields[id];
    return field && !field.deleted ? (field.value as T) : undefined;
  },
  async set<T>(id: string, value: T, options: StateWriteOptions = {}) {
    const result = await serverHost().statePatch(
      currentCall()?.callId,
      [{ id, value } as FieldOp],
      options,
    );
    if (result.conflicts.length > 0) {
      throw new MostraServerError(
        "MOSTRA_FIELD_CONFLICT",
        `The state field ${id} changed after revision ${options.baseRevision ?? "?"}; read it again and decide.`,
      );
    }
    return { revision: result.revision };
  },
  async patch(ops, options: StateWriteOptions = {}) {
    const fieldOps = ops.map((op) =>
      op.delete
        ? ({ id: op.id, delete: true } as FieldOp)
        : ({ id: op.id, value: op.value } as FieldOp),
    );
    const result = await serverHost().statePatch(currentCall()?.callId, fieldOps, options);
    return {
      revision: result.revision,
      conflicts: result.conflicts.map((conflict) => conflict.id),
    };
  },
};
