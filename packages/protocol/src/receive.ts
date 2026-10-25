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
 * of string literals accepts any string (an enum's own checks still run, and an enum-keyed record
 * still needs every key it names); a discriminated union accepts, besides its members, an object
 * whose discriminator is a string none of them has, kept whole; strict objects drop unknown fields
 * rather than refuse them. Everything else (fields, types, required members, limits) is checked as
 * before, so a message a newer peer couldn't have sent still fails, and a message `schema` accepts
 * reads exactly as `schema` reads it: a union tries its members as built before their opened
 * copies, and a discriminated union's members keep their own tags.
 *
 * The result keeps `schema`'s TypeScript type, the shape this side was built for: a value the type
 * doesn't name means a newer peer. Code that branches on such a field handles the other case, and
 * a gate (a verdict, a check, a delivery) passes only on a value it knows means passing, never on
 * the absence of the one it knows means failing.
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
  // A recursive schema (Zod's getter idiom) reaches itself while it is being opened: it finds this
  // stand-in, which reads the finished copy when a message is checked (Opus review of MT-01, 7).
  let result: z.ZodType | undefined;
  opened.set(
    schema,
    z.lazy(() => result ?? schema),
  );
  result = rebuild(schema);
  opened.set(schema, result);
  return result;
}

/** Any string, with the checks `schema` carries (an enum's `.refine`, say). */
function anyString(schema: z.ZodType): z.ZodType {
  const checks = defOf(schema)["checks"] as unknown[] | undefined;
  return checks?.length ? cloned(z.string(), { checks }) : z.string();
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
      return strings(schema) ? anyString(schema) : schema;
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
      const catchall = def["catchall"] as z.ZodType | undefined;
      return cloned(schema, {
        shape: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, open(value)])),
        // A strict object (catchall `never`) would refuse a field a newer peer adds: it is dropped
        // instead. A loose object keeps passing its fields through, and a typed catchall keeps
        // checking them (GPT review of MT-01: the bridge's host context passes fields through).
        catchall:
          catchall === undefined || defOf(catchall).type === "never" ? undefined : open(catchall),
      });
    }
    case "record": {
      const keyType = def["keyType"] as z.ZodType;
      // Keys from an enum: every one it names is still required, and a key a newer peer adds
      // passes through, as Zod's loose records do (Opus review of MT-01, 2).
      if (strings(keyType) && !def["partial"]) {
        return cloned(schema, { valueType: open(def["valueType"] as z.ZodType), mode: "loose" });
      }
      return cloned(schema, {
        keyType: open(keyType),
        valueType: open(def["valueType"] as z.ZodType),
      });
    }
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
      return union(schema, def);
    default:
      return schema;
  }
}

function union(schema: z.ZodType, def: Def): z.ZodType {
  const options = def["options"] as z.ZodType[];
  // A union of string literals is an enum written another way.
  if (options.every((option) => strings(option) !== undefined)) return anyString(schema);
  // The members as built come first, so whatever they accept reads as before; their opened copies
  // only take what none of them does (Opus review of MT-01, 1).
  const anyOf = (members: z.ZodType[]): z.ZodType =>
    z.union([...options, ...members] as [z.ZodType, ...z.ZodType[]]);
  const discriminator = def["discriminator"] as string | undefined;
  if (discriminator === undefined) return anyOf(options.map(open));
  const tags = new Set<string>();
  const members: z.ZodType[] = [];
  for (const option of options) {
    const shape = defOf(option)["shape"] as Record<string, z.ZodType> | undefined;
    const tag = shape?.[discriminator];
    const values = tag ? strings(tag) : undefined;
    // A member whose tag isn't a string literal: no newer member can be told from a broken one.
    if (!tag || !values) return anyOf(options.map(open));
    for (const value of values) tags.add(value);
    // An opened member keeps its own tag: widened, an enum tag would take every member's messages.
    const member = open(option);
    const memberShape = defOf(member)["shape"] as Record<string, z.ZodType>;
    members.push(cloned(member, { shape: { ...memberShape, [discriminator]: tag } }));
  }
  const newer = z.looseObject({
    [discriminator]: z.string().refine((value) => !tags.has(value)),
  });
  return anyOf([...members, newer]);
}
