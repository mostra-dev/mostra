/**
 * A file one process writes for another to read, such as the PIDs a fixture hands its test (#160).
 * `writeFileSync` creates the file and then writes it, so a reader that waits only for the file
 * to exist can read it empty: the Windows reaper case's supervisor did, parsed "" and exited 1.
 * The writer here puts the text in a file of its own and renames that into place, which is atomic
 * on NTFS and POSIX file systems within one volume, so a reader never meets a partial file. The
 * reader waits for text it can parse, not for the file, so it is safe with any writer.
 *
 * Fixtures run by plain Node.js import it too (Node.js strips its types).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const RETRY = new Set(["ENOENT", "EBUSY", "EPERM"]);

/** Writes `text` to `file` whole: a reader sees no file or all of it. */
export function writeWhole(file: string, text: string): void {
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, text);
  renameSync(partial, file);
}

/** `text` as JSON, or undefined while it isn't whole JSON yet (an empty or partly written file). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Waits until `file` holds text that `parse` accepts (returns other than undefined) and returns
 * the parsed value. Past the deadline it throws with what the file last held, so a writer that
 * died or wrote something else is named rather than waited on.
 */
export async function readWhole<T>(
  file: string,
  parse: (text: string) => T | undefined,
  timeoutMs = 10_000,
  what = file,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: string | undefined;
  let missing = "doesn't exist";
  for (;;) {
    try {
      last = readFileSync(file, "utf8");
      const value = parse(last);
      if (value !== undefined) return value;
    } catch (error) {
      // Not there yet, or (Windows) caught in the rename that puts it there.
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!RETRY.has(code)) throw error;
      last = undefined;
      missing = code === "ENOENT" ? "doesn't exist" : `can't be read (${code})`;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out waiting for ${what}: after ${timeoutMs} ms ${
          last === undefined ? `the file ${missing}` : `it holds ${JSON.stringify(last)}`
        }.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
