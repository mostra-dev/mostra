/**
 * Identity and digests (DATA_MODEL §2, D77, D89, VR-01): what changes a version ID and what
 * doesn't, with known answers so the algorithm can never drift unnoticed.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  environmentDigest,
  listingDigest,
  sha256Hex,
  versionIdFor,
} from "../../src/publish/index.ts";

const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const file = (path: string, text: string, executable = false) => ({
  path,
  executable,
  sha256: sha256Hex(text),
});
const tree = [file("index.tsx", "export default 1;\n"), file("data/a.json", "[1]\n")];
const environment = {
  mostraVersion: "0.1.0",
  kitVersion: null,
  kitBase: "base" as const,
  mode: "spa" as const,
  lockDigest: sha256Hex("lock"),
  buildConfigDigest: sha256Hex("config"),
  browserProtocolRevision: null,
};

describe("canonical JSON (RFC 8785 subset)", () => {
  it("sorts keys at every depth, drops whitespace and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: "x" }, e: null })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1,"e":null}',
    );
  });

  it("refuses values JSON can't represent exactly", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });
});

describe("sourceDigest (DATA_MODEL §2)", () => {
  it("doesn't depend on the order files are listed in", () => {
    expect(listingDigest([...tree].reverse())).toBe(listingDigest(tree));
  });

  it("changes with a byte, a rename, an added file or an execute bit", () => {
    const base = listingDigest(tree);
    const variants = [
      [file("index.tsx", "export default 2;\n"), tree[1]],
      [file("main.tsx", "export default 1;\n"), tree[1]],
      [...tree, file("extra.txt", "")],
      [file("index.tsx", "export default 1;\n", true), tree[1]],
    ];
    const digests = variants.map((variant) => listingDigest(variant as typeof tree));
    expect(new Set([base, ...digests]).size).toBe(variants.length + 1);
  });

  it("orders by UTF-8 bytes, so every platform lists the same way", () => {
    const upper = [file("Z.txt", "z"), file("a.txt", "a"), file("é.txt", "e")];
    expect(listingDigest(upper)).toBe(
      listingDigest([upper[2], upper[0], upper[1]] as typeof upper),
    );
  });
});

describe("envDigest (DATA_MODEL §2)", () => {
  it("changes with every field: Mostra and kit versions, base, lockfile, build config, browser protocol", () => {
    const base = environmentDigest(environment);
    const changed = [
      { ...environment, mostraVersion: "0.1.1" },
      { ...environment, kitVersion: "1.0.0" },
      { ...environment, kitBase: "radix" as const },
      { ...environment, lockDigest: sha256Hex("lock 2") },
      { ...environment, buildConfigDigest: sha256Hex("config 2") },
      { ...environment, browserProtocolRevision: "2026-11-01" },
    ].map(environmentDigest);
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });
});

describe("versionId (D77, D89)", () => {
  const source = listingDigest(tree);
  const env = environmentDigest(environment);

  it("is the same for the same artifact, source and environment", () => {
    expect(versionIdFor(ARTIFACT, source, env)).toBe(versionIdFor(ARTIFACT, source, env));
    expect(versionIdFor(ARTIFACT, source, env)).toMatch(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("differs per artifact, source and environment", () => {
    const ids = [
      versionIdFor(ARTIFACT, source, env),
      versionIdFor("art_01JB8Z3QF6S7W3N8D5K2C4V9XH", source, env),
      versionIdFor(ARTIFACT, sha256Hex("other source"), env),
      versionIdFor(ARTIFACT, source, sha256Hex("other environment")),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches known answers, so the algorithm can't change silently", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(listingDigest([file("index.tsx", "x")])).toBe(
      sha256Hex(JSON.stringify([["index.tsx", false, sha256Hex("x")]])),
    );
    // SHA-256(utf8(artifactId) ‖ 0x00 ‖ 32 bytes 0x00 ‖ 32 bytes 0x11), first 26 Crockford base32
    // characters, computed independently with Python's hashlib.
    expect(versionIdFor(ARTIFACT, "00".repeat(32), "11".repeat(32))).toBe(
      "ver_3T0TFK1HSCJYFCBGJV074X6DBA",
    );
  });
});
