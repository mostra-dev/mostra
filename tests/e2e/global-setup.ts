/**
 * Global set-up for the end-to-end suites: one daemon on a fresh home with the WP-03 render
 * fixtures published, recorded in the run's private directory (`MOSTRA_E2E_RUN`). The returned
 * function is the teardown.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, publishFixture, RUN_VARIABLE, type Run, startDaemon } from "./support/mostra.ts";

export default async function setup(): Promise<() => Promise<void>> {
  const daemon = await startDaemon();
  const client = await Client.connect(daemon.socket);
  const run: Run = {
    pid: daemon.child.pid as number,
    home: daemon.home,
    socket: daemon.socket,
    receipts: {
      tsx: await publishFixture(client, daemon.home, "single-tsx", "page.tsx"),
      mdx: await publishFixture(client, daemon.home, "single-mdx", "page.mdx"),
      directory: await publishFixture(client, daemon.home, "directory"),
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
  };
}
