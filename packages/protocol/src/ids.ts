/**
 * Prefixed, opaque identifiers (INTERFACES §1, DATA_MODEL §2).
 *
 * Every Mostra entity is named by a string of the form `<prefix>_<body>`. Callers treat IDs as
 * opaque: they validate the form at a boundary and never read meaning out of the body. Each ID
 * kind below is both a type and a value with the same name:
 *
 * ```ts
 * const artifact: ArtifactId = ArtifactId.parse(input);
 * const mutation: MutationId = MutationId.create();
 * const Params = z.object({ artifactId: ArtifactId.schema });
 * ```
 *
 * @packageDocumentation
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

/** The prefixes INTERFACES §1 assigns, one per entity. */
export type IdPrefix = "art" | "ver" | "vw" | "vwr" | "sub" | "run" | "thr" | "cmt" | "tok" | "mut";

/**
 * A branded ID string. The brand exists only at the type level, so an `Id<"art">` is a plain
 * string at run time and on the wire.
 */
export type Id<P extends IdPrefix> = `${P}_${string}` & { readonly __mostraIdPrefix: P };

/** How an ID kind's body is formed. */
export type IdBody = "ulid" | "sha256-base32";

/** One ID kind: its prefix, validation and schema. */
export interface IdKind<P extends IdPrefix> {
  /** The prefix, without the underscore. */
  readonly prefix: P;
  /** The entity the ID names, in the PRODUCT vocabulary. */
  readonly entity: string;
  /** How the body is formed. */
  readonly body: IdBody;
  /** The exact form, anchored at both ends. */
  readonly pattern: RegExp;
  /** The Zod schema for this ID, registered for JSON Schema output under the kind's type name. */
  readonly schema: z.ZodType<Id<P>, string>;
  /** Whether `value` is an ID of this kind. */
  is(value: unknown): value is Id<P>;
  /**
   * Returns `value` as an ID of this kind.
   *
   * @throws TypeError when `value` is not of this kind's form. The message names the expected
   *   form and never echoes the input.
   */
  parse(value: string): Id<P>;
}

/** An ID kind whose body is a ULID that the creator generates. */
export interface GeneratedIdKind<P extends IdPrefix> extends IdKind<P> {
  /** Generates a new ID from the current time and 80 bits of Web Crypto randomness. */
  create(): Id<P>;
}

/** Crockford's base32 alphabet, used by ULIDs and by content-addressed version IDs. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 26;
/** A ULID's first character encodes at most 3 bits (48-bit time in 26 × 5 = 130 bits). */
const ULID_BODY = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
const BASE32_BODY = "[0-9A-HJKMNP-TV-Z]{26}";

function defineKind<P extends IdPrefix>(
  prefix: P,
  entity: string,
  body: IdBody,
  typeName: string,
): IdKind<P> {
  const pattern = new RegExp(`^${prefix}_${body === "ulid" ? ULID_BODY : BASE32_BODY}$`);
  const form = body === "ulid" ? "a 26-character ULID" : "26 characters of Crockford base32";
  const is = (value: unknown): value is Id<P> => typeof value === "string" && pattern.test(value);
  const schema = z
    .string()
    .regex(pattern)
    .register(wireRegistry, {
      id: typeName,
      description: `${entity[0]?.toUpperCase()}${entity.slice(1)} ID: "${prefix}_" followed by ${form}.`,
    }) as unknown as z.ZodType<Id<P>, string>;
  return {
    prefix,
    entity,
    body,
    pattern,
    schema,
    is,
    parse(value: string): Id<P> {
      if (is(value)) return value;
      throw new TypeError(`Expected ${entity} ID "${prefix}_" followed by ${form}.`);
    },
  };
}

function generated<P extends IdPrefix>(kind: IdKind<P>): GeneratedIdKind<P> {
  return { ...kind, create: () => kind.parse(`${kind.prefix}_${ulidBody(Date.now())}`) };
}

/**
 * Encodes a ULID body: 48 bits of milliseconds since the Unix epoch, then 80 random bits, as 26
 * Crockford base32 characters.
 */
function ulidBody(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError("ULID time must be a millisecond timestamp between 0 and 2^48 - 1.");
  }
  let time = "";
  let rest = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);
  return time + base32(random).slice(0, 16);
}

/** Encodes bytes as Crockford base32, most significant bit first, padding the last group with 0. */
function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD.charAt((buffer << (5 - bits)) & 31);
  return out;
}

/** An artifact ID (`art_` + ULID). */
export type ArtifactId = Id<"art">;
/** Artifact IDs. */
export const ArtifactId: GeneratedIdKind<"art"> = generated(
  defineKind("art", "artifact", "ulid", "ArtifactId"),
);

/** A version ID (`ver_` + 26 characters of base32 SHA-256): content-addressed, never generated. */
export type VersionId = Id<"ver">;
/** The version ID kind, with the content-addressed constructor DATA_MODEL §2 defines. */
export interface VersionIdKind extends IdKind<"ver"> {
  /**
   * Returns the version ID for a SHA-256 digest: `ver_` plus the first 26 characters of the
   * digest in Crockford base32 (130 bits). The caller computes the digest of the artifact ID's
   * UTF-8 bytes, a `0x00` byte, and the 32-byte `sourceDigest` and `envDigest` (DATA_MODEL §2,
   * D89).
   *
   * @throws RangeError when `digest` is not 32 bytes long.
   */
  fromSha256(digest: Uint8Array): VersionId;
}
/** Version IDs. */
export const VersionId: VersionIdKind = {
  ...defineKind("ver", "version", "sha256-base32", "VersionId"),
  fromSha256(digest: Uint8Array): VersionId {
    if (digest.length !== 32) {
      throw new RangeError(`A SHA-256 digest is 32 bytes, got ${digest.length}.`);
    }
    return VersionId.parse(`ver_${base32(digest).slice(0, BODY_LENGTH)}`);
  },
};

/** A view ID (`vw_` + ULID). */
export type ViewId = Id<"vw">;
/** View IDs. */
export const ViewId: GeneratedIdKind<"vw"> = generated(defineKind("vw", "view", "ulid", "ViewId"));

/** A viewer ID (`vwr_` + ULID). */
export type ViewerId = Id<"vwr">;
/** Viewer IDs. */
export const ViewerId: GeneratedIdKind<"vwr"> = generated(
  defineKind("vwr", "viewer", "ulid", "ViewerId"),
);

/** A submission ID (`sub_` + ULID). */
export type SubmissionId = Id<"sub">;
/** Submission IDs. */
export const SubmissionId: GeneratedIdKind<"sub"> = generated(
  defineKind("sub", "submission", "ulid", "SubmissionId"),
);

/** An action run ID (`run_` + ULID). */
export type RunId = Id<"run">;
/** Action run IDs. */
export const RunId: GeneratedIdKind<"run"> = generated(
  defineKind("run", "action run", "ulid", "RunId"),
);

/** A review thread ID (`thr_` + ULID). */
export type ThreadId = Id<"thr">;
/** Review thread IDs. */
export const ThreadId: GeneratedIdKind<"thr"> = generated(
  defineKind("thr", "thread", "ulid", "ThreadId"),
);

/** A comment ID (`cmt_` + ULID). */
export type CommentId = Id<"cmt">;
/** Comment IDs. */
export const CommentId: GeneratedIdKind<"cmt"> = generated(
  defineKind("cmt", "comment", "ulid", "CommentId"),
);

/** A capability token ID (`tok_` + ULID). The token's secret is separate and never an ID. */
export type TokenId = Id<"tok">;
/** Capability token IDs. */
export const TokenId: GeneratedIdKind<"tok"> = generated(
  defineKind("tok", "capability token", "ulid", "TokenId"),
);

/** A mutation ID (`mut_` + ULID), generated by the client that sends the mutation. */
export type MutationId = Id<"mut">;
/** Mutation IDs. */
export const MutationId: GeneratedIdKind<"mut"> = generated(
  defineKind("mut", "mutation", "ulid", "MutationId"),
);

/**
 * An event cursor: the decimal string of a home-wide event position (INTERFACES §1). Decimal
 * strings keep 64-bit positions exact in JavaScript.
 */
export type Cursor = string & { readonly __mostraCursor: true };

/** Event cursors. */
export const Cursor: {
  /** The exact form: a non-negative decimal integer without leading zeros, at most 19 digits. */
  readonly pattern: RegExp;
  readonly schema: z.ZodType<Cursor, string>;
  is(value: unknown): value is Cursor;
  /** @throws TypeError when `value` is not a cursor. */
  parse(value: string): Cursor;
  /** Orders two cursors: negative when `a` comes first, zero when equal, positive otherwise. */
  compare(a: Cursor, b: Cursor): number;
} = (() => {
  const pattern = /^(0|[1-9][0-9]{0,18})$/;
  const is = (value: unknown): value is Cursor => typeof value === "string" && pattern.test(value);
  return {
    pattern,
    schema: z.string().regex(pattern).register(wireRegistry, {
      id: "Cursor",
      description: "Event cursor: the decimal string of a home-wide event position.",
    }) as unknown as z.ZodType<Cursor, string>,
    is,
    parse(value: string): Cursor {
      if (is(value)) return value;
      throw new TypeError("Expected an event cursor: a non-negative decimal integer string.");
    },
    compare(a: Cursor, b: Cursor): number {
      return a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length;
    },
  };
})();
