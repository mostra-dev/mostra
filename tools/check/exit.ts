/**
 * Exiting without losing output. On POSIX, Node.js writes to a pipe asynchronously, and
 * `process.exit()` drops whatever hasn't been handed to the pipe yet (Node.js, "A note on process
 * I/O"). `pnpm check` prints a failed job's whole output, then its summary, then exits: where its
 * output is a pipe (a CI step's log, a test that runs it), an exit straight after the printing lost
 * the summary and the end of the output. So the runner exits once both streams have flushed.
 */

/** Longest wait for a stream whose reader stopped reading, before exiting anyway. */
const FLUSH_LIMIT_MS = 10_000;

let exiting: number | undefined;

/**
 * Exits with `code` once everything written to stdout and stderr so far has been handed on. The
 * first call decides the code: a deadline's exit 1 can't be turned into a later 0.
 */
export function exitAfterOutput(code: number): void {
  if (exiting !== undefined) return;
  exiting = code;
  process.exitCode = code;
  const leave = (): void => process.exit(exiting);
  // A reader that never drains a full pipe would hold the exit forever.
  setTimeout(leave, FLUSH_LIMIT_MS);
  let pending = 2;
  const flushed = (): void => {
    pending -= 1;
    if (pending === 0) leave();
  };
  process.stdout.write("", flushed);
  process.stderr.write("", flushed);
}
