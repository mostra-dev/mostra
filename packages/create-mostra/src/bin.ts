#!/usr/bin/env node
/** `create-mostra`'s binary: `npm create mostra [dir]` (see `index.ts`). */
import { create } from "./index.ts";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const code = await create({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  terminal:
    process.stdin.isTTY === true || process.stdout.isTTY === true || process.stderr.isTTY === true,
});
process.stdout.write("", () => process.exit(code));
