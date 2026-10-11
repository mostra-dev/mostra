/**
 * A minimal, deterministic POSIX tar (pax interchange format) for source snapshots (DATA_MODEL §1):
 * regular files only, in the order given, with mode 0644 or 0755, owner 0, modification time 0 and
 * a pax `path` record for any path longer than 100 bytes or outside ASCII. The same tree always
 * gives the same bytes. {@link readTar} reads what {@link tarFile} writes.
 */

const BLOCK = 512;

/** One file in an archive. */
export interface TarFile {
  /** Relative, `/`-separated path. */
  readonly path: string;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number, type: "0" | "x", mode: number): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name, 0, 100, "utf8");
  block.write(octal(mode, 8), 100, 8, "ascii");
  block.write(octal(0, 8), 108, 8, "ascii");
  block.write(octal(0, 8), 116, 8, "ascii");
  block.write(octal(size, 12), 124, 12, "ascii");
  block.write(octal(0, 12), 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write(type, 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

function padding(size: number): Buffer {
  const rest = size % BLOCK;
  return Buffer.alloc(rest === 0 ? 0 : BLOCK - rest, 0);
}

/** A pax record `"<length> path=<value>\n"`, where the length counts the whole record. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  const bodyLength = Buffer.byteLength(body, "utf8");
  let length = bodyLength + 1;
  while (String(length).length + bodyLength !== length) length = String(length).length + bodyLength;
  return Buffer.from(`${length}${body}`, "utf8");
}

/** The archive blocks of one file: an optional pax header, the header, the data and padding. */
export function tarFile(file: TarFile): Buffer[] {
  const mode = file.executable ? 0o755 : 0o644;
  const blocks: Buffer[] = [];
  const plain = /^[\x20-\x7e]*$/.test(file.path) && Buffer.byteLength(file.path) <= 100;
  if (!plain) {
    const record = paxRecord("path", file.path);
    blocks.push(header("PaxHeader", record.length, "x", 0o644), record, padding(record.length));
  }
  // Readers that ignore pax still get a printable stand-in; the pax record carries the real path.
  const name = plain ? file.path : file.path.replace(/[^\x20-\x7e]/g, "_").slice(-100);
  blocks.push(
    header(name, file.data.length, "0", mode),
    Buffer.from(file.data),
    padding(file.data.length),
  );
  return blocks;
}

/** The end of an archive: two zero blocks. */
export const TAR_END: Buffer = Buffer.alloc(BLOCK * 2, 0);

/** Reads an archive written by {@link tarFile}. Throws on anything malformed. */
export function readTar(archive: Uint8Array): TarFile[] {
  const buffer = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const files: TarFile[] = [];
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const field = (start: number, length: number): string =>
      block
        .subarray(start, start + length)
        .toString("latin1")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12), 8);
    const type = field(156, 1);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error(`Malformed tar header at ${offset}.`);
    const dataStart = offset + BLOCK;
    const data = buffer.subarray(dataStart, dataStart + size);
    if (data.length !== size) throw new Error("Truncated tar archive.");
    offset = dataStart + size + padding(size).length;
    if (type === "x") {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = match?.[1];
      continue;
    }
    if (type !== "0" && type !== "") throw new Error(`Unexpected tar entry type "${type}".`);
    const path = paxPath ?? field(0, 100);
    paxPath = undefined;
    const mode = Number.parseInt(field(100, 8), 8);
    files.push({ path, executable: (mode & 0o111) !== 0, data: new Uint8Array(data) });
  }
  return files;
}
