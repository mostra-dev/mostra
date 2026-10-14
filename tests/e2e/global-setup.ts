/**
 * Global set-up for the end-to-end suites: one daemon on a fresh home with the WP-03 render
 * fixtures published, recorded in `RUN_FILE`. The returned function is the teardown.
 */
import { writeFileSync } from "node:fs";
import { Client, publishFixture, RUN_FILE, type Run, startDaemon } from "./support/mostra.ts";

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
  writeFileSync(RUN_FILE, JSON.stringify(run));
  return async () => {
    daemon.child.kill("SIGTERM");
    await new Promise((resolve) => daemon.child.once("exit", resolve));
  };
}
