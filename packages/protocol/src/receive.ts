/**
 * Reading what a newer peer sends (HO-07, D32, #45). Within a revision a peer may add values to an
 * enum and members to a union: the wire schemas' evolution rule counts both as additive
 * (`tools/schemas/compat.ts`). A receiver checking such a message against the schemas it was built
 * with would refuse the whole message for one value it doesn't know, so it checks it against
 * {@link receivable}'s copy instead, as the Rust crate's wire types read an `Unknown` variant.
 */
import * as z from "zod";

/** A Zod node's definition, as far as {@link receivable} reads it. */
interface Def {
  readonly type: string;
  readonly [key: string]: unknown;
}

const opened = new WeakMap<z.ZodType, z.ZodType>();

/**
 * `schema` as a receiver of a newer peer's messages checks it: every string enum and every union
 * of string literals accepts any string; a discriminated union accepts, besides its members, an
 * object whose discriminator is a string none of them has, kept whole; objects drop unknown fields
 * rather than refuse them. Everything else (fields, types, required members, limits) is checked as
 * before, so a message a newer peer couldn't have sent still fails.
 *
 * The result keeps `schema`'s TypeScript type, the shape this side was built for: a value the type
 * doesn't name means a newer peer, and code that branches on such a field handles the other case
 * (a `default`), as it would for any value it can't act on.
 *
 * ```ts
 * const parsed = receivable(definition.result).safeParse(raw);
 * ```
 */
export function receivable<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return open(schema) as z.ZodType<T>;
}

function open(schema: z.ZodType): z.ZodType {
  const known = opened.get(schema);
  if (known) return known;
  const result = rebuild(schema);
  opened.set(schema, result);
  return result;
}

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

/** A copy of `schema` with some of its definition replaced; its checks and settings stay. */
function cloned(schema: z.ZodType, changes: Record<string, unknown>): z.ZodType {
  return (schema as unknown as { clone(def: Def): z.ZodType }).clone({
    ...defOf(schema),
    ...changes,
  });
}

/** The string values of a literal or enum node, or undefined when it has others. */
function strings(schema: z.ZodType): string[] | undefined {
  const def = defOf(schema);
  const values =
    def.type === "literal"
      ? (def["values"] as unknown[])
      : def.type === "enum"
        ? Object.values(def["entries"] as Record<string, unknown>)
        : undefined;
  return values?.every((value) => typeof value === "string") ? (values as string[]) : undefined;
}

function rebuild(schema: z.ZodType): z.ZodType {
  const def = defOf(schema);
  switch (def.type) {
    case "enum":
      return strings(schema) ? z.string() : schema;
    case "optional":
    case "nullable":
    case "readonly":
    case "default":
    case "prefault":
    case "nonoptional":
    case "catch":
      return cloned(schema, { innerType: open(def["innerType"] as z.ZodType) });
    case "array":
      return cloned(schema, { element: open(def["element"] as z.ZodType) });
    case "object": {
      const shape = def["shape"] as Record<string, z.ZodType>;
      return cloned(schema, {
        shape: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, open(value)])),
        // A strict object would refuse a field a newer peer adds; it is dropped instead.
        catchall: undefined,
      });
    }
    case "record":
      return cloned(schema, {
        keyType: open(def["keyType"] as z.ZodType),
        valueType: open(def["valueType"] as z.ZodType),
      });
    case "tuple":
      return cloned(schema, {
        items: (def["items"] as z.ZodType[]).map(open),
        rest: def["rest"] ? open(def["rest"] as z.ZodType) : def["rest"],
      });
    case "intersection":
      return cloned(schema, {
        left: open(def["left"] as z.ZodType),
        right: open(def["right"] as z.ZodType),
      });
    case "pipe":
      return cloned(schema, { in: open(def["in"] as z.ZodType) });
    case "lazy": {
      const getter = def["getter"] as () => z.ZodType;
      return z.lazy(() => open(getter()));
    }
    case "union":
      return union(def);
    default:
      return schema;
  }
}

function union(def: Def): z.ZodType {
  const options = def["options"] as z.ZodType[];
  // A union of string literals is an enum written another way.
  if (options.every((option) => strings(option) !== undefined)) return z.string();
  const members = options.map(open);
  const discriminator = def["discriminator"] as string | undefined;
  if (discriminator === undefined) return z.union(members as [z.ZodType, ...z.ZodType[]]);
  const tags = new Set<string>();
  for (const option of options) {
    const shape = defOf(option)["shape"] as Record<string, z.ZodType> | undefined;
    const tag = shape?.[discriminator];
    const values = tag ? strings(tag) : undefined;
    // A member whose tag isn't a string literal: no newer member can be told from a broken one.
    if (!values) return z.union(members as [z.ZodType, ...z.ZodType[]]);
    for (const value of values) tags.add(value);
  }
  const newer = z.looseObject({
    [discriminator]: z.string().refine((tag) => !tags.has(tag)),
  });
  const all: z.ZodType[] = [...members, newer];
  return z.union(all as [z.ZodType, ...z.ZodType[]]);
}
