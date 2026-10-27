/**
 * The bundle's Node.js pins (tools/release/node-pins.ts, D142 item 1): pins come only from a list
 * `gpgv` judged good, and a list missing a platform's archive pins nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromRoot } from "../lib/repo.ts";
import { ARCHIVES, pinsFrom, signerOf } from "../release/node-pins.ts";

const sha = (n: number): string => n.toString(16).padStart(64, "0");
const list = (version: string, skip?: string): string =>
  [
    `${sha(1)}  node-v${version}-aix-ppc64.tar.gz`,
    ...Object.values(ARCHIVES)
      .map((name, i) => [name(version), i] as const)
      .filter(([name]) => name !== skip)
      .map(([name, i]) => `${sha(i + 10)}  ${name}`),
    `${sha(99)}  node-v${version}-headers.tar.gz`,
  ].join("\n");

describe("the bundle's Node.js pins (D142 item 1)", () => {
  it("pins the Node.js development runs on (.node-version), so the bundle ships what CI tested (D155 item 5)", () => {
    // Renovate updates .node-version alone; this fails its pull request until the pins follow
    // (docs/agents/update-node.md; the Opus review of MT-02).
    const developed = readFileSync(fromRoot(".node-version"), "utf8").trim();
    const shipped = (
      JSON.parse(readFileSync(fromRoot("packages/bundle/node.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(
      shipped,
      `.node-version is ${developed}, the bundle pins ${shipped}: run node tools/release/node-pins.ts ${developed}`,
    ).toBe(developed);
  });

  it("pins every bundle platform's archive from the signed list, and nothing else", () => {
    const pins = pinsFrom(list("24.22.1"), "24.22.1");
    expect(pins).toEqual({
      archives: {
        "darwin-arm64": sha(10),
        "darwin-x64": sha(11),
        "linux-arm64": sha(12),
        "linux-x64": sha(13),
        "win32-x64": sha(14),
        "win32-arm64": sha(15),
      },
    });
  });

  it("pins nothing when the list lacks an archive, or names another version", () => {
    expect(pinsFrom(list("24.22.1", "node-v24.22.1-win-arm64.zip"), "24.22.1")).toEqual({
      missing: ["node-v24.22.1-win-arm64.zip"],
    });
    expect("missing" in pinsFrom(list("24.22.0"), "24.22.1")).toBe(true);
  });

  it("takes a signer only from a good, valid signature", () => {
    const fingerprint = "5BE8A3F6C8A5C01D106C0AD820B1A390B168D356";
    const good = [
      "[GNUPG:] NEWSIG",
      "[GNUPG:] GOODSIG 20B1A390B168D356 Antoine du Hamel <antoine.duhamel@platformatic.dev>",
      `[GNUPG:] VALIDSIG ${fingerprint} 2026-09-08 1788904155 0 4 0 22 8 01 ${fingerprint}`,
    ].join("\n");
    expect(signerOf(good)).toBe(fingerprint);
    // A tampered list: the signature doesn't match its bytes.
    expect(
      signerOf("[GNUPG:] NEWSIG\n[GNUPG:] BADSIG 20B1A390B168D356 Antoine du Hamel <a@b>"),
    ).toBeUndefined();
    // A key that isn't in the release keyring.
    expect(
      signerOf("[GNUPG:] NEWSIG\n[GNUPG:] ERRSIG 20B1A390B168D356 22 8 01 1788904155 9 -"),
    ).toBeUndefined();
    // VALIDSIG alone, or GOODSIG alone, is not enough.
    expect(signerOf(good.replace(/^.*GOODSIG.*$/m, ""))).toBeUndefined();
    expect(signerOf(good.replace(/^.*VALIDSIG.*$/m, ""))).toBeUndefined();
  });
});
