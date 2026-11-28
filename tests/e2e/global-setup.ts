/**
 * Global set-up for the end-to-end suites: one daemon on a fresh home with the WP-03 render
 * fixtures published, recorded in the run's private directory (`MOSTRA_E2E_RUN`). The returned
 * function is the teardown.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  Client,
  publishFixture,
  RUN_VARIABLE,
  type Run,
  removeTree,
  startDaemon,
} from "./support/mostra.ts";

/**
 * A local mirror of this workspace's copies of the kit's on-demand libraries (WP-19): pages that
 * use the kit's map, 3D scene or whiteboard install them through the daemon's real install child,
 * with no network.
 */
const MIRROR = fileURLToPath(
  new URL("../../packages/runtime/test/mirror-process.ts", import.meta.url),
);

async function startMirror(): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [MIRROR], { stdio: ["pipe", "pipe", "inherit"] });
  const line = await new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`the kit's mirror exited (${code})`)));
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).once("line", resolve);
  });
  return { child, url: (JSON.parse(line) as { url: string }).url };
}

export default async function setup(): Promise<() => Promise<void>> {
  const mirror = await startMirror();
  const daemon = await startDaemon({ env: { npm_config_registry: mirror.url } });
  const client = await Client.connect(daemon.socket);
  const run: Run = {
    pid: daemon.child.pid as number,
    home: daemon.home,
    socket: daemon.socket,
    receipts: {
      tsx: await publishFixture(client, daemon.home, "single-tsx", "page.tsx"),
      mdx: await publishFixture(client, daemon.home, "single-mdx", "page.mdx"),
      directory: await publishFixture(client, daemon.home, "directory"),
      // WP-06: a copy of the TSX page taking one submission per viewer, so each test's own viewer
      // submits once whatever the other engines do at the same time.
      survey: await publishFixture(client, daemon.home, "single-tsx", "page.tsx", {
        copy: "survey",
        policy: { policy: "once", scope: "per-viewer" },
      }),
    },
  };
  client.close();
  // The record holds capability links: it lives in the run's own mode-0700 directory, created
  // only by this process (`wx`, 0600). The workers inherit the variable that names it.
  const file = join(daemon.root, "run.json");
  writeFileSync(file, JSON.stringify(run), { flag: "wx", mode: 0o600 });
  process.env[RUN_VARIABLE] = file;
  return async () => {
    daemon.child.kill("SIGTERM");
    await new Promise((resolve) => daemon.child.once("exit", resolve));
    mirror.child.stdin?.end();
    // Keep the home when asked, to look at its logs and ledger after a failure.
    if (!process.env["MOSTRA_E2E_KEEP"]) removeTree(daemon.root);
  };
}
