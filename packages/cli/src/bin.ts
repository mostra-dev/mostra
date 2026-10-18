#!/usr/bin/env node
/**
 * `mostra`, the CLI's binary (D60, INTERFACES §9). It runs one command and exits with its code,
 * after stdout has drained, so a reader never loses the end of the envelope.
 */
import { run } from "./run.ts";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const code = await run({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  stdin: process.stdin,
  tty: {
    stdin: process.stdin.isTTY === true,
    stdout: process.stdout.isTTY === true,
    stderr: process.stderr.isTTY === true,
  },
});
process.stdout.write("", () => process.exit(code));
