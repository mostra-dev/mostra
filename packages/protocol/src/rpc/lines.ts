/**
 * Newline-delimited JSON framing for byte streams (stdio, Unix sockets): one message per line.
 * JSON text never contains a raw newline, so a newline always ends a message.
 */
import type { JsonRpcMessage } from "./messages.ts";

/** Serializes one message as a line, newline included. */
export function encodeLine(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Splits decoded text into lines. Feed it chunks as they arrive; it returns the complete lines
 * and keeps the unfinished rest. A line longer than `maxLineLength` characters throws a
 * `RangeError`, so a peer can't make the other side buffer without bound: the transport then
 * answers with `MOSTRA_HOST_MALFORMED` and closes the connection.
 */
export class LineSplitter {
  readonly #maxLineLength: number;
  #buffer = "";

  /** @param maxLineLength - The longest line accepted, in UTF-16 code units. Default 64 Mi. */
  constructor(maxLineLength: number = 64 * 1024 * 1024) {
    this.#maxLineLength = maxLineLength;
  }

  /** Returns the lines completed by `chunk`, without their newlines (and without a trailing `\r`). */
  push(chunk: string): string[] {
    const lines: string[] = [];
    const text = this.#buffer + chunk;
    let start = 0;
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", start)) {
      if (index - start > this.#maxLineLength) this.#overflow();
      const line = text.slice(start, index);
      lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
      start = index + 1;
    }
    const rest = text.slice(start);
    if (rest.length > this.#maxLineLength) this.#overflow();
    this.#buffer = rest;
    return lines;
  }

  /** The unfinished text after the last newline. A stream that ends with it holds a cut-off message. */
  get rest(): string {
    return this.#buffer;
  }

  #overflow(): never {
    this.#buffer = "";
    throw new RangeError(`A message is longer than ${this.#maxLineLength} characters.`);
  }
}
