#!/usr/bin/env node
/**
 * Pins the private Node.js every runtime bundle ships (D18, D48, D142 item 1): the SHA-256 of each
 * platform's official archive, taken from the release's `SHASUMS256.txt` only once its signature
 * checks out against the Node.js release keys. `packages/bundle/scripts/build.ts` then refuses any
 * archive whose bytes differ. Playbook: docs/agents/update-node.md.
 *
 *   node tools/release/node-pins.ts <version>   verifies and writes packages/bundle/node.json
 *   node tools/release/node-pins.ts --check     verifies the version node.json names, and fails
 *                                               when a pin differs from the signed list
 *
 * The keys are `gpg-only-active-keys/pubring.kbx` of github.com/nodejs/release-keys at a pinned
 * commit (`--keys <commit>` overrides it), so a new release key is a reviewed change here, never a
 * silent one; `gpgv` (GnuPG) checks the signature. Node.js built-ins and `gpgv` only.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PINS = join(ROOT, "packages", "bundle", "node.json");

/** nodejs/release-keys at 2026-09-01 ("keyring: update expiry for RafaelGSS key (#59)"). */
const RELEASE_KEYS_COMMIT = "481637f813e912c4aa3622d7964ab426c97b8e8d";

/** The bundle platforms and the archive Node.js publishes for each (build.ts's names). */
export const ARCHIVES: Readonly<Record<string, (version: string) => string>> = {
  "darwin-arm64": (v) => `node-v${v}-darwin-arm64.tar.gz`,
  "darwin-x64": (v) => `node-v${v}-darwin-x64.tar.gz`,
  "linux-arm64": (v) => `node-v${v}-linux-arm64.tar.gz`,
  "linux-x64": (v) => `node-v${v}-linux-x64.tar.gz`,
  "win32-x64": (v) => `node-v${v}-win-x64.zip`,
  "win32-arm64": (v) => `node-v${v}-win-arm64.zip`,
};

const COMMENT =
  "The private Node.js every runtime bundle ships (D18, D48, RT-01): the official distribution (the `win-<arch>.zip` archives for Windows), checked against these SHA-256s from nodejs.org/dist/v<version>/SHASUMS256.txt, whose signature was verified with the Node.js release keys. Written by tools/release/node-pins.ts; moving to another version: docs/agents/update-node.md.";

/** The archives' SHA-256s in a signed list's text, or what the list lacks. */
export function pinsFrom(
  signed: string,
  version: string,
): { readonly archives: Record<string, string> } | { readonly missing: string[] } {
  const listed = new Map<string, string>();
  for (const line of signed.split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line.trim());
    if (match) listed.set(match[2] as string, match[1] as string);
  }
  const archives: Record<string, string> = {};
  const missing: string[] = [];
  for (const [platform, name] of Object.entries(ARCHIVES)) {
    const sha = listed.get(name(version));
    if (sha) archives[platform] = sha;
    else missing.push(name(version));
  }
  return missing.length > 0 ? { missing } : { archives };
}

/** The fingerprint `gpgv --status-fd` reports a good signature from, if it does. */
export function signerOf(status: string): string | undefined {
  // VALIDSIG <fingerprint> <date> … <primary key fingerprint>: a good signature by a key in the
  // keyring (GnuPG's doc/DETAILS); the primary key's fingerprint is the last field.
  const valid = /^\[GNUPG:\] VALIDSIG ([0-9A-F]{40,64}) .* ([0-9A-F]{40,64})$/m.exec(status);
  if (!valid || !/^\[GNUPG:\] GOODSIG /m.test(status)) return undefined;
  return valid[2];
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetches the release's SHA-256 list and its detached signature, and verifies that exact file:
 * the text returned is the bytes `gpgv` judged (GnuPG 2.5's `--output` left its file as `.part`).
 */
async function signedList(
  version: string,
  keys: string,
): Promise<{ readonly text: string; readonly signer: string }> {
  const dir = mkdtempSync(join(tmpdir(), "mostra-node-pins-"));
  try {
    const list = join(dir, "SHASUMS256.txt");
    const signature = join(dir, "SHASUMS256.txt.sig");
    const keyring = join(dir, "pubring.kbx");
    const base = `https://nodejs.org/dist/v${version}`;
    const bytes = await fetchBytes(`${base}/SHASUMS256.txt`);
    writeFileSync(list, bytes);
    writeFileSync(signature, await fetchBytes(`${base}/SHASUMS256.txt.sig`));
    writeFileSync(
      keyring,
      await fetchBytes(
        `https://raw.githubusercontent.com/nodejs/release-keys/${keys}/gpg-only-active-keys/pubring.kbx`,
      ),
    );
    const run = spawnSync("gpgv", ["--status-fd", "1", "--keyring", keyring, signature, list], {
      encoding: "utf8",
    });
    if (run.error) throw new Error(`gpgv couldn't run (${run.error.message}); install GnuPG`);
    const signer = signerOf(run.stdout ?? "");
    if (run.status !== 0 || !signer) {
      throw new Error(
        `the signature of v${version}'s SHASUMS256.txt doesn't verify against the release keys at ${keys}:\n${(run.stderr ?? "").trim()}`,
      );
    }
    return { text: bytes.toString("utf8"), signer };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { check: { type: "boolean" }, keys: { type: "string" } },
  });
  const keys = values.keys ?? RELEASE_KEYS_COMMIT;
  const current = JSON.parse(readFileSync(PINS, "utf8")) as {
    version: string;
    archives: Record<string, string>;
  };
  const version = values.check ? current.version : positionals[0];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || positionals.length > (values.check ? 0 : 1)) {
    console.error("usage: node tools/release/node-pins.ts <version> | --check [--keys <commit>]");
    return 2;
  }
  const { text, signer } = await signedList(version, keys);
  const pins = pinsFrom(text, version);
  if ("missing" in pins) {
    console.error(`v${version}'s signed list has no ${pins.missing.join(", ")}`);
    return 1;
  }
  if (values.check) {
    const differ = Object.keys(ARCHIVES).filter(
      (platform) => current.archives[platform] !== pins.archives[platform],
    );
    if (differ.length > 0) {
      console.error(
        `packages/bundle/node.json differs from v${version}'s signed list: ${differ.join(", ")}`,
      );
      return 1;
    }
    console.log(`node.json matches v${version}, signed by ${signer}`);
    return 0;
  }
  writeFileSync(
    PINS,
    `${JSON.stringify({ $comment: COMMENT, version, archives: pins.archives }, null, 2)}\n`,
  );
  console.log(`node.json pins v${version}, its SHASUMS256.txt signed by ${signer}`);
  for (const [platform, sha] of Object.entries(pins.archives)) console.log(`  ${platform} ${sha}`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error((error as Error).message);
      process.exit(1);
    },
  );
}
