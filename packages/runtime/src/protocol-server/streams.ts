/**
 * Newline-delimited JSON-RPC over byte streams (INTERFACES §6): stdio for `mostra-runtime host`,
 * Unix sockets for attached clients. Both feed the same {@link RpcPeer}.
 */
import type { Readable, Writable } from "node:stream";
import {
  createDiagnostic,
  encodeLine,
  LineSplitter,
  MAX_LINE_LENGTH,
  RpcError,
  type RpcPeer,
} from "@mostra/protocol";

/** A connection's raw ends. */
export interface StreamEnds {
  readonly input: Readable;
  readonly output: Writable;
}

/**
 * Connects `peer` to a stream pair: lines in, encoded messages out. Calls `onEnd` once when the
 * input ends or fails. A line longer than the limit is answered with `MOSTRA_HOST_MALFORMED` and
 * ends the connection, so a client can't make the instance buffer without bound.
 */
export function pump(ends: StreamEnds, peer: () => RpcPeer, onEnd: () => void): void {
  const splitter = new LineSplitter();
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  ends.input.setEncoding("utf8");
  ends.input.on("data", (chunk: string) => {
    let lines: string[];
    try {
      lines = splitter.push(chunk);
    } catch (error) {
      const diagnostic = createDiagnostic("MOSTRA_HOST_MALFORMED", {
        message: (error as Error).message,
      });
      writeLine(ends.output, {
        jsonrpc: "2.0",
        id: null,
        error: new RpcError(diagnostic).toErrorObject(),
      });
      ends.input.destroy();
      end();
      return;
    }
    for (const line of lines) peer().receiveLine(line);
  });
  ends.input.on("end", end);
  ends.input.on("close", end);
  ends.input.on("error", end);
}

/**
 * Writes one message as a line. Returns false when the stream can't take it any more. A message
 * longer than the line limit would make the reader drop the connection, so it is never written:
 * an answer becomes `MOSTRA_HOST_MESSAGE_TOO_LARGE` for its request, and anything else is dropped
 * (Mostra's own requests and notifications are bounded well below the limit).
 */
export function writeLine(output: Writable, message: Parameters<typeof encodeLine>[0]): boolean {
  if (output.destroyed || output.writableEnded) throw new Error("The connection is closed.");
  let line = encodeLine(message);
  if (line.length > MAX_LINE_LENGTH) {
    if (!("id" in message) || "method" in message || message.id === null) return true;
    line = encodeLine({
      jsonrpc: "2.0",
      id: message.id,
      error: new RpcError(
        createDiagnostic("MOSTRA_HOST_MESSAGE_TOO_LARGE", {
          message: `The answer is ${line.length} characters, longer than one protocol message carries (${MAX_LINE_LENGTH}).`,
        }),
      ).toErrorObject(),
    });
  }
  return output.write(line);
}
