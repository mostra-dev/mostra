/**
 * The bundle extractor (src/bundle/extract.ts, RT-01, #88) against archives built byte by byte:
 * what a bundle holds comes out exactly, and every entry a bundle never has is refused as the
 * archive's fault, with nothing written outside the directory and no write through a link.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { RpcError } from "@mostra/protocol";
import { afterAll, describe, expect, it } from "vitest";
import { entryParts, extractBundle } from "../../src/bundle/extract.ts";
import { tempDir } from "../support.ts";

const WINDOWS = process.platform === "win32";
const TOP = "mostra-0.0.0-test";

interface Entry {
  readonly name: string;
  /** `0` a file, `1` a hard link, `2` a link, `3` a character device, `5` a directory, `6` a FIFO. */
  readonly type?: string;
  readonly body?: string;
  readonly mode?: number;
  readonly link?: string;
}

/** One ustar header block. */
function header(entry: Entry, size: number): Buffer {
  const block = Buffer.alloc(512);
  const put = (at: number, length: number, value: string): void => {
    block.write(value.slice(0, length), at, "utf8");
  };
  const octal = (at: number, length: number, value: number): void => {
    put(at, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
  };
  put(0, 100, entry.name);
  octal(100, 8, entry.mode ?? (entry.type === "5" ? 0o755 : 0o644));
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 1_700_000_000);
  block.fill(0x20, 148, 156);
  put(156, 1, entry.type ?? "0");
  put(157, 100, entry.link ?? "");
  put(257, 6, "ustar\0");
  put(263, 2, "00");
  let sum = 0;
  for (const byte of block) sum += byte;
  put(148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

function archive(entries: readonly Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    blocks.push(header(entry, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const dir = tempDir("msdk-extract");
afterAll(() => dir.cleanup());
let round = 0;

async function extract(entries: readonly Entry[], links: "keep" | "refuse" = "keep") {
  round += 1;
  const file = join(dir.path, `a${round}.tar.gz`);
  writeFileSync(file, archive(entries));
  const into = join(dir.path, `out${round}`, "root");
  mkdirSync(into, { recursive: true });
  const error = await extractBundle(file, into, TOP, { links }).then(
    () => undefined,
    (caught: RpcError) => caught,
  );
  return { into, error, outside: join(dir.path, `out${round}`) };
}

describe("the bundle extractor (RT-01, #88)", () => {
  it("writes every file, directory and link a bundle holds, whatever their order", async () => {
    const long = `${"deep/".repeat(8)}name.js`;
    const { into, error } = await extract([
      { name: `${TOP}/`, type: "5" },
      // A file before its directory's own entry.
      { name: `${TOP}/lib/index.js`, body: "export {};\n" },
      { name: `${TOP}/lib/`, type: "5" },
      { name: `${TOP}/bin/mostra`, body: "#!/bin/sh\n", mode: 0o755 },
      { name: `${TOP}/${long}`, body: "x" },
      ...(WINDOWS ? [] : [{ name: `${TOP}/lib/current`, type: "2", link: "index.js" }]),
      { name: `${TOP}/empty/`, type: "5" },
    ]);
    expect(error).toBeUndefined();
    expect(readFileSync(join(into, "lib/index.js"), "utf8")).toBe("export {};\n");
    expect(readFileSync(join(into, long), "utf8")).toBe("x");
    expect(lstatSync(join(into, "empty")).isDirectory()).toBe(true);
    if (!WINDOWS) {
      expect(lstatSync(join(into, "bin/mostra")).mode & 0o100).toBe(0o100);
      expect(lstatSync(join(into, "lib/index.js")).mode & 0o111).toBe(0);
      expect(readlinkSync(join(into, "lib/current"))).toBe("index.js");
    }
  });

  it.each([
    ["a parent directory", `${TOP}/../escaped.txt`, "isn't a plain relative one"],
    [
      "a path outside the bundle's directory",
      "elsewhere/escaped.txt",
      "outside the bundle's directory",
    ],
    ["an absolute path", "/tmp/escaped.txt", "outside the bundle's directory"],
    ["a dot", `${TOP}/./x.txt`, "isn't a plain relative one"],
    ["an empty part", `${TOP}/a//x.txt`, "isn't a plain relative one"],
    // node-tar reads a backslash as a separator on Windows, where the `..` then refuses it.
    [
      "a backslash",
      `${TOP}/a\\..\\..\\x.txt`,
      WINDOWS ? "isn't a plain relative one" : "a character",
    ],
  ])("refuses %s, writing nothing outside", async (_what, name, why) => {
    const { error, outside } = await extract([
      { name: `${TOP}/`, type: "5" },
      { name, body: "escaped" },
    ]);
    expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(error?.diagnostic.message).toContain(why);
    expect(existsSync(join(outside, "escaped.txt"))).toBe(false);
    expect(existsSync(join(dir.path, "escaped.txt"))).toBe(false);
  });

  it.each([
    ["a hard link", "1"],
    ["a character device", "3"],
    ["a FIFO", "6"],
  ])("refuses %s", async (_what, type) => {
    const { error } = await extract([
      { name: `${TOP}/`, type: "5" },
      { name: `${TOP}/odd`, type, link: type === "1" ? `${TOP}/a` : "" },
    ]);
    expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(error?.diagnostic.message).toContain("only files, directories and links");
  });

  it("refuses a path that appears twice, so nothing is written over", async () => {
    const { into, error } = await extract([
      { name: `${TOP}/a.txt`, body: "first" },
      { name: `${TOP}/a.txt`, body: "second" },
    ]);
    expect(error?.diagnostic.message).toContain("appears twice");
    expect(readFileSync(join(into, "a.txt"), "utf8")).toBe("first");
  });

  it.skipIf(process.platform !== "darwin" && !WINDOWS)(
    "refuses two names the file system keeps as one (case, Unicode normalization)",
    async () => {
      for (const [first, second] of [
        ["Readme.md", "README.md"],
        ["caf\u00e9.txt", "cafe\u0301.txt"],
      ]) {
        const { error } = await extract([
          { name: `${TOP}/${first}`, body: "first" },
          { name: `${TOP}/${second}`, body: "second" },
        ]);
        expect(error?.diagnostic.message).toContain("appears twice");
      }
    },
  );

  it.skipIf(WINDOWS)(
    "never writes through a link, made last, nor makes one over a directory",
    async () => {
      const target = join(dir.path, "target");
      mkdirSync(target, { recursive: true });
      const { error } = await extract([
        { name: `${TOP}/lib`, type: "2", link: target },
        { name: `${TOP}/lib/planted.txt`, body: "through the link" },
      ]);
      expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
      expect(error?.diagnostic.message).toContain("other entries are inside it");
      expect(existsSync(join(target, "planted.txt"))).toBe(false);
    },
  );

  it.skipIf(WINDOWS)("never makes a link through another link (GPT review of MT-02)", async () => {
    const outside = join(dir.path, "outside-links");
    mkdirSync(outside, { recursive: true });
    const lib = { name: `${TOP}/lib`, type: "2", link: outside };
    const planted = { name: `${TOP}/lib/planted`, type: "2", link: "target" };
    // Either order in the archive.
    for (const entries of [
      [lib, planted],
      [planted, lib],
    ]) {
      const { error } = await extract(entries);
      expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
      let made = true;
      try {
        lstatSync(join(outside, "planted"));
      } catch {
        made = false;
      }
      expect(made).toBe(false);
    }
  });

  it("refuses a link that names nothing, and any link where setup makes them (Windows, D153)", async () => {
    const empty = await extract([{ name: `${TOP}/lib`, type: "2", link: "" }]);
    // node-tar's strict parser refuses it first; the extractor's own check stands behind it.
    expect(empty.error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    expect(empty.error?.diagnostic.message).toMatch(/linkpath required|links to nothing/);
    const windows = await extract([{ name: `${TOP}/lib`, type: "2", link: "a" }], "refuse");
    expect(windows.error?.diagnostic.message).toContain("made by setup");
  });

  it("refuses an archive that doesn't read, without an unhandled rejection", async () => {
    round += 1;
    const file = join(dir.path, "damaged.tar.gz");
    const whole = archive([{ name: `${TOP}/a.txt`, body: "a".repeat(4000) }]);
    writeFileSync(file, whole.subarray(0, Math.floor(whole.length / 2)));
    const into = join(dir.path, "damaged");
    mkdirSync(into);
    const error = await extractBundle(file, into, TOP).catch((caught: RpcError) => caught);
    expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
    writeFileSync(file, Buffer.from("not an archive at all"));
    const again = await extractBundle(file, join(dir.path, "damaged2"), TOP).catch(
      (caught: RpcError) => caught,
    );
    expect(again?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_INVALID");
  });

  it.skipIf(WINDOWS || process.getuid?.() === 0)(
    "reports a directory it can't write as the file system's failure, not the archive's",
    async () => {
      const into = join(dir.path, "readonly");
      mkdirSync(into);
      chmodSync(into, 0o500);
      try {
        const file = join(dir.path, "ok.tar.gz");
        writeFileSync(file, archive([{ name: `${TOP}/a.txt`, body: "a" }]));
        const error = await extractBundle(file, into, TOP).catch((caught: RpcError) => caught);
        expect(error?.diagnostic.code).toBe("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED");
      } finally {
        chmodSync(into, 0o700);
      }
    },
  );

  it("reads an entry's path below the top directory", () => {
    expect(entryParts(`${TOP}/`, TOP, false)).toEqual([]);
    expect(entryParts(`${TOP}/a/b/`, TOP, false)).toEqual(["a", "b"]);
    expect(entryParts(`${TOP}/a:b`, TOP, false)).toEqual(["a:b"]);
    expect(typeof entryParts(`${TOP}/a:b`, TOP, true)).toBe("string");
    expect(typeof entryParts(`${TOP}x/a`, TOP, false)).toBe("string");
  });
});
