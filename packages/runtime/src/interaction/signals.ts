/**
 * Signals (IN-09, D10, D106): named, non-terminal requests for a host's attention, raised by the
 * artifact (`useSignal`), by server code (`signal()`, WP-08) or by a submission (`submit`). Each
 * is one durable `signal.raised` event and nothing more: Mostra never decides on its own what a
 * signal wakes. Hosts filter events and decide.
 */
import {
  type Actor,
  canonicalJson,
  createDiagnostic,
  RpcError,
  SIGNAL_NAME_PATTERN,
  SIGNAL_PAYLOAD_MAX_BYTES,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";

/** Who raised a signal (DATA_MODEL §4). */
export type SignalSource = "shell" | "artifact" | "action";

/** The signal every submission raises (D106); no one else may raise it. */
export const SUBMIT_SIGNAL = "submit";

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_SUBMIT_SIGNAL_INVALID", { message }));
}

/** Checks a signal's name and payload (D106). */
export function checkSignal(name: unknown, payload: unknown): void {
  if (typeof name !== "string" || !SIGNAL_NAME_PATTERN.test(name)) {
    throw invalid(
      `${JSON.stringify(name).slice(0, 80)} isn't a signal name: 1 to 64 letters, digits, ".", "_" and "-".`,
    );
  }
  if (name === SUBMIT_SIGNAL) {
    throw invalid('The signal name "submit" is reserved: a submission raises it.');
  }
  if (payload === undefined) return;
  let text: string;
  try {
    text = canonicalJson(payload);
  } catch {
    throw invalid(`The payload of the signal ${name} isn't JSON.`);
  }
  if (Buffer.byteLength(text, "utf8") > SIGNAL_PAYLOAD_MAX_BYTES) {
    throw invalid(`The payload of the signal ${name} is larger than 64 KiB of JSON.`);
  }
}

/**
 * Appends `signal.raised` inside the caller's transaction and returns its cursor, after checking
 * the name and payload. No caller may raise `submit`: only a submission does (D106).
 */
export function raiseSignal(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly name: string;
    readonly payload?: unknown;
    readonly source: SignalSource;
    readonly actor: Actor;
    readonly viewId?: string;
    /** The viewer whose call raised it, for a signal of server code (D104: theirs alone). */
    readonly viewerId?: string;
    readonly causation?: Readonly<Record<string, string>>;
  },
): string {
  checkSignal(input.name, input.payload);
  return appendSignal(db, input);
}

/** The `submit` signal a submission raises, in its transaction (D106). */
export function raiseSubmitSignal(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly submissionId: string;
    readonly channel: "shell" | "artifact";
    readonly actor: Actor;
    readonly viewId: string;
  },
): string {
  return appendSignal(db, {
    artifactId: input.artifactId,
    name: SUBMIT_SIGNAL,
    payload: { submissionId: input.submissionId },
    source: input.channel,
    actor: input.actor,
    viewId: input.viewId,
    causation: { submissionId: input.submissionId },
  });
}

function appendSignal(
  db: LedgerDb,
  input: {
    readonly artifactId: string;
    readonly name: string;
    readonly payload?: unknown;
    readonly source: SignalSource;
    readonly actor: Actor;
    readonly viewId?: string;
    readonly viewerId?: string;
    readonly causation?: Readonly<Record<string, string>>;
  },
): string {
  return appendEvent(db, {
    artifactId: input.artifactId,
    type: "signal.raised",
    actor: input.actor,
    ...(input.causation ? { causation: input.causation } : {}),
    payload: {
      name: input.name,
      source: input.source,
      ...(input.viewId !== undefined ? { viewId: input.viewId } : {}),
      ...(input.viewerId !== undefined ? { viewerId: input.viewerId } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    },
  });
}
