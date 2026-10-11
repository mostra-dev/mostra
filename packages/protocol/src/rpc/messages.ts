/**
 * JSON-RPC 2.0 message shapes (D59, D83). Every Mostra connection carries these: the host protocol
 * over stdio or the home socket, child-process messaging and the shell bridge. Revision
 * `2026-10-10` has no batches.
 */
import * as z from "zod";
import { wireRegistry } from "../wire-registry.ts";

/** A request ID: a string or a number, chosen by the sender and echoed in the response. */
export type JsonRpcId = string | number;

/** Request params: a JSON object (Mostra always uses objects) or an array. */
export type JsonRpcParams = Readonly<Record<string, unknown>> | readonly unknown[];

/** A request: the receiver answers with a response carrying the same `id`. */
export interface JsonRpcRequest {
  /** Always `"2.0"`. */
  readonly jsonrpc: "2.0";
  /** Chosen by the sender; the response carries the same ID. */
  readonly id: JsonRpcId;
  /** The method name, `group/name` or a bare name. */
  readonly method: string;
  /** The method's params. */
  readonly params?: JsonRpcParams;
}

/** A notification: a request without an `id`, which is never answered. */
export interface JsonRpcNotification {
  /** Always `"2.0"`. */
  readonly jsonrpc: "2.0";
  /** The notification's method name. */
  readonly method: string;
  /** The notification's params. */
  readonly params?: JsonRpcParams;
}

/** The error member of a failed response. Mostra puts the diagnostic in `data`. */
export interface JsonRpcErrorObject {
  /** The JSON-RPC error code (INTERFACES §6). */
  readonly code: number;
  /** A short description; clients switch on `data.code`, never on this text. */
  readonly message: string;
  /** The diagnostic (INTERFACES §13). */
  readonly data?: unknown;
}

/** A successful response. */
export interface JsonRpcSuccess {
  /** Always `"2.0"`. */
  readonly jsonrpc: "2.0";
  /** The ID of the request this answers. */
  readonly id: JsonRpcId;
  /** The method's result. */
  readonly result: unknown;
}

/** A failed response. `id` is `null` when the request's ID couldn't be read. */
export interface JsonRpcFailure {
  /** Always `"2.0"`. */
  readonly jsonrpc: "2.0";
  /** The ID of the request this answers, or `null` when it couldn't be read. */
  readonly id: JsonRpcId | null;
  /** What went wrong. */
  readonly error: JsonRpcErrorObject;
}

/** A response to a request. */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Any message on a Mostra connection. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

const version = z.literal("2.0");
const id: z.ZodType<JsonRpcId> = z.union([z.string(), z.number()]);
const params: z.ZodType<JsonRpcParams> = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()).readonly(),
]);

/** The Zod schema of the `JsonRpcRequest` type. */
export const JsonRpcRequest: z.ZodType<JsonRpcRequest> = z
  .object({ jsonrpc: version, id, method: z.string(), params: params.exactOptional() })
  .register(wireRegistry, {
    id: "JsonRpcRequest",
    description: "A JSON-RPC 2.0 request: answered by a response with the same id.",
  });

/** The Zod schema of the `JsonRpcNotification` type. */
export const JsonRpcNotification: z.ZodType<JsonRpcNotification> = z
  .object({ jsonrpc: version, method: z.string(), params: params.exactOptional() })
  .register(wireRegistry, {
    id: "JsonRpcNotification",
    description: "A JSON-RPC 2.0 notification: a request without an id, never answered.",
  });

/** The Zod schema of the `JsonRpcErrorObject` type. */
export const JsonRpcErrorObject: z.ZodType<JsonRpcErrorObject> = z
  .object({ code: z.int(), message: z.string(), data: z.unknown().exactOptional() })
  .register(wireRegistry, {
    id: "JsonRpcErrorObject",
    description: "The error of a failed JSON-RPC 2.0 response; Mostra puts the diagnostic in data.",
  });

/** The Zod schema of the `JsonRpcSuccess` type. */
export const JsonRpcSuccess: z.ZodType<JsonRpcSuccess> = z
  .object({ jsonrpc: version, id, result: z.unknown() })
  .register(wireRegistry, {
    id: "JsonRpcSuccess",
    description: "A successful JSON-RPC 2.0 response.",
  });

/** The Zod schema of the `JsonRpcFailure` type. */
export const JsonRpcFailure: z.ZodType<JsonRpcFailure> = z
  .object({ jsonrpc: version, id: id.nullable(), error: JsonRpcErrorObject })
  .register(wireRegistry, {
    id: "JsonRpcFailure",
    description: "A failed JSON-RPC 2.0 response; id is null when the request's id was unreadable.",
  });

/** A message sorted by kind, or the reason it isn't a valid message. */
export type ClassifiedMessage =
  | { readonly kind: "request"; readonly message: JsonRpcRequest }
  | { readonly kind: "notification"; readonly message: JsonRpcNotification }
  | { readonly kind: "success"; readonly message: JsonRpcSuccess }
  | { readonly kind: "failure"; readonly message: JsonRpcFailure }
  | { readonly kind: "invalid"; readonly reason: string; readonly id: JsonRpcId | null };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Sorts a parsed JSON value into a request, notification, success or failure, or explains why it
 * is none of them. A JSON array (a batch) is invalid in revision `2026-10-10` (D83).
 */
export function classifyMessage(value: unknown): ClassifiedMessage {
  if (Array.isArray(value)) {
    return {
      kind: "invalid",
      reason: "Batches (JSON arrays) aren't supported in host protocol revision 2026-10-10.",
      id: null,
    };
  }
  if (!isObject(value)) {
    return { kind: "invalid", reason: "A message must be a JSON object.", id: null };
  }
  const rawId = value["id"];
  const readableId = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  if (value["jsonrpc"] !== "2.0") {
    return { kind: "invalid", reason: 'A message must have "jsonrpc": "2.0".', id: readableId };
  }
  if ("method" in value) {
    if ("id" in value) {
      const parsed = JsonRpcRequest.safeParse(value);
      return parsed.success
        ? { kind: "request", message: parsed.data }
        : { kind: "invalid", reason: describeRequestProblem(value), id: readableId };
    }
    const parsed = JsonRpcNotification.safeParse(value);
    return parsed.success
      ? { kind: "notification", message: parsed.data }
      : { kind: "invalid", reason: describeRequestProblem(value), id: null };
  }
  const hasResult = "result" in value;
  const hasError = "error" in value;
  if (hasResult !== hasError && "id" in value) {
    if (hasResult) {
      const parsed = JsonRpcSuccess.safeParse(value);
      if (parsed.success) return { kind: "success", message: parsed.data };
    } else {
      const parsed = JsonRpcFailure.safeParse(value);
      if (parsed.success) return { kind: "failure", message: parsed.data };
    }
  }
  return {
    kind: "invalid",
    reason:
      'A message must be a request (with "method") or a response (with "id" and exactly one of "result" and "error").',
    id: readableId,
  };
}

function describeRequestProblem(value: Record<string, unknown>): string {
  if (typeof value["method"] !== "string") return 'A request\'s "method" must be a string.';
  if ("id" in value && typeof value["id"] !== "string" && typeof value["id"] !== "number") {
    return 'A request\'s "id" must be a string or a number.';
  }
  return 'A request\'s "params" must be an object or an array.';
}
