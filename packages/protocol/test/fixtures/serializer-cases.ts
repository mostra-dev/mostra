// The cases of the serializer's conformance suite (D54): values of every type React documents for
// Server Function arguments and results, and of the types it documents as unsupported. Shared by
// `serializer.test.ts` (Mostra's serializer) and `react-flight.mjs` (React's own Flight reply
// codec, run under the `react-server` condition), which describe each round trip the same way.
// Node runs it as TypeScript directly (type stripping), so both load it without a build.

/** One conformance case. */
export interface SerializerCase {
  readonly name: string;
  readonly documented: "supported" | "unsupported" | "undocumented";
  readonly react?: "accepted" | "refused";
  readonly argument?: "refused";
  readonly make: () => unknown;
}

const formData = (): FormData => {
  const form = new FormData();
  form.append("name", "Ada");
  form.append("name", "Grace");
  form.append("upload", new File([new Uint8Array([104, 105])], "hi.txt", { type: "text/plain" }));
  return form;
};

const cyclic = (): unknown => {
  const node: Record<string, unknown> = { name: "a" };
  node["self"] = node;
  return node;
};

const sharedObject = (): unknown => {
  const shared = { n: 1 };
  return { left: shared, right: shared, list: [shared] };
};

/**
 * Every case: `make` builds the value; `documented` is what react.dev says (`supported` or
 * `unsupported`); `react` is what React 19.3's Flight reply codec does with it when that differs
 * from the documentation, recorded as a known divergence; `argument: "refused"` marks a value both
 * refuse as an argument but a result may carry.
 */
export const CASES: readonly SerializerCase[] = [
  // Primitives
  { name: "string", documented: "supported", make: () => "hello" },
  { name: "string starting with $", documented: "supported", make: () => "$x and $$y" },
  { name: "empty string", documented: "supported", make: () => "" },
  { name: "number", documented: "supported", make: () => 3.25 },
  { name: "negative zero", documented: "supported", make: () => -0 },
  { name: "NaN", documented: "supported", make: () => Number.NaN },
  { name: "Infinity", documented: "supported", make: () => Number.POSITIVE_INFINITY },
  { name: "-Infinity", documented: "supported", make: () => Number.NEGATIVE_INFINITY },
  { name: "bigint", documented: "supported", make: () => 12345678901234567890n },
  { name: "negative bigint", documented: "supported", make: () => -7n },
  { name: "boolean", documented: "supported", make: () => true },
  { name: "undefined", documented: "supported", make: () => undefined },
  { name: "null", documented: "supported", make: () => null },
  {
    name: "registered symbol",
    documented: "supported",
    // React 19.3 refuses symbols in a reply unless the caller passes a temporary reference set,
    // which turns them into opaque references the server can't read.
    react: "refused",
    make: () => Symbol.for("mostra.case"),
  },
  // Iterables
  { name: "array", documented: "supported", make: () => [1, "two", [3]] },
  { name: "sparse array", documented: "supported", make: () => [1, , 3] },
  { name: "Map", documented: "supported", make: () => new Map<unknown, unknown>([["a", { b: 1 }], [2, [3]]]) },
  { name: "Set", documented: "supported", make: () => new Set(["a", 1, null]) },
  { name: "Uint8Array", documented: "supported", make: () => new Uint8Array([0, 1, 255]) },
  { name: "Int16Array", documented: "supported", make: () => new Int16Array([-2, 300]) },
  { name: "Float64Array", documented: "supported", make: () => new Float64Array([0.5, -1e300]) },
  { name: "BigInt64Array", documented: "supported", make: () => new BigInt64Array([-1n, 2n]) },
  { name: "ArrayBuffer", documented: "supported", make: () => new Uint8Array([9, 8, 7]).buffer },
  { name: "Date", documented: "supported", make: () => new Date(Date.UTC(2026, 9, 16, 12)) },
  { name: "FormData", documented: "supported", make: formData },
  { name: "plain object", documented: "supported", make: () => ({ a: 1, nested: { b: [true] } }) },
  { name: "object with a $ key and value", documented: "supported", make: () => ({ $k: "$v" }) },
  { name: "shared object", documented: "supported", make: sharedObject },
  { name: "cyclic object", documented: "supported", make: cyclic },
  { name: "promise", documented: "supported", make: () => Promise.resolve({ settled: 1 }) },
  {
    name: "rejected promise",
    documented: "supported",
    // React's `encodeReply` fails the whole call when an argument's promise rejects, and Mostra
    // does the same; a result carries the rejection to the page.
    react: "refused",
    argument: "refused",
    make: () => {
      const promise = Promise.reject(new Error("no"));
      promise.catch(() => {});
      return promise;
    },
  },
  // Documented as unsupported
  { name: "class instance", documented: "unsupported", make: () => new (class Point {})() },
  { name: "null-prototype object", documented: "unsupported", make: () => Object.create(null) },
  { name: "function", documented: "unsupported", make: () => () => 1 },
  { name: "unregistered symbol", documented: "unsupported", make: () => Symbol("local") },
  { name: "Error", documented: "unsupported", make: () => new Error("e") },
  { name: "RegExp", documented: "unsupported", make: () => /a/ },
  {
    name: "URL",
    documented: "unsupported",
    // React 19.3 sends it through its `toJSON` (a string), with a development warning.
    react: "accepted",
    make: () => new URL("https://example.com/"),
  },
  {
    name: "boxed String",
    documented: "unsupported",
    // React 19.3 sends a String object as an iterable of its characters.
    react: "accepted",
    make: () => new String("s"),
  },
  {
    name: "React element",
    documented: "unsupported",
    make: () => ({ $$typeof: Symbol.for("react.transitional.element"), type: "div", key: null, props: {} }),
  },
  // Not in the documentation; React 19.3's reply codec takes them, Mostra keeps to the documented set.
  { name: "Blob outside a FormData", documented: "undocumented", react: "accepted", make: () => new Blob(["x"]) },
  {
    name: "sync iterator",
    documented: "undocumented",
    react: "accepted",
    make: () =>
      (function* () {
        yield 1;
      })(),
  },
];

/** A deterministic description of a value, the same for equal values in any process. */
export async function describe(value: unknown, seen = new Map<unknown, number>()): Promise<string> {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "number":
      return Object.is(value, -0) ? "number:-0" : `number:${String(value)}`;
    case "bigint":
      return `bigint:${value}`;
    case "string":
      return `string:${JSON.stringify(value)}`;
    case "boolean":
      return `boolean:${value}`;
    case "symbol":
      return `symbol:${String(Symbol.keyFor(value))}`;
    case "function":
      return "function";
  }
  if (value === null) return "null";
  if (seen.has(value)) return `ref:${seen.get(value)}`;
  seen.set(value, seen.size);
  if (typeof value !== "object") return "unknown";
  if (value instanceof Promise) {
    try {
      return `promise:fulfilled:${await describe(await value, seen)}`;
    } catch (error) {
      return `promise:rejected:${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (value instanceof Map) {
    const entries = [];
    for (const [key, entry] of value) entries.push(`${await describe(key, seen)}=>${await describe(entry, seen)}`);
    return `map{${entries.join(",")}}`;
  }
  if (value instanceof Set) {
    const items = [];
    for (const item of value) items.push(await describe(item, seen));
    return `set{${items.join(",")}}`;
  }
  if (value instanceof ArrayBuffer) return `arraybuffer:${[...new Uint8Array(value)].join(".")}`;
  if (ArrayBuffer.isView(value)) {
    return `${(value.constructor as { name: string }).name}:${[...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)].join(".")}`;
  }
  if (value instanceof FormData) {
    const entries = [];
    for (const [key, entry] of value) {
      entries.push(
        typeof entry === "string"
          ? `${key}=${entry}`
          : `${key}=file:${entry.name}:${entry.type}:${[...new Uint8Array(await entry.arrayBuffer())].join(".")}`,
      );
    }
    return `formdata{${entries.join(",")}}`;
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) items.push(await describe(value[index], seen));
    return `array[${items.join(",")}]`;
  }
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    entries.push(`${JSON.stringify(key)}:${await describe((value as Record<string, unknown>)[key], seen)}`);
  }
  return `object{${entries.join(",")}}`;
}
