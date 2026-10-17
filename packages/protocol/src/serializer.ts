/**
 * The serializer of server-function arguments and results (D19 seam 2, D54): exactly the type set
 * React documents for Server Functions, plus `AsyncIterable` results, in one JSON wire form the
 * browser, the gateway and the worker share. It has no I/O and no Node built-ins.
 *
 * A value is written as a series of **batches**, each a JSON array of {@link Frame}s. The first
 * batch holds the value's root (chunk 0); a promise or an async iterable in it is a reference whose
 * settlement or items arrive in later batches, so a result streams as it settles. Shared objects
 * and cycles are kept: an object met twice is written once, in a chunk of its own.
 *
 * ```ts
 * const batches: Frame[][] = [];
 * const writer = new ValueWriter({ mode: "result", onBatch: (batch) => batches.push(batch) });
 * await writer.write({ when: new Date(), items: new Map([["a", 1]]) });
 * await writer.done;
 * const reader = new ValueReader();
 * for (const batch of batches) reader.push(batch);
 * const value = await reader.root;
 * ```
 *
 * What it accepts (react.dev, `'use server'`, "Serializable arguments and return values"):
 * strings, numbers (`NaN`, infinities and `-0` too), bigints, booleans, `undefined`, `null`,
 * symbols registered with `Symbol.for`, arrays, `Map`, `Set`, typed arrays, `DataView`,
 * `ArrayBuffer`, `Date`, `FormData` (with string and file values), plain objects, Server Functions
 * and promises; results may also be async iterables. Anything else (class instances, objects with
 * a null prototype, other functions, unregistered symbols, React elements) is refused with a
 * {@link SerializationError} naming where it is.
 */

/** One step of a written value. */
export type Frame =
  /** An outlined chunk: chunk 0 is the root; others hold shared objects, maps, sets and bytes. */
  | { readonly c: number; readonly v: unknown }
  /** A promise settled: with its value, or rejected with an error. */
  | { readonly p: number; readonly v: unknown }
  | { readonly p: number; readonly e: WireError }
  /** An async iterable's item, its end, or its failure. */
  | { readonly i: number; readonly v: unknown }
  | { readonly i: number; readonly end: true }
  | { readonly i: number; readonly e: WireError };

/** A frame about a promise or an async iterable. */
type AsyncFrame = Exclude<Frame, { readonly c: number }>;

/** An error as the wire carries it: a rejected promise, a failed iteration. */
export interface WireError {
  /** The error's message. */
  readonly message: string;
  /** Its diagnostic code, when it carried one (`MOSTRA_SECRET_MISSING`, say). */
  readonly code?: string;
}

/** Any function: a Server Function as the serializer sees it. */
export type AnyFunction = (...args: never) => unknown;

/** Whether a value is written as a call's arguments or as its result. */
export type SerializeMode = "argument" | "result";

/**
 * The most digits a bigint argument may have. A page's arguments are decoded before the action
 * runs, and parsing a bigint takes time that grows faster than its length: 16 M digits held a
 * worker's event loop for seconds. Results aren't limited; server code writes them.
 */
export const ARGUMENT_BIGINT_DIGITS_MAX = 10_000;

/** The diagnostic code of a value outside the type set (INTERFACES §2.4). */
export const UNSERIALIZABLE_CODE = "MOSTRA_ACTION_UNSERIALIZABLE";

/** A value outside the type set, or a malformed written value. */
export class SerializationError extends Error {
  /** Always `MOSTRA_ACTION_UNSERIALIZABLE`. */
  readonly code: string = UNSERIALIZABLE_CODE;
  /** Where in the value: `.items[2].when`, or empty for the value itself. */
  readonly path: string;
  constructor(message: string, path = "") {
    super(path === "" ? message : `${where(path)} ${message}`);
    this.name = "SerializationError";
    this.path = path;
  }
}

/** A path as people read it: `[1].when` is "argument 2's .when". */
function where(path: string): string {
  const argument = /^\[(\d+)\](.*)$/.exec(path);
  if (argument) {
    const rest = argument[2] ?? "";
    return `Argument ${Number(argument[1]) + 1}${rest === "" ? "" : ` at ${rest}`}`;
  }
  return path.startsWith("result") ? `The ${path}` : `The value at ${path}`;
}

/** The error a rejected promise or a failed iteration carries on the wire. */
export function wireError(error: unknown): WireError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return { message: error.message, ...(typeof code === "string" ? { code } : {}) };
  }
  return { message: String(error) };
}

/** An error read back from the wire, as the reader's promises and iterables reject with it. */
export class RemoteError extends Error {
  /** The diagnostic code the error carried, if any. */
  readonly code: string | undefined;
  constructor(error: WireError) {
    super(error.message);
    this.name = "RemoteError";
    this.code = error.code;
  }
}

// ── Base64, without Node's Buffer ──────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) LOOKUP[ALPHABET.charCodeAt(index)] = index;

/** Standard base64 of `bytes`, with padding. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const n =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    out +=
      ALPHABET.charAt((n >> 18) & 63) +
      ALPHABET.charAt((n >> 12) & 63) +
      ALPHABET.charAt((n >> 6) & 63) +
      ALPHABET.charAt(n & 63);
  }
  const rest = bytes.length - index;
  if (rest === 1) {
    const n = (bytes[index] ?? 0) << 16;
    out += `${ALPHABET[(n >> 18) & 63]}${ALPHABET[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8);
    out += `${ALPHABET[(n >> 18) & 63]}${ALPHABET[(n >> 12) & 63]}${ALPHABET[(n >> 6) & 63]}=`;
  }
  return out;
}

/** The bytes of standard base64 text; throws a {@link SerializationError} on anything else. */
export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new SerializationError("Malformed base64 bytes.");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let index = 0; index < text.length; index += 4) {
    const quad = [0, 1, 2, 3].map((offset) => {
      const char = text.charCodeAt(index + offset);
      if (char === 61 && index + offset >= text.length - padding) return 0;
      const value = char < 128 ? (LOOKUP[char] ?? -1) : -1;
      if (value < 0) throw new SerializationError("Malformed base64 bytes.");
      return value;
    });
    const n =
      ((quad[0] ?? 0) << 18) | ((quad[1] ?? 0) << 12) | ((quad[2] ?? 0) << 6) | (quad[3] ?? 0);
    if (at < out.length) out[at++] = (n >> 16) & 255;
    if (at < out.length) out[at++] = (n >> 8) & 255;
    if (at < out.length) out[at++] = n & 255;
  }
  return out;
}

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────

/** The typed-array kinds, by the tag the wire uses. */
const TYPED_ARRAYS = {
  Int8Array: "i8",
  Uint8Array: "u8",
  Uint8ClampedArray: "u8c",
  Int16Array: "i16",
  Uint16Array: "u16",
  Int32Array: "i32",
  Uint32Array: "u32",
  Float32Array: "f32",
  Float64Array: "f64",
  BigInt64Array: "i64",
  BigUint64Array: "u64",
  DataView: "dv",
} as const;

type TypedKind = (typeof TYPED_ARRAYS)[keyof typeof TYPED_ARRAYS];

const TYPED_CONSTRUCTORS: Readonly<Record<TypedKind, (buffer: ArrayBuffer) => ArrayBufferView>> = {
  i8: (b) => new Int8Array(b),
  u8: (b) => new Uint8Array(b),
  u8c: (b) => new Uint8ClampedArray(b),
  i16: (b) => new Int16Array(b),
  u16: (b) => new Uint16Array(b),
  i32: (b) => new Int32Array(b),
  u32: (b) => new Uint32Array(b),
  f32: (b) => new Float32Array(b),
  f64: (b) => new Float64Array(b),
  i64: (b) => new BigInt64Array(b),
  u64: (b) => new BigUint64Array(b),
  dv: (b) => new DataView(b),
};

/**
 * The wire tag of a typed array or `DataView`, or `undefined` for anything else. A subclass is
 * its built-in base (Node's `Buffer` is a `Uint8Array`), found along the prototype chain, so
 * what Node's file and crypto APIs return crosses as the bytes it holds.
 */
function typedKind(value: object): TypedKind | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  for (
    let proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
    proto !== null;
    proto = Object.getPrototypeOf(proto) as { constructor?: { name?: string } } | null
  ) {
    const name = Object.hasOwn(proto, "constructor") ? proto.constructor?.name : undefined;
    if (name !== undefined && name in TYPED_ARRAYS) {
      return TYPED_ARRAYS[name as keyof typeof TYPED_ARRAYS];
    }
  }
  return undefined;
}

const isPlainObject = (value: object): boolean => Object.getPrototypeOf(value) === Object.prototype;

const isBlob = (value: unknown): value is Blob =>
  typeof Blob !== "undefined" && value instanceof Blob;

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== "undefined" && value instanceof FormData;

const isPromiseLike = (value: object): value is PromiseLike<unknown> =>
  value instanceof Promise ||
  (typeof (value as { then?: unknown }).then === "function" && !isPlainObject(value));

const isAsyncIterable = (value: object): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";

/** React's element marker: elements are refused (they belong to the `rsc` mode, D19). */
const REACT_ELEMENT = Symbol.for("react.transitional.element");
const REACT_LEGACY_ELEMENT = Symbol.for("react.element");

function describe(value: object): string {
  const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  if (proto === null) return "an object with a null prototype";
  const name = proto.constructor?.name;
  return name ? `an instance of ${name}` : "an object that isn't plain";
}

const pathKey = (key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;

// ── Writing ────────────────────────────────────────────────────────────────────────────────

/** Options for {@link ValueWriter}. */
export interface ValueWriterOptions {
  /** `argument`: no async iterables. `result`: everything. */
  readonly mode: SerializeMode;
  /** Receives each batch, in order. */
  readonly onBatch: (batch: Frame[]) => void;
  /**
   * The ID of a function that is a Server Function, or `undefined` for any other function. The
   * client's stubs carry their ID; the worker knows its registry.
   */
  readonly serverFunctionId?: (fn: AnyFunction) => string | undefined;
}

/**
 * Writes one value as batches. `write` throws a {@link SerializationError} when the value, or
 * anything it holds synchronously, is outside the type set; a promise that later settles with such
 * a value is written as rejected with that error. `done` settles once every promise and iterable
 * in the value has settled or ended; `abort` stops iterables early (the reader went away).
 */
export class ValueWriter {
  readonly #options: ValueWriterOptions;
  #nextId = 1;
  #pending = 0;
  #aborted = false;
  #cutShort = false;
  #wroteRoot = false;
  readonly #rootPath: string;
  #queue: Promise<void> = Promise.resolve();
  readonly #iterators = new Set<AsyncIterator<unknown>>();
  #resolveDone!: () => void;
  #rejectDone!: (error: unknown) => void;
  /** Settles once every async part of the value has been written. */
  readonly done: Promise<void>;

  constructor(options: ValueWriterOptions) {
    this.#options = options;
    this.#rootPath = options.mode === "result" ? "result" : "";
    this.done = new Promise((resolve, reject) => {
      this.#resolveDone = resolve;
      this.#rejectDone = reject;
    });
    // `done` may be awaited by nobody when `write` fails.
    this.done.catch(() => {});
  }

  /** Writes the value's first batch; async parts follow in later batches. */
  async write(value: unknown): Promise<void> {
    if (this.#wroteRoot) throw new Error("A ValueWriter writes one value.");
    this.#wroteRoot = true;
    // The root goes first: batches of promises that settle while it is still being encoded (it
    // may read files) queue behind it.
    this.#pending += 1;
    const root = this.#encodeBatch(value, this.#rootPath, (json, frames) => {
      frames.unshift({ c: 0, v: json });
    });
    this.#queue = root.then(
      (batch) => this.#emit(batch),
      () => {},
    );
    try {
      await root;
    } catch (error) {
      this.#aborted = true;
      this.#rejectDone(error);
      throw error;
    } finally {
      this.#pending -= 1;
    }
    await this.#queue;
    this.#settleIfIdle();
  }

  /**
   * Whether {@link ValueWriter.abort} stopped the value before all of it was written: a promise
   * still unsettled, an iterable not yet ended.
   */
  get cutShort(): boolean {
    return this.#cutShort;
  }

  /** Stops every iterable still being read, and settles `done`. */
  abort(): void {
    if (this.#aborted) return;
    this.#cutShort = this.#pending > 0;
    this.#aborted = true;
    for (const iterator of this.#iterators) void iterator.return?.()?.catch?.(() => {});
    this.#iterators.clear();
    this.#resolveDone();
  }

  #emit(batch: Frame[]): void {
    if (this.#aborted) return;
    this.#options.onBatch(batch);
  }

  #settleIfIdle(): void {
    if (this.#pending === 0) this.#resolveDone();
  }

  /** Runs batch production one at a time, so batches leave in the order they were started. */
  #serial(task: () => Promise<Frame[] | undefined>): void {
    this.#pending += 1;
    this.#queue = this.#queue
      .then(async () => {
        const batch = await task();
        if (batch) this.#emit(batch);
      })
      .catch((error: unknown) => {
        this.#aborted = true;
        this.#rejectDone(error);
      })
      .finally(() => {
        this.#pending -= 1;
        this.#settleIfIdle();
      });
  }

  /**
   * Encodes `value` into a batch: `place` puts the encoded root into the batch, whose other
   * frames are the chunks it needs.
   */
  async #encodeBatch(
    value: unknown,
    path: string,
    place: (json: unknown, frames: Frame[]) => void,
  ): Promise<Frame[]> {
    const frames: Frame[] = [];
    const shared = countShared(value);
    const outlined = new Map<object, number>();
    const blobs: { id: number; blob: Blob }[] = [];
    const encode = (item: unknown, at: string, depth: number): unknown => {
      if (depth > MAX_DEPTH) throw new SerializationError("The value nests too deeply.", at);
      switch (typeof item) {
        case "string":
          return item.startsWith("$") ? `$${item}` : item;
        case "number":
          if (Number.isNaN(item)) return "$NaN";
          if (item === Number.POSITIVE_INFINITY) return "$Infinity";
          if (item === Number.NEGATIVE_INFINITY) return "$-Infinity";
          if (Object.is(item, -0)) return "$-0";
          return item;
        case "boolean":
          return item;
        case "undefined":
          return "$undefined";
        case "bigint": {
          const digits = item.toString();
          if (
            this.#options.mode === "argument" &&
            digits.replace("-", "").length > ARGUMENT_BIGINT_DIGITS_MAX
          ) {
            throw new SerializationError(
              `is a bigint of more than ${ARGUMENT_BIGINT_DIGITS_MAX} digits; send a larger number as a string.`,
              at,
            );
          }
          return `$n${digits}`;
        }
        case "symbol": {
          if (this.#options.mode === "argument") {
            // React 19.3's reply codec refuses symbols in arguments too (VERIFIED_FACTS, WP-08):
            // a registered symbol lives as long as the process, so a page could fill the
            // worker's memory with them.
            throw new SerializationError(
              "is a symbol; an argument can't be one, only a result can (a registered symbol).",
              at,
            );
          }
          const key = Symbol.keyFor(item);
          if (key === undefined) {
            throw new SerializationError(
              "is a symbol not registered with Symbol.for; only registered symbols can be sent.",
              at,
            );
          }
          return `$S${key}`;
        }
        case "function": {
          const id = this.#options.serverFunctionId?.(item as AnyFunction);
          if (id === undefined) {
            throw new SerializationError(
              "is a function that isn't a Server Function; only Server Functions can be sent.",
              at,
            );
          }
          return `$h${id}`;
        }
        case "object":
          break;
      }
      if (item === null) return null;
      const object = item as object;
      const known = outlined.get(object);
      if (known !== undefined) return `$${known}`;
      if (
        (object as { $$typeof?: unknown }).$$typeof === REACT_ELEMENT ||
        (object as { $$typeof?: unknown }).$$typeof === REACT_LEGACY_ELEMENT
      ) {
        throw new SerializationError(
          "is a React element; JSX can't cross a server call in the SPA render mode.",
          at,
        );
      }
      if (object instanceof Date) {
        return Number.isNaN(object.getTime()) ? "$DInvalid" : `$D${object.toISOString()}`;
      }
      if (isPromiseLike(object)) {
        const id = this.#nextId++;
        this.#watchPromise(id, object, `${at}.then`);
        return `$@${id}`;
      }
      if (isFormData(object)) {
        const id = this.#nextId++;
        const entries: unknown[] = [];
        for (const [name, entry] of object.entries()) {
          if (typeof entry === "string") entries.push([name, encode(entry, at, depth + 1)]);
          else {
            const blobId = this.#nextId++;
            blobs.push({ id: blobId, blob: entry });
            entries.push([name, `$B${blobId}`]);
          }
        }
        frames.push({ c: id, v: entries });
        return `$K${id}`;
      }
      if (object instanceof ArrayBuffer) {
        const id = this.#nextId++;
        frames.push({ c: id, v: toBase64(new Uint8Array(object)) });
        return `$A${id}`;
      }
      const typed = typedKind(object);
      if (typed !== undefined) {
        const view = object as ArrayBufferView;
        const id = this.#nextId++;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        frames.push({ c: id, v: [typed, toBase64(bytes)] });
        return `$T${id}`;
      }
      const outline = (encoded: () => unknown, tag: string): string => {
        const id = this.#nextId++;
        outlined.set(object, id);
        const frame: { c: number; v: unknown } = { c: id, v: null };
        frames.push(frame);
        frame.v = encoded();
        return `${tag}${id}`;
      };
      if (object instanceof Map) {
        return outline(
          () =>
            [...object.entries()].map(([key, entry], index) => [
              encode(key, `${at}.<map key ${index}>`, depth + 1),
              encode(entry, `${at}.<map value ${index}>`, depth + 1),
            ]),
          "$Q",
        );
      }
      if (object instanceof Set) {
        return outline(
          () =>
            [...object].map((entry, index) =>
              encode(entry, `${at}.<set item ${index}>`, depth + 1),
            ),
          "$W",
        );
      }
      if (Array.isArray(object)) {
        const build = (): unknown[] => {
          const out: unknown[] = [];
          for (let index = 0; index < object.length; index += 1) {
            out.push(encode(object[index], `${at}[${index}]`, depth + 1));
          }
          return out;
        };
        return shared.has(object) ? outline(build, "$") : build();
      }
      if (this.#options.mode === "result" && isAsyncIterable(object)) {
        const id = this.#nextId++;
        this.#watchIterable(id, object, at);
        return `$x${id}`;
      }
      if (isBlob(object)) {
        throw new SerializationError(
          "is a Blob or File; send files inside a FormData, as React's Server Functions take them.",
          at,
        );
      }
      if (!isPlainObject(object)) {
        if (isAsyncIterable(object)) {
          throw new SerializationError(
            "is an async iterable; only a result may be one, never an argument.",
            at,
          );
        }
        throw new SerializationError(
          `is ${describe(object)}; only plain objects and the built-ins React's Server Functions accept can be sent.`,
          at,
        );
      }
      const build = (): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(object)) {
          const encoded = encode(
            (object as Record<string, unknown>)[key],
            `${at}${pathKey(key)}`,
            depth + 1,
          );
          Object.defineProperty(out, key, {
            value: encoded,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return out;
      };
      return shared.has(object) ? outline(build, "$") : build();
    };
    const root = encode(value, path, 0);
    for (const { id, blob } of blobs) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const file = blob as Blob & { name?: unknown; lastModified?: unknown };
      frames.push({
        c: id,
        v: {
          type: blob.type,
          data: toBase64(bytes),
          ...(typeof file.name === "string" ? { name: file.name } : {}),
          ...(typeof file.lastModified === "number" ? { lastModified: file.lastModified } : {}),
        },
      });
    }
    place(root, frames);
    return frames;
  }

  #watchPromise(id: number, promise: PromiseLike<unknown>, path: string): void {
    this.#pending += 1;
    Promise.resolve(promise).then(
      (settled) => {
        this.#serial(() =>
          this.#encodeBatch(settled, path, (json, frames) => frames.push({ p: id, v: json })).catch(
            (error: unknown) => [{ p: id, e: wireError(error) }],
          ),
        );
        this.#pending -= 1;
      },
      (error: unknown) => {
        // React's `encodeReply` fails the call when an argument's promise rejects; only a result
        // carries a rejection to the other side.
        if (this.#options.mode === "argument") {
          this.#serial(async () => {
            throw error;
          });
        } else this.#serial(async () => [{ p: id, e: wireError(error) }]);
        this.#pending -= 1;
      },
    );
  }

  #watchIterable(id: number, iterable: AsyncIterable<unknown>, path: string): void {
    let iterator: AsyncIterator<unknown>;
    try {
      iterator = iterable[Symbol.asyncIterator]();
    } catch (error) {
      this.#serial(async () => [{ i: id, e: wireError(error) }]);
      return;
    }
    this.#iterators.add(iterator);
    this.#pending += 1;
    const step = async (): Promise<void> => {
      for (let index = 0; ; index += 1) {
        if (this.#aborted) return;
        let next: IteratorResult<unknown>;
        try {
          next = await iterator.next();
        } catch (error) {
          this.#serial(async () => [{ i: id, e: wireError(error) }]);
          return;
        }
        if (next.done) {
          this.#serial(async () => [{ i: id, end: true }]);
          return;
        }
        const item = next.value;
        const at = `${path}<item ${index}>`;
        let failed = false;
        this.#serial(() =>
          this.#encodeBatch(item, at, (json, frames) => frames.push({ i: id, v: json })).catch(
            (error: unknown) => {
              failed = true;
              return [{ i: id, e: wireError(error) }];
            },
          ),
        );
        // Wait for the item to be written before pulling the next, so a slow reader paces it.
        await this.#queue;
        if (failed) {
          void iterator.return?.()?.catch?.(() => {});
          return;
        }
      }
    };
    void step().finally(() => {
      this.#iterators.delete(iterator);
      this.#pending -= 1;
      this.#settleIfIdle();
    });
  }
}

/** The deepest nesting a value may have, so a hostile value can't exhaust the stack. */
const MAX_DEPTH = 512;

/** The objects and arrays `value` reaches more than once (shared, or part of a cycle). */
function countShared(value: unknown): Set<object> {
  const seen = new Set<object>();
  const shared = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item !== "object" || item === null) continue;
    if (seen.has(item)) {
      shared.add(item);
      continue;
    }
    seen.add(item);
    if (Array.isArray(item)) {
      for (const entry of item) stack.push(entry);
    } else if (item instanceof Map) {
      for (const [key, entry] of item) stack.push(key, entry);
    } else if (item instanceof Set) {
      for (const entry of item) stack.push(entry);
    } else if (Object.getPrototypeOf(item) === Object.prototype) {
      for (const key of Object.keys(item)) stack.push((item as Record<string, unknown>)[key]);
    }
  }
  return shared;
}

/**
 * Writes `value` completely: every promise settled, so the batches can be sent at once. For
 * arguments, which a browser sends in one request.
 */
export async function serializeAll(
  value: unknown,
  options: Omit<ValueWriterOptions, "onBatch">,
): Promise<Frame[][]> {
  const batches: Frame[][] = [];
  const writer = new ValueWriter({ ...options, onBatch: (batch) => batches.push(batch) });
  await writer.write(value);
  await writer.done;
  return batches;
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────

/** Options for {@link ValueReader}. */
export interface ValueReaderOptions {
  /** The function a Server Function ID stands for; absent: a reference is refused. */
  readonly serverFunction?: (id: string) => AnyFunction;
  /**
   * `argument`: what a page sent, read where server code runs: no symbols, no async iterables,
   * bigints of at most {@link ARGUMENT_BIGINT_DIGITS_MAX} digits, the writer's own limits. Default
   * `result`: everything the writer writes.
   */
  readonly mode?: SerializeMode;
}

interface Deferred {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  settled: boolean;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  const entry: Deferred = {
    promise,
    resolve: (value) => {
      entry.settled = true;
      resolve(value);
    },
    reject: (error) => {
      entry.settled = true;
      reject(error);
    },
    settled: false,
  };
  return entry;
}

/** An async iterable fed by frames: one reader, items buffered until taken. */
class FedIterable implements AsyncIterable<unknown> {
  readonly #items: unknown[] = [];
  #ended = false;
  #error: unknown;
  #wake: (() => void) | undefined;
  #taken = false;

  push(value: unknown): void {
    this.#items.push(value);
    this.#wake?.();
  }
  end(): void {
    this.#ended = true;
    this.#wake?.();
  }
  fail(error: unknown): void {
    if (this.#ended) return;
    this.#error = error;
    this.#ended = true;
    this.#wake?.();
  }
  get ended(): boolean {
    return this.#ended;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    if (this.#taken) throw new Error("This async iterable can be read once.");
    this.#taken = true;
    return {
      next: async (): Promise<IteratorResult<unknown>> => {
        for (;;) {
          if (this.#items.length > 0) return { done: false, value: this.#items.shift() };
          if (this.#ended) {
            if (this.#error !== undefined) throw this.#error;
            return { done: true, value: undefined };
          }
          await new Promise<void>((resolve) => {
            this.#wake = resolve;
          });
          this.#wake = undefined;
        }
      },
      return: async (): Promise<IteratorResult<unknown>> => {
        this.#ended = true;
        this.#items.length = 0;
        return { done: true, value: undefined };
      },
    };
  }
}

const malformed = (what: string): SerializationError =>
  new SerializationError(`The written value is malformed: ${what}.`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads batches back into a value. `root` resolves once the first batch arrived; promises and
 * async iterables in it settle and yield as later batches arrive. A malformed batch throws a
 * {@link SerializationError} from `push`; `fail` rejects everything still open, for a stream that
 * broke before its end.
 */
export class ValueReader {
  readonly #options: ValueReaderOptions;
  /** Raw chunks by ID, and what each became. */
  readonly #raw = new Map<number, unknown>();
  readonly #decoded = new Map<number, unknown>();
  readonly #promises = new Map<number, Deferred>();
  readonly #iterables = new Map<number, FedIterable>();
  /** Frames for promises or iterables not referenced yet. */
  readonly #early: AsyncFrame[] = [];
  readonly #root = deferred();
  #hasRoot = false;
  /** The value, once the first batch arrived. */
  readonly root: Promise<unknown> = this.#root.promise;

  constructor(options: ValueReaderOptions = {}) {
    this.#options = options;
  }

  /** Whether every promise and iterable read so far has settled or ended. */
  get complete(): boolean {
    return (
      this.#hasRoot &&
      [...this.#promises.values()].every((entry) => entry.settled) &&
      [...this.#iterables.values()].every((entry) => entry.ended)
    );
  }

  /** Takes one batch. */
  push(batch: unknown): void {
    if (!Array.isArray(batch)) throw malformed("a batch isn't an array");
    const ordered: AsyncFrame[] = [];
    for (const frame of batch) {
      if (!isRecord(frame)) throw malformed("a frame isn't an object");
      if (typeof frame["c"] === "number") {
        if (!Number.isSafeInteger(frame["c"]) || frame["c"] < 0) throw malformed("a chunk ID");
        if (this.#raw.has(frame["c"])) throw malformed(`chunk ${frame["c"]} was written twice`);
        this.#raw.set(frame["c"], frame["v"]);
      } else if (typeof frame["p"] === "number" || typeof frame["i"] === "number") {
        ordered.push(frame as unknown as AsyncFrame);
      } else {
        throw malformed("a frame has no chunk, promise or iterable ID");
      }
    }
    if (!this.#hasRoot && this.#raw.has(0)) {
      this.#hasRoot = true;
      try {
        this.#root.resolve(this.#decode(this.#raw.get(0), 0));
      } catch (error) {
        this.#root.reject(error);
        throw error;
      }
    }
    for (const frame of ordered) this.#apply(frame);
  }

  /**
   * Ends the value: every frame taken so far is applied, and the value must be complete. Throws a
   * {@link SerializationError} when a promise or iterable it holds is still open or a frame names
   * one the value never refers to, so a reader that has all the batches (a page's arguments)
   * never hands on a promise that can't settle.
   */
  finish(): void {
    if (!this.#hasRoot) throw malformed("the value has no root");
    for (;;) {
      const before = this.#early.length;
      if (before === 0) break;
      this.#flush();
      if (this.#early.length === before) break;
    }
    if (this.#early.length > 0) throw malformed("a frame names a promise the value doesn't hold");
    if (!this.complete) throw malformed("the value ended before its promises settled");
  }

  /** Rejects every promise and iterable still open: the stream broke. */
  fail(error: unknown): void {
    if (!this.#hasRoot) this.#root.reject(error);
    for (const entry of this.#promises.values()) if (!entry.settled) entry.reject(error);
    for (const entry of this.#iterables.values()) entry.fail(error);
  }

  #apply(frame: AsyncFrame): void {
    if ("p" in frame) {
      const entry = this.#promises.get(frame.p);
      if (!entry) {
        this.#early.push(frame);
        return;
      }
      if (entry.settled) throw malformed(`promise ${frame.p} settled twice`);
      if ("e" in frame) entry.reject(new RemoteError(readError(frame.e)));
      else entry.resolve(this.#decode(frame.v, 0));
      return;
    }
    const entry = this.#iterables.get(frame.i);
    if (!entry) {
      this.#early.push(frame);
      return;
    }
    if ("e" in frame) entry.fail(new RemoteError(readError(frame.e)));
    else if ("end" in frame) entry.end();
    else entry.push(this.#decode(frame.v, 0));
  }

  #chunk(id: number): unknown {
    if (!this.#raw.has(id)) throw malformed(`chunk ${id} is missing`);
    return this.#raw.get(id);
  }

  #take(id: number, build: (raw: unknown) => unknown): unknown {
    if (this.#decoded.has(id)) return this.#decoded.get(id);
    const value = build(this.#chunk(id));
    if (!this.#decoded.has(id)) this.#decoded.set(id, value);
    return value;
  }

  #flush(): void {
    const early = this.#early.splice(0);
    for (const frame of early) this.#apply(frame);
  }

  #decode(json: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) throw malformed("the value nests too deeply");
    if (json === null || typeof json === "boolean") return json;
    if (typeof json === "number") {
      if (!Number.isFinite(json)) throw malformed("a number isn't finite");
      return json;
    }
    if (typeof json === "string") return this.#string(json, depth);
    if (Array.isArray(json)) return json.map((item) => this.#decode(item, depth + 1));
    if (isRecord(json)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(json)) {
        Object.defineProperty(out, key, {
          value: this.#decode(json[key], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    throw malformed("a value isn't JSON");
  }

  #id(text: string, at: number): number {
    const id = Number(text.slice(at));
    if (!/^[0-9]+$/.test(text.slice(at)) || !Number.isSafeInteger(id)) {
      throw malformed(`the reference ${JSON.stringify(text.slice(0, 40))}`);
    }
    return id;
  }

  #string(text: string, depth: number): unknown {
    if (!text.startsWith("$")) return text;
    if (text.startsWith("$$")) return text.slice(1);
    switch (text) {
      case "$undefined":
        return undefined;
      case "$NaN":
        return Number.NaN;
      case "$Infinity":
        return Number.POSITIVE_INFINITY;
      case "$-Infinity":
        return Number.NEGATIVE_INFINITY;
      case "$-0":
        return -0;
      case "$DInvalid":
        return new Date(Number.NaN);
    }
    const tag = text[1];
    switch (tag) {
      case "n":
        if (!/^-?[0-9]+$/.test(text.slice(2))) throw malformed("a bigint");
        if (
          this.#options.mode === "argument" &&
          text.replace("-", "").length - 2 > ARGUMENT_BIGINT_DIGITS_MAX
        ) {
          throw malformed(`a bigint argument has more than ${ARGUMENT_BIGINT_DIGITS_MAX} digits`);
        }
        return BigInt(text.slice(2));
      case "S":
        // Symbol.for keeps every name it is given for the life of the process.
        if (this.#options.mode === "argument") throw malformed("an argument is a symbol");
        return Symbol.for(text.slice(2));
      case "D": {
        const date = new Date(text.slice(2));
        if (Number.isNaN(date.getTime())) throw malformed("a date");
        return date;
      }
      case "h": {
        const id = text.slice(2);
        if (!this.#options.serverFunction) throw malformed(`a Server Function reference ${id}`);
        return this.#options.serverFunction(id);
      }
      case "@": {
        const id = this.#id(text, 2);
        let entry = this.#promises.get(id);
        if (!entry) {
          entry = deferred();
          this.#promises.set(id, entry);
          queueMicrotask(() => this.#flushSafely());
        }
        return entry.promise;
      }
      case "x": {
        if (this.#options.mode === "argument") throw malformed("an argument is an async iterable");
        const id = this.#id(text, 2);
        let entry = this.#iterables.get(id);
        if (!entry) {
          entry = new FedIterable();
          this.#iterables.set(id, entry);
          queueMicrotask(() => this.#flushSafely());
        }
        return entry;
      }
      case "Q": {
        const id = this.#id(text, 2);
        if (this.#decoded.has(id)) return this.#decoded.get(id);
        const map = new Map<unknown, unknown>();
        this.#decoded.set(id, map);
        const raw = this.#chunk(id);
        if (!Array.isArray(raw)) throw malformed("a map");
        for (const pair of raw) {
          if (!Array.isArray(pair) || pair.length !== 2) throw malformed("a map entry");
          map.set(this.#decode(pair[0], depth + 1), this.#decode(pair[1], depth + 1));
        }
        return map;
      }
      case "W": {
        const id = this.#id(text, 2);
        if (this.#decoded.has(id)) return this.#decoded.get(id);
        const set = new Set<unknown>();
        this.#decoded.set(id, set);
        const raw = this.#chunk(id);
        if (!Array.isArray(raw)) throw malformed("a set");
        for (const item of raw) set.add(this.#decode(item, depth + 1));
        return set;
      }
      case "A":
        return this.#take(this.#id(text, 2), (raw) => {
          if (typeof raw !== "string") throw malformed("an ArrayBuffer");
          const bytes = fromBase64(raw);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        });
      case "T":
        return this.#take(this.#id(text, 2), (raw) => {
          if (!Array.isArray(raw) || typeof raw[1] !== "string") throw malformed("a typed array");
          const make = TYPED_CONSTRUCTORS[raw[0] as TypedKind];
          if (!make) throw malformed("a typed array's kind");
          const bytes = fromBase64(raw[1]);
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          try {
            return make(buffer as ArrayBuffer);
          } catch {
            throw malformed("a typed array's length");
          }
        });
      case "B":
        return this.#take(this.#id(text, 2), (raw) => {
          if (
            !isRecord(raw) ||
            typeof raw["data"] !== "string" ||
            typeof raw["type"] !== "string"
          ) {
            throw malformed("a file");
          }
          const bytes = fromBase64(raw["data"]);
          const parts = [bytes as Uint8Array<ArrayBuffer>];
          if (typeof raw["name"] === "string" && typeof File !== "undefined") {
            return new File(parts, raw["name"], {
              type: raw["type"],
              ...(typeof raw["lastModified"] === "number"
                ? { lastModified: raw["lastModified"] }
                : {}),
            });
          }
          return new Blob(parts, { type: raw["type"] });
        });
      case "K":
        return this.#take(this.#id(text, 2), (raw) => {
          if (!Array.isArray(raw)) throw malformed("a FormData");
          const form = new FormData();
          for (const entry of raw) {
            if (!Array.isArray(entry) || typeof entry[0] !== "string")
              throw malformed("a FormData entry");
            const value = this.#decode(entry[1], depth + 1);
            if (typeof value === "string") form.append(entry[0], value);
            else if (isBlob(value)) form.append(entry[0], value);
            else throw malformed("a FormData value");
          }
          return form;
        });
      default: {
        // `$<id>`: a shared object or array, outlined.
        const id = this.#id(text, 1);
        if (this.#decoded.has(id)) return this.#decoded.get(id);
        const raw = this.#chunk(id);
        if (Array.isArray(raw)) {
          const array: unknown[] = [];
          this.#decoded.set(id, array);
          for (const item of raw) array.push(this.#decode(item, depth + 1));
          return array;
        }
        if (!isRecord(raw)) throw malformed("a shared object");
        const object: Record<string, unknown> = {};
        this.#decoded.set(id, object);
        for (const key of Object.keys(raw)) {
          Object.defineProperty(object, key, {
            value: this.#decode(raw[key], depth + 1),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return object;
      }
    }
  }

  #flushSafely(): void {
    try {
      this.#flush();
    } catch (error) {
      this.fail(error);
    }
  }
}

function readError(value: unknown): WireError {
  if (!isRecord(value) || typeof value["message"] !== "string") throw malformed("an error");
  return {
    message: value["message"],
    ...(typeof value["code"] === "string" ? { code: value["code"] } : {}),
  };
}

/**
 * Reads complete batches back into a value: every promise in it settled from the batches, every
 * async iterable replaying its items. For arguments and stored results.
 */
export async function deserializeAll(
  batches: readonly unknown[],
  options: ValueReaderOptions = {},
): Promise<unknown> {
  const reader = new ValueReader(options);
  for (const batch of batches) reader.push(batch);
  // Arguments arrive whole: one that can't be finished is refused before anything runs.
  if (options.mode === "argument") reader.finish();
  if (!reader.complete) {
    // Settle whatever the batches never settled: nothing more will come.
    queueMicrotask(() => reader.fail(new SerializationError("The written value ended early.")));
  }
  return reader.root;
}

/**
 * Checks a page's argument batches without decoding them, before they reach server code: no
 * symbol (`$S`), no async iterable (`$x`), no bigint of more than
 * {@link ARGUMENT_BIGINT_DIGITS_MAX} digits. The supervisor runs it so such arguments are refused
 * before any worker sees them (Opus review 1); the worker's reader refuses them again.
 *
 * @throws SerializationError naming what was found.
 */
export function checkArgumentFrames(batches: readonly unknown[]): void {
  const check = (text: string): void => {
    if (text.length < 2 || text[0] !== "$" || text[1] === "$") return;
    if (text[1] === "S") throw malformed("an argument is a symbol");
    if (text[1] === "x") throw malformed("an argument is an async iterable");
    if (text[1] === "n" && text.replace("-", "").length - 2 > ARGUMENT_BIGINT_DIGITS_MAX) {
      throw malformed(`a bigint argument has more than ${ARGUMENT_BIGINT_DIGITS_MAX} digits`);
    }
  };
  const scan = (value: unknown, visit: (text: string) => void): void => {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const item = stack.pop();
      if (typeof item === "string") visit(item);
      else if (Array.isArray(item)) for (const entry of item) stack.push(entry);
      else if (item !== null && typeof item === "object") {
        for (const entry of Object.values(item)) stack.push(entry);
      }
    }
  };
  // A FormData chunk's entry names are written as they are, never escaped: only its values are
  // encoded strings, so those chunks are checked value by value.
  const forms = new Set<number>();
  scan(batches, (text) => {
    const match = /^\$K([0-9]+)$/.exec(text);
    if (match) forms.add(Number(match[1]));
  });
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const frame of batch) {
      const record = frame as { c?: unknown; v?: unknown } | null;
      if (
        record !== null &&
        typeof record === "object" &&
        typeof record.c === "number" &&
        forms.has(record.c) &&
        Array.isArray(record.v)
      ) {
        for (const entry of record.v) scan(Array.isArray(entry) ? entry[1] : entry, check);
      } else scan(frame, check);
    }
  }
}
