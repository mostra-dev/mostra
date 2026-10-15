/**
 * Canonical JSON (RFC 8785, the JSON Canonicalization Scheme): one exact text for a JSON value,
 * so equal values hash equally wherever they are hashed. A submission's digest is the SHA-256 of
 * its snapshot in this form (DATA_MODEL §3), and a host can recompute it from the snapshot it
 * received.
 *
 * ```ts
 * canonicalJson({ b: [1, "x"], a: null }); // '{"a":null,"b":[1,"x"]}'
 * ```
 */

/**
 * The canonical JSON text of `value` (RFC 8785 §3.2): no whitespace; strings, numbers and
 * literals as ECMAScript's `JSON.stringify` writes them; object properties sorted by their UTF-16
 * code units at every depth; array order kept. Properties whose value is `undefined` are left out,
 * as `JSON.stringify` does.
 *
 * @throws TypeError for anything I-JSON can't hold: a non-finite number, a lone surrogate, a
 *   bigint, a function or symbol, or an `undefined` outside an object.
 */
export function canonicalJson(value: unknown): string {
  switch (typeof value) {
    case "string":
      return canonicalString(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite.");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, item]) => item !== undefined,
      );
      // The default sort compares UTF-16 code units, which is RFC 8785's order.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${canonicalString(key)}:${canonicalJson(item)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`A ${typeof value} has no JSON form.`);
  }
}

function canonicalString(text: string): string {
  // RFC 8785 §3.2.2.2: invalid Unicode (a lone surrogate) must fail rather than be escaped.
  if (!text.isWellFormed()) throw new TypeError("JSON strings must be well-formed Unicode.");
  return JSON.stringify(text);
}
