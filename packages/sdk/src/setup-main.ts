#!/usr/bin/env node
/**
 * `mostra-setup [--root <bundle>]`: makes an extracted runtime bundle ready (D142). It checks every
 * file against `files.json`, fetches the pinned verify browser and writes `.mostra-setup.json`.
 * The bundle's `bin/mostra-setup` runs it for the bundle it sits in; the Rust crate (WP-12) and
 * anyone who extracts an archive by hand run it once. It prints one JSON line on stdout,
 * `{ "status": "ok", "bundle": { … } }` or `{ "status": "failed", "diagnostic": { … } }` (exit 3),
 * and its progress on stderr.
 */
import { parseArgs } from "node:util";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { setupBundle } from "./bundle/setup.ts";
import { enclosingBundle } from "./runtime.ts";

const STEPS = { files: "Checking the bundle's files", browser: "Fetching the verify browser" };

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { root: { type: "string" } }, strict: true });
  const root = values.root ?? enclosingBundle();
  if (root === undefined) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
        message: "mostra-setup isn't inside a runtime bundle; pass --root <bundle directory>.",
      }),
    );
  }
  const marker = await setupBundle(root, {
    onStep: (step) => process.stderr.write(`mostra-setup: ${STEPS[step]}…\n`),
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", bundle: { root, ...marker } })}\n`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const diagnostic =
      error instanceof RpcError
        ? error.diagnostic
        : createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
            message: `mostra-setup failed: ${(error as Error).message}`,
          });
    process.stdout.write(`${JSON.stringify({ status: "failed", diagnostic })}\n`);
    process.stderr.write(`mostra-setup: ${diagnostic.message}\n`);
    process.exitCode = 3;
  },
);
