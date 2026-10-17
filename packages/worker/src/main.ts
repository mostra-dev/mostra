#!/usr/bin/env node
/**
 * `@mostra/worker`'s process entry (`dist/main.js`): `main.js --channel fd:4|unix:<path>
 * --version-dir <dir> [--source-dir <dir>] [--modules <node_modules>]`. A launcher starts it for one artifact version
 * (D124); the first request on the channel is `worker/start`.
 */
import { parseArgs } from "node:util";
import { runWorker } from "./worker.ts";

const { values } = parseArgs({
  options: {
    channel: { type: "string" },
    "version-dir": { type: "string" },
    "source-dir": { type: "string" },
    modules: { type: "string" },
  },
  strict: true,
});
if (!values.channel || !values["version-dir"]) {
  process.stderr.write(
    "usage: main.js --channel fd:<n>|unix:<path> --version-dir <dir> [--source-dir <dir>] [--modules <node_modules>]\n",
  );
  process.exit(2);
}
await runWorker({
  channel: values.channel,
  versionDir: values["version-dir"],
  ...(values["source-dir"] ? { sourceDir: values["source-dir"] } : {}),
  ...(values.modules ? { modules: values.modules } : {}),
});
