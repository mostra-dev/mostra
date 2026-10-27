/// <reference lib="dom" />
/**
 * External evidence (STANDARDS, Verification layer 7; DP-02): on-demand installs from the real npm
 * registry through a real daemon and pnpm 10. An artifact imports `three` and
 * `@react-three/fiber`, which peer-depends on React and React DOM (ROUND-3 §1.2 lists both as on
 * demand); the version renders a canvas in Chromium with the warm set's single React. Run by hand
 * (`pnpm --filter @mostra/runtime test:external`) with network access; CI never runs it.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
  warmVersion,
} from "../support.ts";

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

beforeAll(async () => {
  home = testHome();
  // A fresh HOME: no user .npmrc, so this is npm's default registry with Mostra's settings.
  daemon = await startDaemon(home, { env: { ...home.env, HOME: tempDir("external-user") } });
  client = await connectTo(daemon.status.socket as string);
  expect((await client.call("mostra/initialize", initializeParams())).error).toBeUndefined();
});

afterAll(async () => {
  await client?.call("mostra/shutdown", {});
  await daemon?.exited;
});

describe("the real npm registry (external)", () => {
  it("installs three and @react-three/fiber on demand, and the version renders with one React", async () => {
    const dir = join(tempDir("external-artifact"), "scene");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "index.tsx"),
      [
        'import * as React from "react";',
        'import { Canvas, useFrame } from "@react-three/fiber";',
        'import type { Mesh } from "three";',
        "",
        "function Box() {",
        "  const ref = React.useRef<Mesh>(null);",
        "  useFrame((_, delta) => { if (ref.current) ref.current.rotation.y += delta; });",
        "  return (",
        "    <mesh ref={ref}>",
        "      <boxGeometry args={[1, 1, 1]} />",
        '      <meshBasicMaterial color="hotpink" />',
        "    </mesh>",
        "  );",
        "}",
        "",
        "export default function Page() {",
        "  return (",
        "    <main style={{ width: 400, height: 300 }} data-react={React.version}>",
        "      <Canvas><Box /></Canvas>",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    const started = performance.now();
    const response = await client.call("artifact/publish", { source: { path: dir } });
    const seconds = (performance.now() - started) / 1000;
    if (response.error)
      throw new Error(`${response.error.data.code}: ${response.error.data.message}`);
    const { versionId } = response.result as { versionId: string };
    const lock = readFileSync(join(home.home, "versions", versionId, "lock.yaml"), "utf8");
    const packages = /packages:\n((?: {2}.+\n)+)/.exec(lock)?.[1] ?? "";
    const pinned = [...lock.matchAll(/\n {4}((?:@[^/\s]+\/)?[^@\s]+)@(\d[^:(\s]*):/g)].map(
      ([, name, version]) => `${name}@${version}`,
    );
    console.log(
      `publish with installs: ${seconds.toFixed(1)} s\ndirect:\n${packages}graph: ${pinned.join(", ")}`,
    );
    expect(packages).toContain('"@react-three/fiber":');
    // pnpm installed no React of its own: the peers resolved to the warm links.
    expect(pinned.filter((entry) => /^react(?:-dom)?@/.test(entry))).toEqual([]);
    // `three` comes as fiber's peer; the artifact imports only its types.
    expect(lock).toMatch(/\n {4}three@\d+\.\d+\.\d+:/);

    // One React on disk: fiber's react is the warm set's.
    const locks = join(home.home, "deps", "locks");
    const [layout] = readdirSync(locks);
    const pnpm = join(locks, layout as string, "node_modules", ".pnpm");
    const fiber = readdirSync(pnpm).find((name) => name.startsWith("@react-three+fiber@"));
    const warm = fileURLToPath(new URL("../../../warm/node_modules", import.meta.url));
    expect(realpathSync(join(pnpm, fiber as string, "node_modules", "react"))).toBe(
      realpathSync(join(warm, "react")),
    );

    // One React at run time: the scene renders, and fiber's reconciler finds the page's React.
    const root = join(home.home, "versions", versionId, "client");
    const server = createServer((request, reply) => {
      const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
      let file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(root, "index.html");
      }
      const type = { ".js": "text/javascript", ".css": "text/css" }[extname(file)] ?? "text/html";
      reply.writeHead(200, { "content-type": type });
      reply.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForSelector("main canvas", { timeout: 20_000 });
      // One React: the page runs the warm set's, not a copy the package brought (D95).
      expect(await page.getAttribute("main", "data-react")).toBe(warmVersion("react"));
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.close();
    }
  });
});
