/**
 * The additive-change rule for wire schemas (D32, HO-07). It compares two JSON Schema 2020-12
 * bundles and lists every change that is not additive within a revision:
 *
 * - a definition or a field removed;
 * - a type narrowed (a type dropped, `number` to `integer`, a constraint tightened, a pattern,
 *   format or `const` added or changed, unknown properties closed, a tuple position narrowed);
 * - an enum value removed or an alternative dropped;
 * - a field made required.
 *
 * New optional fields, new definitions, new enum values and widened types are additive. The
 * checker is conservative: whenever it can't prove a change additive (keywords it doesn't model,
 * a changed `oneOf`, overlapping constraints beside a reference), it reports it.
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

const REF = "$ref";

const isNode = (schema: unknown): schema is Node =>
  typeof schema === "object" && schema !== null && !Array.isArray(schema);

const asNode = (schema: Schema): Node | undefined =>
  schema === true ? {} : schema === false ? undefined : schema;

const refName = (node: Node): string | undefined =>
  typeof node[REF] === "string" ? node[REF].replace(/^#\/(\$defs|definitions)\//, "") : undefined;

function types(node: Node): Set<string> | undefined {
  const type = node["type"];
  if (type === undefined) return undefined;
  return new Set(Array.isArray(type) ? (type as string[]) : [type as string]);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The keywords of `node` that constrain values (everything but annotations). */
const constraining = (node: Node): string[] =>
  Object.keys(node).filter((key) => !ANNOTATIONS.has(key));

function pickKeys(node: Node, keys: readonly string[]): Node {
  return Object.fromEntries(keys.filter((key) => key in node).map((key) => [key, node[key]]));
}

function omitKeys(node: Node, keys: readonly string[]): Node {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !keys.includes(key)));
}

/**
 * Splits a node into the conjuncts JSON Schema applies together: its reference, its `anyOf`, its
 * `oneOf`, and the remaining constraints. A value is valid against the node exactly when it is
 * valid against every conjunct.
 */
function conjuncts(node: Node): Node[] {
  const parts: Node[] = [];
  if (REF in node) parts.push(pickKeys(node, [REF]));
  if ("anyOf" in node) parts.push(pickKeys(node, ["anyOf"]));
  if ("oneOf" in node) parts.push(pickKeys(node, ["oneOf"]));
  const rest = omitKeys(node, [REF, "anyOf", "oneOf"]);
  if (constraining(rest).length > 0 || parts.length === 0) parts.push(rest);
  return parts;
}

/**
 * Merges two conjuncts into one node when they share no constraining keyword. JSON Schema
 * keywords apply independently, so the merge accepts exactly what both accept. Returns
 * `undefined` when they overlap or touch coupled keywords, where a merge would change meaning.
 */
function merge(a: Node, b: Node): Node | undefined {
  const keysA = new Set(constraining(a));
  if (constraining(b).some((key) => keysA.has(key))) return undefined;
  const coupled = [
    ["properties", "additionalProperties", "required"],
    ["prefixItems", "items", "minItems", "maxItems"],
  ];
  for (const group of coupled) {
    if (group.some((key) => keysA.has(key)) && group.some((key) => key in b)) return undefined;
  }
  return { ...a, ...b };
}

/**
 * Checks that every value the old schema accepts is still accepted by the new one, reporting
 * each place where that can't be shown.
 */
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

  /** Whether `old` fits `next` with no break, without reporting. */
  private fits(oldSchema: Schema, newSchema: Schema, path: string): boolean {
    const probe = new Comparer(this.before, this.after);
    probe.compare(oldSchema, newSchema, path);
    return probe.breaks.length === 0;
  }

  private definition(name: string, bundle: Bundle): Node | false | undefined {
    const target = bundle.$defs[name];
    return target === undefined ? undefined : (asNode(target) ?? false);
  }

  /** Every value `old` accepts must stay accepted by `next`. */
  compare(oldSchema: Schema, newSchema: Schema, path: string): void {
    const oldNode = asNode(oldSchema);
    const newNode = asNode(newSchema);
    if (oldNode === undefined) return;
    if (newNode === undefined) {
      this.report(path, "now accepts nothing");
      return;
    }
    // Identical schemas accept the same values; any references in them name definitions that
    // the top level compares on their own.
    if (same(oldNode, newNode)) return;

    // The new side is a conjunction: the old schema must fit every conjunct.
    const newParts = conjuncts(newNode);
    if (newParts.length > 1) {
      for (const part of newParts) this.compare(oldNode, part, path);
      return;
    }

    // The old side: a reference with constraints beside it resolves and merges.
    const oldParts = conjuncts(oldNode);
    const oldRefPart = oldParts.find((part) => REF in part);
    if (oldRefPart && oldParts.length > 1) {
      const resolved = this.definition(refName(oldRefPart) ?? "", this.before);
      if (resolved === false) return;
      const others = oldParts.filter((part) => part !== oldRefPart);
      const merged =
        resolved && others.length === 1 && others[0] ? merge(resolved, others[0]) : undefined;
      if (merged) this.compare(merged, newNode, path);
      else if (!oldParts.some((part) => this.fits(part, newNode, path))) {
        this.report(
          path,
          "constraints beside a reference changed, and the checker can't prove it additive",
        );
      }
      return;
    }
    // An old union distributes: each alternative must fit. An old oneOf accepts a subset of the
    // same anyOf, so treating it as anyOf stays sound.
    const oldUnion = oldParts.find((part) => "anyOf" in part || "oneOf" in part);
    if (oldUnion) {
      const branches = (oldUnion["anyOf"] ?? oldUnion["oneOf"]) as Schema[];
      const rest = oldParts.filter((part) => part !== oldUnion);
      branches.forEach((branch, index) => {
        const branchNode = asNode(branch);
        if (branchNode === undefined) return;
        const only = rest[0];
        const withRest =
          only === undefined ? branchNode : rest.length === 1 ? merge(branchNode, only) : undefined;
        if (withRest) this.compare(withRest, newNode, `${path}.anyOf[${index}]`);
        else if (!this.fits(branchNode, newNode, path)) {
          this.report(`${path}.anyOf[${index}]`, "alternative removed or narrowed");
        }
      });
      return;
    }

    // References: equal names are compared once, at the top level; otherwise follow them.
    const oldRef = refName(oldNode);
    const newRef = refName(newNode);
    if (oldRef !== undefined && oldRef === newRef) return;
    // Reference pairs are keyed without the path, so recursive definitions terminate.
    const key = `${oldRef ?? `${path}:${JSON.stringify(oldNode)}`}|${newRef ?? `${path}:${JSON.stringify(newNode)}`}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (oldRef !== undefined) {
      const resolved = this.definition(oldRef, this.before);
      if (resolved) this.compare(resolved, newNode, path);
      return;
    }
    if (newRef !== undefined) {
      const resolved = this.definition(newRef, this.after);
      if (resolved === undefined) this.report(path, `reference ${newRef} no longer resolves`);
      else if (resolved === false) this.report(path, "now accepts nothing");
      else this.compare(oldNode, resolved, path);
      return;
    }

    // Unions on the new side.
    if ("anyOf" in newNode) {
      const branches = newNode["anyOf"] as Schema[];
      if (!branches.some((branch) => this.fits(oldNode, branch, path))) {
        this.report(path, "no alternative accepts what the old schema accepted");
      }
      return;
    }
    if ("oneOf" in newNode) {
      // oneOf needs exactly one matching alternative; the checker can't rule out new overlap.
      this.report(
        path,
        "oneOf changed, and the checker can't prove exactly one alternative still matches",
      );
      return;
    }

    this.compareNodes(oldNode, newNode, path);
  }

  private compareNodes(a: Node, b: Node, path: string): void {
    for (const keyword of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (ANNOTATIONS.has(keyword) || MODELED.has(keyword)) continue;
      if (!same(a[keyword], b[keyword])) {
        this.report(path, `keyword "${keyword}" changed, and the checker can't prove it additive`);
      }
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
    const extraA = a["additionalProperties"] as Schema | undefined;
    const extraB = b["additionalProperties"] as Schema | undefined;
    for (const [name, schema] of Object.entries(propsA)) {
      const next = propsB[name];
      if (next === undefined) this.report(`${path}.${name}`, "field removed");
      else this.compare(schema, next, `${path}.${name}`);
    }
    // A new optional field is additive (D32), except where the old schema already constrained
    // unknown fields: values it accepted there must stay accepted under the field's schema.
    if (extraA !== undefined && extraA !== true) {
      for (const [name, schema] of Object.entries(propsB)) {
        if (!(name in propsA)) this.compare(extraA, schema, `${path}.${name}`);
      }
    }
    const requiredA = new Set((a["required"] as string[] | undefined) ?? []);
    for (const name of (b["required"] as string[] | undefined) ?? []) {
      if (!requiredA.has(name)) this.report(`${path}.${name}`, "field became required");
    }
    if (extraB !== undefined && !same(extraA, extraB)) {
      if (extraA === undefined || extraA === true) {
        if (extraB !== true) this.report(path, "unknown fields no longer accepted");
      } else {
        this.compare(extraA, extraB, `${path}.*`);
      }
    }

    // Arrays: every position either side constrains, then the open tail. In 2020-12, position i
    // follows prefixItems[i], else items, else anything.
    const tupleA = (a["prefixItems"] as Schema[] | undefined) ?? [];
    const tupleB = (b["prefixItems"] as Schema[] | undefined) ?? [];
    const itemsA = (a["items"] as Schema | undefined) ?? true;
    const itemsB = (b["items"] as Schema | undefined) ?? true;
    for (let index = 0; index < Math.max(tupleA.length, tupleB.length); index++) {
      this.compare(tupleA[index] ?? itemsA, tupleB[index] ?? itemsB, `${path}[${index}]`);
    }
    if ("items" in a || "items" in b) this.compare(itemsA, itemsB, `${path}[]`);
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

/** How long a superseded revision stays published and supported (D32, D59). */
export const DEPRECATION_MONTHS = 12;

const revisionsOf = (bundle: Bundle): Readonly<Record<string, string>> =>
  bundle["x-mostra-revisions"] ?? {};

/** The date a revision's deprecation window ends: its successor's date plus 12 months. */
function windowEnd(successor: string): string {
  const date = new Date(`${successor}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + DEPRECATION_MONTHS);
  return date.toISOString().slice(0, 10);
}

/**
 * The evolution rules across one package's published bundles, from the base to now (HO-07):
 *
 * - a bundle that still exists changes only additively;
 * - a breaking change needs a newer revision on the bundle *and* the base's bundle kept, unchanged
 *   and under its old revision, as another published bundle, so the old revision stays served;
 * - a bundle disappears only when a newer revision of each of its surfaces has existed for at
 *   least 12 months.
 *
 * Bundles are keyed by name. `today` is a `YYYY-MM-DD` date.
 */
export function compareSnapshots(
  base: ReadonlyMap<string, Bundle>,
  current: ReadonlyMap<string, Bundle>,
  today: string,
): string[] {
  const problems: string[] = [];
  const retains = (old: Bundle, except: string): string | undefined => {
    for (const [name, bundle] of current) {
      if (name === except) continue;
      if (same(revisionsOf(bundle), revisionsOf(old)) && compareBundles(old, bundle).length === 0)
        return name;
    }
    return undefined;
  };
  const successor = (surface: string, revision: string): string | undefined => {
    const newer = [...current.values()]
      .map((bundle) => revisionsOf(bundle)[surface])
      .filter((candidate): candidate is string => candidate !== undefined && candidate > revision)
      .sort();
    return newer[0];
  };
  for (const [name, old] of base) {
    const next = current.get(name);
    const oldRevisions = Object.entries(revisionsOf(old));
    if (next === undefined) {
      const blockers = oldRevisions.flatMap(([surface, revision]) => {
        const after = successor(surface, revision);
        if (after === undefined) return [`${surface} ${revision} has no newer revision`];
        if (today < windowEnd(after))
          return [`${surface} ${revision} is supported until ${windowEnd(after)}`];
        return [];
      });
      if (blockers.length > 0) {
        problems.push(
          `bundle "${name}" was removed or renamed, but ${blockers.join("; ")}. Published revisions stay for ${DEPRECATION_MONTHS} months after their successor (D59).`,
        );
      }
      continue;
    }
    const breaks = compareBundles(old, next);
    if (breaks.length === 0) continue;
    const moved = oldRevisions.every(([surface, revision]) => {
      const now = revisionsOf(next)[surface];
      return now !== undefined && now > revision;
    });
    const kept = moved ? retains(old, name) : undefined;
    if (kept !== undefined) continue;
    const advice = moved
      ? `keep the previous revision published as its own bundle, unchanged, for ${DEPRECATION_MONTHS} months (D59)`
      : "within a revision, schemas change only additively; a breaking change needs a new revision (D32)";
    for (const item of breaks)
      problems.push(`${name} ${item.path}: ${item.reason}. To break it, ${advice}.`);
  }
  return problems;
}
