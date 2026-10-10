/**
 * The additive-change rule for wire schemas (D32, HO-07). It compares two JSON Schema 2020-12
 * bundles and lists every change that is not additive within a revision:
 *
 * - a definition or a field removed;
 * - a type narrowed (a type dropped, `number` to `integer`, a constraint tightened, a pattern,
 *   format or `const` added or changed, unknown properties closed);
 * - an enum value removed;
 * - a field made required.
 *
 * New optional fields, new definitions, new enum values and widened types are additive. Keywords
 * the checker doesn't model fail closed: any change to them is reported.
 */

/** A JSON Schema node as the generators emit it. */
export type Schema = boolean | { readonly [keyword: string]: unknown };

/** A published bundle: named definitions plus the protocol revisions it describes. */
export interface Bundle {
  readonly "x-mostra-revisions"?: Readonly<Record<string, string>>;
  readonly $defs: Readonly<Record<string, Schema>>;
}

/** One non-additive change. */
export interface Break {
  /** Where, as a readable path such as `Diagnostic.properties.code`. */
  readonly path: string;
  readonly reason: string;
}

/** Keywords that document a schema without constraining it. Changes to them are always fine. */
const ANNOTATIONS = new Set([
  "description",
  "title",
  "examples",
  "default",
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
  "$schema",
  "$id",
]);

/** Keywords this checker understands. */
const MODELED = new Set([
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "$ref",
]);

type Node = { readonly [keyword: string]: unknown };

const isNode = (schema: unknown): schema is Node =>
  typeof schema === "object" && schema !== null && !Array.isArray(schema);

const asNode = (schema: Schema): Node | undefined =>
  schema === true ? {} : schema === false ? undefined : schema;

const refName = (node: Node): string | undefined =>
  typeof node["$ref"] === "string"
    ? node["$ref"].replace(/^#\/(\$defs|definitions)\//, "")
    : undefined;

function types(node: Node): Set<string> | undefined {
  const type = node["type"];
  if (type === undefined) return undefined;
  return new Set(Array.isArray(type) ? (type as string[]) : [type as string]);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

class Comparer {
  readonly breaks: Break[] = [];
  private readonly seen = new Set<string>();
  private readonly before: Bundle;
  private readonly after: Bundle;

  constructor(before: Bundle, after: Bundle) {
    this.before = before;
    this.after = after;
  }

  private report(path: string, reason: string): void {
    this.breaks.push({ path, reason });
  }

  private resolve(node: Node, bundle: Bundle): Node | undefined {
    let current: Node | undefined = node;
    for (let hops = 0; current && refName(current) !== undefined && hops < 32; hops++) {
      const target: Schema | undefined = bundle.$defs[refName(current) ?? ""];
      current = target === undefined ? undefined : asNode(target);
    }
    return current;
  }

  /** Every value `old` accepts must stay accepted by `next`, with the structural rules above. */
  compare(oldSchema: Schema, newSchema: Schema, path: string): void {
    const oldNode = asNode(oldSchema);
    const newNode = asNode(newSchema);
    if (oldNode === undefined) return;
    if (newNode === undefined) {
      this.report(path, "now accepts nothing");
      return;
    }
    const oldRef = refName(oldNode);
    const newRef = refName(newNode);
    if (oldRef !== undefined && oldRef === newRef) {
      // Same named definition: compared once, at the top level.
      return;
    }
    const key = `${path}|${oldRef ?? ""}|${newRef ?? ""}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const a = this.resolve(oldNode, this.before);
    const b = this.resolve(newNode, this.after);
    if (!a) return;
    if (!b) {
      this.report(path, `reference ${newRef} no longer resolves`);
      return;
    }
    this.compareNodes(a, b, path);
  }

  private compareNodes(a: Node, b: Node, path: string): void {
    for (const keyword of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (ANNOTATIONS.has(keyword) || MODELED.has(keyword)) continue;
      if (!same(a[keyword], b[keyword])) {
        this.report(path, `keyword "${keyword}" changed, and the checker can't prove it additive`);
      }
    }

    const branchesA = (a["anyOf"] ?? a["oneOf"]) as Schema[] | undefined;
    const branchesB = (b["anyOf"] ?? b["oneOf"]) as Schema[] | undefined;
    if (branchesA || branchesB) {
      const oldBranches = branchesA ?? [a];
      const newBranches = branchesB ?? [b];
      oldBranches.forEach((branch, index) => {
        const fits = newBranches.some((candidate) => {
          const probe = new Comparer(this.before, this.after);
          probe.compare(branch, candidate, path);
          return probe.breaks.length === 0;
        });
        if (!fits) this.report(`${path}.anyOf[${index}]`, "alternative removed or narrowed");
      });
      if (branchesA && branchesB) return;
      if (branchesA) return;
    }

    const typesA = types(a);
    const typesB = types(b);
    if (typesB && !typesA) this.report(path, `type restricted to ${[...typesB].join(", ")}`);
    if (typesA && typesB) {
      for (const type of typesA) {
        const kept = typesB.has(type) || (type === "integer" && typesB.has("number"));
        if (!kept) this.report(path, `type ${type} no longer accepted`);
      }
    }

    if (Array.isArray(b["enum"])) {
      if (!Array.isArray(a["enum"])) this.report(path, "enum added to an open value");
      else {
        for (const value of a["enum"]) {
          if (!b["enum"].some((candidate) => same(candidate, value))) {
            this.report(path, `enum value ${JSON.stringify(value)} removed`);
          }
        }
      }
    }
    if ("const" in b && !same(a["const"], b["const"])) this.report(path, "const added or changed");

    for (const keyword of ["pattern", "format"]) {
      if (keyword in b && !same(a[keyword], b[keyword])) {
        this.report(path, `${keyword} added or changed`);
      }
    }
    for (const keyword of ["minLength", "minItems", "minimum", "exclusiveMinimum"]) {
      const before = a[keyword] as number | undefined;
      const after = b[keyword] as number | undefined;
      if (after !== undefined && (before === undefined || after > before)) {
        this.report(path, `${keyword} raised`);
      }
    }
    for (const keyword of ["maxLength", "maxItems", "maximum", "exclusiveMaximum"]) {
      const before = a[keyword] as number | undefined;
      const after = b[keyword] as number | undefined;
      if (after !== undefined && (before === undefined || after < before)) {
        this.report(path, `${keyword} lowered`);
      }
    }

    const propsA = (isNode(a["properties"]) ? a["properties"] : {}) as Record<string, Schema>;
    const propsB = (isNode(b["properties"]) ? b["properties"] : {}) as Record<string, Schema>;
    for (const [name, schema] of Object.entries(propsA)) {
      const next = propsB[name];
      if (next === undefined) this.report(`${path}.${name}`, "field removed");
      else this.compare(schema, next, `${path}.${name}`);
    }
    const requiredA = new Set((a["required"] as string[] | undefined) ?? []);
    for (const name of (b["required"] as string[] | undefined) ?? []) {
      if (!requiredA.has(name)) this.report(`${path}.${name}`, "field became required");
    }
    const extraA = a["additionalProperties"] as Schema | undefined;
    const extraB = b["additionalProperties"] as Schema | undefined;
    if (extraB !== undefined && !same(extraA, extraB)) {
      if (extraA === undefined || extraA === true) {
        if (extraB !== true) this.report(path, "unknown fields no longer accepted");
      } else {
        this.compare(extraA, extraB, `${path}.*`);
      }
    }

    if (a["items"] !== undefined && b["items"] !== undefined) {
      this.compare(a["items"] as Schema, b["items"] as Schema, `${path}[]`);
    } else if (b["items"] !== undefined && b["items"] !== true && a["prefixItems"] === undefined) {
      this.report(path, "items restricted");
    }
    const tupleA = (a["prefixItems"] as Schema[] | undefined) ?? [];
    const tupleB = (b["prefixItems"] as Schema[] | undefined) ?? [];
    tupleA.forEach((schema, index) => {
      const next = tupleB[index];
      if (next !== undefined) this.compare(schema, next, `${path}[${index}]`);
    });
  }
}

/** Lists every non-additive change from `before` to `after`. */
export function compareBundles(before: Bundle, after: Bundle): Break[] {
  const comparer = new Comparer(before, after);
  for (const [name, schema] of Object.entries(before.$defs)) {
    const next = after.$defs[name];
    if (next === undefined) comparer.breaks.push({ path: name, reason: "definition removed" });
    else comparer.compare(schema, next, name);
  }
  return comparer.breaks;
}

/**
 * The surfaces whose revision moved forward from `before` to `after`. A breaking change is only
 * allowed together with a new revision (D32).
 */
export function newRevisions(before: Bundle, after: Bundle): string[] {
  const old = before["x-mostra-revisions"] ?? {};
  return Object.entries(after["x-mostra-revisions"] ?? {})
    .filter(([surface, revision]) => old[surface] !== undefined && revision > (old[surface] ?? ""))
    .map(([surface, revision]) => `${surface} ${revision}`);
}
