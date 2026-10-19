#!/usr/bin/env node
/**
 * `mostra`, the CLI's binary (D60, INTERFACES §9). A copy installed from npm first moves into the
 * runtime bundle its release pins (`bootstrap.ts`, RT-01); otherwise it runs one command and exits
 * with its code, after stdout has drained, so a reader never loses the end of the envelope.
 */
import { MINIMUM_NODE, nodeTooOld } from "./node-gate.ts";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

/** Refuses a Node.js too old to start Mostra, before anything that needs a newer one loads. */
async function refuseOldNode(): Promise<number> {
  const message = `Node.js ${MINIMUM_NODE.join(".")} or later is needed to start Mostra; this is ${process.versions.node}.`;
  const json = process.argv.includes("--json");
  try {
    const { createDiagnostic } = await import("@mostra/protocol");
    const diagnostic = createDiagnostic("MOSTRA_ENV_NODE_UNSUPPORTED", { message });
    process.stderr.write(`mostra: ${diagnostic.message}\nmostra: ${diagnostic.hint ?? ""}\n`);
    if (json)
      process.stdout.write(`${JSON.stringify({ ok: false, error: diagnostic, warnings: [] })}\n`);
  } catch {
    process.stderr.write(`mostra: ${message} (MOSTRA_ENV_NODE_UNSUPPORTED)\n`);
  }
  return 3;
}

const code = nodeTooOld(process.versions.node) ? await refuseOldNode() : await start();

async function start(): Promise<number> {
  const { bootstrap, needsBootstrap } = await import("./bootstrap.ts");
  return needsBootstrap(process.env)
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
}
process.stdout.write("", () => process.exit(code));
