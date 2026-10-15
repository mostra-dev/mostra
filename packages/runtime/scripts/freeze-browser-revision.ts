/**
 * Freezes a published version at the current browser-protocol revision (VR-10, D111): it publishes
 * the client runtime's end-to-end fixture through a real daemon and copies the version into
 * `test/fixtures/browser-revisions/<revision>/`, without source maps, with its output digest and
 * identity, so CI opens a version built today against every later gateway. A frozen revision is
 * never frozen again: the point is that its bytes don't change.
 *
 * ```sh
 * pnpm --filter @mostra/runtime build && node packages/runtime/scripts/freeze-browser-revision.ts
 * ```
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_PROTOCOL_REVISION } from "@mostra/protocol";
import { versionOutputDigest } from "../src/publish/index.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = fileURLToPath(new URL("../../../tests/e2e/fixtures/client/", import.meta.url));
const TARGET = join(ROOT, "test", "fixtures", "browser-revisions", BROWSER_PROTOCOL_REVISION);

/** Makes a sealed tree writable again, so it can be edited and removed. */
function unseal(dir: string): void {
  chmodSync(dir, 0o755);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) unseal(path);
    else chmodSync(path, 0o644);
  }
}

/** Removes every source map under `dir`: CI needs the code, not its maps. */
function dropMaps(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) dropMaps(path);
    else if (entry.name.endsWith(".map")) rmSync(path);
  }
}

if (existsSync(TARGET)) {
  console.error(`${TARGET} exists: revision ${BROWSER_PROTOCOL_REVISION} is frozen already.`);
  process.exit(1);
}

// A daemon on a home of its own, in a short directory (macOS limits socket paths).
const root = realpathSync(mkdtempSync("/tmp/mostra-freeze-"));
const home = join(root, "home");
cpSync(SOURCE, join(root, "client"), { recursive: true });
const { MOSTRA_HOME: _home, ...inherited } = process.env;
const daemon = spawn(process.execPath, [join(ROOT, "dist", "bin.js"), "daemon", "--home", home], {
  env: { ...inherited, MOSTRA_RUNTIME_DIR: join(root, "run") },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  const status = JSON.parse(
    await new Promise<string>((resolve, reject) => {
      let out = "";
      daemon.stdout?.setEncoding("utf8");
      daemon.stdout?.on("data", (chunk: string) => {
        out += chunk;
        if (out.includes("\n")) resolve(out.slice(0, out.indexOf("\n")));
      });
      daemon.once("exit", (code) => reject(new Error(`the daemon exited (${code})`)));
    }),
  ) as { socket: string };
  const socket = createConnection(status.socket);
  await new Promise((resolve) => socket.once("connect", resolve));
  socket.setEncoding("utf8");
  let buffer = "";
  const answers = new Map<number, (message: Record<string, unknown>) => void>();
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const message = JSON.parse(buffer.slice(0, at)) as Record<string, unknown>;
      buffer = buffer.slice(at + 1);
      answers.get(message["id"] as number)?.(message);
    }
  });
  let next = 1;
  const call = (method: string, params: unknown): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = next++;
      answers.set(id, (message) =>
        message["error"]
          ? reject(new Error(JSON.stringify(message["error"])))
          : resolve(message["result"] as Record<string, unknown>),
      );
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await call("mostra/initialize", {
    client: { name: "freeze-browser-revision", version: "0" },
    revisions: ["2026-10-10"],
    capabilities: {},
    ports: [],
  });
  const receipt = (await call("artifact/publish", { source: { path: join(root, "client") } })) as {
    artifactId: string;
    versionId: string;
  };
  socket.end();
  const versionDir = join(home, "versions", receipt.versionId);
  const manifest = JSON.parse(readFileSync(join(versionDir, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
  if (
    (manifest["environment"] as { browserProtocolRevision?: string }).browserProtocolRevision !==
    BROWSER_PROTOCOL_REVISION
  ) {
    throw new Error("the version wasn't built at the current browser-protocol revision");
  }
  mkdirSync(TARGET, { recursive: true });
  const frozen = join(TARGET, "version");
  cpSync(versionDir, frozen, { recursive: true });
  unseal(frozen);
  dropMaps(frozen);
  const outputDigest = await versionOutputDigest(frozen);
  writeFileSync(
    join(frozen, "manifest.json"),
    `${JSON.stringify({ ...manifest, outputDigest }, null, 2)}\n`,
  );
  writeFileSync(
    join(TARGET, "fixture.json"),
    `${JSON.stringify(
      {
        revision: BROWSER_PROTOCOL_REVISION,
        artifactId: receipt.artifactId,
        versionId: receipt.versionId,
        sourceDigest: manifest["sourceDigest"],
        envDigest: manifest["envDigest"],
        outputDigest,
        manifest: manifest["manifest"],
        frozenAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  const size = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce(
      (total, entry) =>
        total +
        (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size),
      0,
    );
  console.log(
    `froze ${receipt.versionId} at ${BROWSER_PROTOCOL_REVISION}: ${size(TARGET)} bytes in ${TARGET}`,
  );
} finally {
  daemon.kill("SIGTERM");
  await new Promise((resolve) => daemon.once("exit", resolve));
  unseal(root);
  rmSync(root, { recursive: true, force: true });
}
