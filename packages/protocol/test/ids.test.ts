import {
  ArtifactId,
  CommentId,
  Cursor,
  DeliveryId,
  MutationId,
  RunId,
  SubmissionId,
  ThreadId,
  TokenId,
  VersionId,
  ViewerId,
  ViewId,
} from "@mostra/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const generatedKinds = [
  ArtifactId,
  ViewId,
  ViewerId,
  SubmissionId,
  DeliveryId,
  RunId,
  ThreadId,
  CommentId,
  TokenId,
  MutationId,
];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("ID kinds", () => {
  it("cover every prefix in INTERFACES §1, each once", () => {
    const prefixes = [...generatedKinds, VersionId].map((kind) => kind.prefix).sort();
    expect(prefixes).toEqual([
      "art",
      "cmt",
      "dlv",
      "mut",
      "run",
      "sub",
      "thr",
      "tok",
      "ver",
      "vw",
      "vwr",
    ]);
  });

  it.each(generatedKinds)(
    "$prefix: create() yields IDs that parse, validate and are unique",
    (kind) => {
      const ids = new Set(Array.from({ length: 500 }, () => kind.create()));
      expect(ids.size).toBe(500);
      for (const id of ids) {
        expect(kind.is(id)).toBe(true);
        expect(kind.parse(id)).toBe(id);
        expect(kind.schema.parse(id)).toBe(id);
        expect(id).toMatch(new RegExp(`^${kind.prefix}_[0-7][${CROCKFORD}]{25}$`));
      }
    },
  );

  it("ULID bodies sort by creation time", async () => {
    const first = ArtifactId.create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = ArtifactId.create();
    expect(first.slice(4, 14) < second.slice(4, 14)).toBe(true);
  });

  it("reject other prefixes, lowercase, excluded letters, wrong lengths and non-strings", () => {
    const body = "01J9ZQ3W4X5Y6Z7A8B9C0D1E2F";
    expect(ArtifactId.is(`art_${body}`)).toBe(true);
    for (const bad of [
      `ver_${body}`,
      `art_${body.toLowerCase()}`,
      `art_${body.slice(1)}`,
      `art_${body}0`,
      `art_8${body.slice(1)}`,
      `art_${body.slice(0, 25)}I`,
      `art_${body.slice(0, 25)}L`,
      `art_${body.slice(0, 25)}O`,
      `art_${body.slice(0, 25)}U`,
      ` art_${body}`,
      `art-${body}`,
      42,
      undefined,
    ]) {
      expect(ArtifactId.is(bad)).toBe(false);
    }
  });

  it("parse throws a TypeError that names the form and never echoes the input", () => {
    const secretish = "art_this-is-not-an-id-but-might-be-a-secret";
    expect(() => ArtifactId.parse(secretish)).toThrow(TypeError);
    expect(() => ArtifactId.parse(secretish)).toThrow(
      /artifact ID "art_" followed by a 26-character ULID/,
    );
    try {
      ArtifactId.parse(secretish);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });

  it("schema rejects malformed IDs at a Zod boundary", () => {
    expect(ArtifactId.schema.safeParse("art_nope").success).toBe(false);
    expect(ArtifactId.schema.safeParse(7).success).toBe(false);
  });
});

describe("VersionId", () => {
  it("has no generator: versions are content-addressed", () => {
    expect("create" in VersionId).toBe(false);
  });

  it("encodes the first 130 bits of a SHA-256 digest in Crockford base32", async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")),
    );
    // Independent vector: RFC 4648 base32 of the digest, mapped onto Crockford's alphabet.
    const id = VersionId.fromSha256(digest);
    expect(id).toBe("ver_Q9W1DFWF077YMGA183F5VBH24E");
    expect(VersionId.is(id)).toBe(true);
    expect(VersionId.fromSha256(digest)).toBe(id);
  });

  it("is a pure function of the digest and differs when any bit in the first 130 differs", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.nat(129), (bytes, bit) => {
        const flipped = bytes.slice();
        const index = Math.floor(bit / 8);
        flipped[index] = (flipped[index] ?? 0) ^ (0x80 >> (bit % 8));
        expect(VersionId.fromSha256(bytes)).toBe(VersionId.fromSha256(bytes.slice()));
        expect(VersionId.fromSha256(flipped)).not.toBe(VersionId.fromSha256(bytes));
      }),
    );
  });

  it("rejects digests that are not 32 bytes", () => {
    expect(() => VersionId.fromSha256(new Uint8Array(31))).toThrow(RangeError);
  });
});

describe("Cursor", () => {
  it("accepts non-negative decimal strings without leading zeros", () => {
    for (const good of ["0", "1", "42", "9223372036854775807"]) expect(Cursor.is(good)).toBe(true);
    for (const bad of ["", "-1", "01", "1.5", "1e3", " 1", "12345678901234567890", 1]) {
      expect(Cursor.is(bad)).toBe(false);
    }
  });

  it("orders cursors numerically, beyond the safe-integer range", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
        fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
        (a, b) => {
          const order = Math.sign(
            Cursor.compare(Cursor.parse(a.toString()), Cursor.parse(b.toString())),
          );
          expect(order).toBe(a < b ? -1 : a > b ? 1 : 0);
        },
      ),
    );
  });
});
