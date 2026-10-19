#!/usr/bin/env node
/**
 * `mostra`, the CLI's binary (D60, INTERFACES §9). A copy installed from npm first moves into the
 * runtime bundle its release pins (`bootstrap.ts`, RT-01); otherwise it runs one command and exits
 * with its code, after stdout has drained, so a reader never loses the end of the envelope.
 */
import { bootstrap, needsBootstrap } from "./bootstrap.ts";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const code = needsBootstrap(process.env)
  ? await bootstrap({
      argv: process.argv.slice(2),
      env: process.env,
      stdout: (text) => {
        process.stdout.write(text);
      },
      stderr: (text) => {
        process.stderr.write(text);
      },
      stderrTty: process.stderr.isTTY === true,
    })
  : await (await import("./run.ts")).run({
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
