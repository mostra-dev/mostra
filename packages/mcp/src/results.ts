/**
 * What a tool hands back (D164 item 2): the host protocol's own result, raw, as JSON text the
 * model reads; Markdown where the protocol gives Markdown; images where verify returns them. A
 * failure is a tool result with `isError` whose text is the diagnostic, so the model reads its
 * code, hint and docs link and can act on them. Nothing here is the CLI's envelope.
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import { createDiagnostic, type Diagnostic, RpcError } from "@mostra/protocol";

/** A result as JSON text. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** A result as text (Markdown). */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** The diagnostic an exception is: its own, or an internal error naming what failed. */
export function diagnosticOf(error: unknown): Diagnostic {
  if (error instanceof RpcError) return error.diagnostic;
  const diagnostic = (error as { diagnostic?: unknown } | undefined)?.diagnostic;
  if (
    typeof diagnostic === "object" &&
    diagnostic !== null &&
    typeof (diagnostic as { code?: unknown }).code === "string"
  ) {
    return diagnostic as Diagnostic;
  }
  return createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
    message: `The tool failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
  });
}

/** A failure: `isError`, the diagnostic as JSON, and anything the agent needs beside it. */
export function errorResult(
  diagnostic: Diagnostic,
  details?: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: diagnostic, ...details }) }],
    isError: true,
  };
}
