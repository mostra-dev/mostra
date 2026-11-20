/**
 * The test support's handover file (test/whole-file.ts, #160): the Windows reaper case's fixture
 * supervisor waited for its PID file to exist, read it in the moment between `writeFileSync`'s
 * create and its write, parsed "" and exited 1.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventually, tempDir } from "../support.ts";
import { parseJson, readWhole, writeWhole } from "../whole-file.ts";

/**
 * A writer in its own process that does what `writeFileSync` does, with the moment between the
 * create and the write held open until `go` exists: the window #160's reader fell into, held open
 * for as long as the test needs, so nothing here depends on timing.
 */
function heldWriter(file: string, text: string, go: string) {
  const script =
    'const fs = require("node:fs"); const [file, text, go] = process.argv.slice(1); const fd = fs.openSync(file, "w"); const wait = setInterval(() => { if (!fs.existsSync(go)) return; clearInterval(wait); fs.writeSync(fd, text); fs.closeSync(fd); }, 5);';
  const child = spawn(process.execPath, ["-e", script, file, text, go], { stdio: "ignore" });
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

const record = { pid: 4242, grandchildren: [4243, 4244] };

describe("a file one process writes and another reads (#160)", () => {
  it("is read whole from a writer that creates the file before it writes it", async () => {
    const dir = tempDir("whole");
    const file = join(dir, "family.json");
    const go = join(dir, "go");
    const written = heldWriter(file, JSON.stringify(record), go);
    await eventually(() => existsSync(file), 10_000, "the writer to create the file");
    // The control: #160's reader, which waits only for the file to exist, finds it empty.
    expect(readFileSync(file, "utf8")).toBe("");
    expect(() => JSON.parse(readFileSync(file, "utf8"))).toThrow("Unexpected end of JSON input");
    // The reader that waits for whole JSON is still waiting, and gets all of it once written.
    const read = readWhole(file, parseJson, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(go, "");
    expect(await read).toEqual(record);
    expect(await written).toBe(0);
  });

  it("names what the file last held when it never becomes whole", async () => {
    const dir = tempDir("whole");
    await expect(readWhole(join(dir, "missing.json"), parseJson, 100, "the PIDs")).rejects.toThrow(
      "Timed out waiting for the PIDs: after 100 ms the file doesn't exist.",
    );
    const torn = join(dir, "torn.json");
    writeWhole(torn, '{"pid": 42');
    await expect(readWhole(torn, parseJson, 100, "the PIDs")).rejects.toThrow(
      'Timed out waiting for the PIDs: after 100 ms it holds "{\\"pid\\": 42".',
    );
  });

  it("is written by renaming a finished file into place, leaving nothing else behind", () => {
    const dir = tempDir("whole");
    const file = join(dir, "family.json");
    writeWhole(file, JSON.stringify(record));
    writeWhole(file, JSON.stringify({ ...record, pid: 4245 }));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...record, pid: 4245 });
    expect(readdirSync(dir)).toEqual(["family.json"]);
  });
});
