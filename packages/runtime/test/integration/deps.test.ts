/// <reference lib="dom" />
/**
 * Dependencies through a real daemon, a real pnpm 10 install child and a local registry (D95):
 * the warm set without installs and one React with an on-demand peer (DP-01), on-demand installs
 * into the shared store and the explicit policy (DP-02), the lockfile in the version identity and a
 * frozen version rebuilt offline (DP-03), offline failures within a second (DP-04), and lifecycle
 * scripts in the install child's context (DP-05).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { linkTarget } from "../../src/platform/index.ts";
import { type FakeRegistry, FIXTURE_PACKAGES, startRegistry } from "../registry.ts";
import {
  alive,
  connectTo,
  type DaemonStatus,
  eventually,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
  unsealTree,
  WINDOWS,
} from "../support.ts";

interface Running {
  readonly home: TestHome;
  readonly daemon: RuntimeProcess & { status: DaemonStatus };
  readonly client: LineClient;
  readonly user: string;
}

const running: Running[] = [];
let registry: FakeRegistry;

/** A daemon on `home` (a fresh one by default) whose installs reach the local registry. */
async function start(
  options: { home?: TestHome; env?: Record<string, string>; registryUrl?: string } = {},
): Promise<Running> {
  const home = options.home ?? testHome();
  const user = tempDir("deps-user");
  const daemon = await startDaemon(home, {
    env: {
      ...home.env,
      HOME: user,
      // Windows programs (npm's ~/.npmrc among them) find the user's home through USERPROFILE.
      ...(WINDOWS ? { USERPROFILE: user } : {}),
      npm_config_registry: options.registryUrl ?? registry.url,
      // Something only the supervisor has: it must never reach a lifecycle script (DP-05).
      MOSTRA_TEST_SUPERVISOR_ONLY: "supervisor-only-value",
      ...options.env,
    },
  });
  const client = await connectTo(daemon.status.socket as string);
  expect((await client.call("mostra/initialize", initializeParams())).error).toBeUndefined();
  const started = { home, daemon, client, user };
  running.push(started);
  return started;
}

async function stop(target: Running): Promise<void> {
  await target.client.call("mostra/shutdown", {});
  await target.daemon.exited;
  running.splice(running.indexOf(target), 1);
}

beforeAll(async () => {
  registry = await startRegistry(FIXTURE_PACKAGES);
});
afterEach(async () => {
  for (const target of [...running]) await stop(target);
});
afterAll(async () => {
  await registry.close();
});

/** An artifact directory with `files`. */
function artifact(files: Record<string, string>): string {
  const dir = join(tempDir("deps-artifact"), "artifact");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

const publish = (target: Running, dir: string): Promise<Message> =>
  target.client.call("artifact/publish", { source: { path: dir } });

interface Receipt {
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  readonly reused: boolean;
}

const ok = <T>(message: Message): T => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result as T;
};

const lockOf = (target: Running, versionId: string): string =>
  readFileSync(join(target.home.home, "versions", versionId, "lock.yaml"), "utf8");

const layouts = (target: Running): string[] => {
  const dir = join(target.home.home, "deps", "locks");
  return existsSync(dir) ? readdirSync(dir) : [];
};

/** How many install children the supervisor has started, from its log. */
const installsStarted = (target: Running): number => {
  const dir = join(target.home.home, "logs");
  return readdirSync(dir)
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n"))
    .filter(
      (line) => line.includes('"event":"process.started"') && line.includes('"kind":"install"'),
    ).length;
};

const PEER_PAGE = [
  'import * as React from "react";',
  'import { Counter, ReactFromPeer, peerVersion } from "mostra-fixture-peer";',
  "export default function Page() {",
  "  return (",
  "    <main data-same-react={String(ReactFromPeer === React)} data-peer={peerVersion}>",
  "      <Counter />",
  "    </main>",
  "  );",
  "}",
  "",
].join("\n");

describe("the warm set and one React (DP-01)", () => {
  it("resolves warm packages with no install at all", async () => {
    const target = await start();
    const before = registry.requests.length;
    const dir = artifact({
      "index.tsx": [
        'import { z } from "zod";',
        'import { useForm } from "react-hook-form";',
        'import { LineChart } from "recharts";',
        'import { motion } from "motion/react";',
        'import { Check } from "lucide-react";',
        "const schema = z.object({ name: z.string() });",
        "export default function Page() {",
        "  useForm();",
        "  return <motion.div><Check />{String(schema.safeParse({}).success)}<LineChart width={10} height={10} data={[]} /></motion.div>;",
        "}",
        "",
      ].join("\n"),
    });
    const receipt = ok<Receipt>(await publish(target, dir));
    expect(installsStarted(target)).toBe(0);
    expect(registry.requests.length).toBe(before);
    expect(layouts(target)).toEqual([]);
    const lock = lockOf(target, receipt.versionId);
    expect(lock).toContain('"recharts": "3.10.1"');
    expect(lock).not.toContain("packages:");
  });

  it("gives an on-demand package that peer-depends on React the one warm React, at run time", async () => {
    const target = await start();
    const dir = artifact({ "index.tsx": PEER_PAGE });
    const receipt = ok<Receipt>(await publish(target, dir));
    // On disk: the package's react is the warm set's react, one directory.
    const [layout] = layouts(target);
    const pnpmDir = join(
      target.home.home,
      "deps",
      "locks",
      layout as string,
      "node_modules",
      ".pnpm",
    );
    const peerDir = readdirSync(pnpmDir).find((name) => name.startsWith("mostra-fixture-peer@"));
    const peerReact = realpathSync(join(pnpmDir, peerDir as string, "node_modules", "react"));
    const warm = join(fileURLToPath(import.meta.url), "../../../../warm/node_modules");
    expect(peerReact).toBe(realpathSync(join(warm, "react")));
    // In the browser: the package's React module is the page's, and its hooks work.
    const root = join(target.home.home, "versions", receipt.versionId, "client");
    const server: Server = createServer((request, response) => {
      const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
      let file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(root, "index.html");
      }
      const type =
        extname(file) === ".js"
          ? "text/javascript"
          : extname(file) === ".css"
            ? "text/css"
            : "text/html";
      response.writeHead(200, { "content-type": type });
      response.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser: Browser = await chromium.launch();
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
      await page.waitForSelector("#counter");
      expect(await page.getAttribute("main", "data-same-react")).toBe("true");
      await page.click("#counter");
      await page.click("#counter");
      expect(await page.textContent("#counter")).toBe("clicks: 2");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.close();
    }
  });
});

describe("on-demand packages (DP-02)", () => {
  it("installs an unknown import into the shared store with a lockfile for the artifact", async () => {
    const target = await start();
    const first = ok<Receipt>(await publish(target, artifact({ "index.tsx": PEER_PAGE })));
    const lock = lockOf(target, first.versionId);
    expect(lock).toContain('packages:\n  "mostra-fixture-peer": "1.1.0"');
    expect(lock).toContain("pnpm: |");
    expect(lock).toContain("mostra-fixture-util@1.0.0");
    expect(readdirSync(join(target.home.home, "deps", "store")).length).toBeGreaterThan(0);
    // A second artifact with the same import shares the store and the layout: nothing is fetched.
    const fetched = registry.requests.length;
    const installs = installsStarted(target);
    const second = ok<Receipt>(await publish(target, artifact({ "index.tsx": PEER_PAGE })));
    expect(second.artifactId).not.toBe(first.artifactId);
    // One resolution (pnpm add, in the store and the metadata cache already), no new layout.
    expect(installsStarted(target)).toBe(installs + 1);
    expect(registry.requests.length).toBe(fetched);
    expect(lockOf(target, second.versionId)).toBe(lock);
    expect(layouts(target)).toHaveLength(1);
  });

  it("under the explicit policy, refuses an unknown import with the exact mostra add command, which deps/add fulfils", async () => {
    const target = await start();
    const host = await connectTo(target.daemon.status.socket as string);
    expect(
      (
        await host.call(
          "mostra/initialize",
          initializeParams({ home: { dependencies: "explicit" } }),
        )
      ).error,
    ).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(target.home.home, "config.json"), "utf8")).dependencies,
    ).toBe("explicit");
    const dir = artifact({
      "index.tsx": [
        'import { useState } from "react";',
        'import { label } from "mostra-fixture-util";',
        "export default function Page() { const [n] = useState(0); return <p>{label}{n}</p>; }",
        "",
      ].join("\n"),
    });
    const refused = await publish(target, dir);
    expect(refused.error?.data.code).toBe("MOSTRA_DEP_MISSING");
    expect(refused.error?.data.location).toEqual({ file: "index.tsx", line: 2, column: 23 });
    const command = refused.error?.data.fix?.command as string;
    expect(command).toBe(`mostra add mostra-fixture-util --artifact ${dir}`);
    // What `mostra add` runs (WP-10 maps the command onto it).
    const added = ok<{ packages: unknown[]; lockDigest: string }>(
      await target.client.call("deps/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-util"],
      }),
    );
    expect(added.packages).toEqual([
      { name: "mostra-fixture-util", version: "1.0.0", warm: false },
    ]);
    const receipt = ok<Receipt>(await publish(target, dir));
    expect(lockOf(target, receipt.versionId)).toContain('"mostra-fixture-util": "1.0.0"');
    host.close();
  });

  it("leaves an artifact's lockfile alone when a copy claiming its ID is refused (review finding 2)", async () => {
    const target = await start();
    const created = ok<{ artifactId: string }>(
      await target.client.call("artifact/create", { dir: join(tempDir("deps-claim"), "original") }),
    );
    const manifest = `import { defineArtifact } from "@mostra/react";\nexport const artifact = defineArtifact({ id: ${JSON.stringify(created.artifactId)}, title: "Original" });\n`;
    const original = artifact({ "index.tsx": `${manifest}${PEER_PAGE}` });
    const first = ok<Receipt>(await publish(target, original));
    // A copy that still claims the ID, and no longer imports the package.
    const copy = artifact({
      "index.tsx": `${manifest}export default function Page() { return <p>copy</p>; }\n`,
    });
    expect((await publish(target, copy)).error?.data.code).toBe("MOSTRA_PUBLISH_ID_CONFLICT");
    // The original's pin survived: under the explicit policy it still publishes, as the same version.
    const host = await connectTo(target.daemon.status.socket as string);
    ok(
      await host.call(
        "mostra/initialize",
        initializeParams({ home: { dependencies: "explicit" } }),
      ),
    );
    expect(ok<Receipt>(await publish(target, original))).toMatchObject({
      versionId: first.versionId,
      reused: true,
    });
    host.close();
  });

  it("reports what deps/add can't do with its own codes", async () => {
    const target = await start();
    const dir = artifact({ "index.tsx": "export default function Page() { return <p />; }\n" });
    const add = (packages: string[]) =>
      target.client.call("deps/add", { artifact: { path: dir }, packages });
    expect((await add(["git+https://example.com/x.git"])).error?.data.code).toBe(
      "MOSTRA_DEP_SPEC_INVALID",
    );
    expect((await add(["react@18"])).error?.data.code).toBe("MOSTRA_DEP_WARM_CONFLICT");
    expect(ok<{ packages: unknown[] }>(await add(["react@^19"])).packages).toEqual([
      { name: "react", version: "19.3.0", warm: true },
    ]);
    expect((await add(["mostra-no-such-package"])).error?.data.code).toBe("MOSTRA_DEP_NOT_FOUND");
    const failed = await add(["mostra-fixture-failing"]);
    expect(failed.error?.data.code).toBe("MOSTRA_DEP_INSTALL_FAILED");
    expect(failed.error?.data.message).toContain("FIXTURE_SCRIPT_FAILED");
    // A release less than a day old installs only when named exactly (D95).
    const fresh = await add(["mostra-fixture-fresh"]);
    expect(fresh.error?.data.code).toBe("MOSTRA_DEP_NOT_FOUND");
    expect(fresh.error?.data.message).toContain("at least a day old");
    expect(ok<{ packages: unknown[] }>(await add(["mostra-fixture-fresh@1.0.0"])).packages).toEqual(
      [{ name: "mostra-fixture-fresh", version: "1.0.0", warm: false }],
    );
  });
});

describe("the lockfile in the version identity (DP-03)", () => {
  it("changes envDigest and the version when only the lockfile changes", async () => {
    const target = await start();
    const dir = artifact({ "index.tsx": PEER_PAGE });
    const first = ok<Receipt>(await publish(target, dir));
    expect(lockOf(target, first.versionId)).toContain('"mostra-fixture-peer": "1.1.0"');
    ok(
      await target.client.call("deps/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-peer@1.0.0"],
      }),
    );
    const second = ok<Receipt>(await publish(target, dir));
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.version).toBe(2);
    expect(lockOf(target, second.versionId)).toContain('"mostra-fixture-peer": "1.0.0"');
    const detail = ok<{
      versions: { id: string; sourceDigest: string; envDigest: string }[];
    }>(await target.client.call("artifact/get", { artifact: { path: dir } }));
    const [newer, older] = detail.versions;
    expect(newer?.sourceDigest).toBe(older?.sourceDigest);
    expect(newer?.envDigest).not.toBe(older?.envDigest);
    // The same source again keeps the pinned lockfile: the same version.
    expect(ok<Receipt>(await publish(target, dir))).toMatchObject({
      versionId: second.versionId,
      reused: true,
    });
  });

  it("rebuilds a frozen version offline from the store, with no registry", async () => {
    const online = await start();
    const dir = artifact({ "index.tsx": PEER_PAGE });
    const first = ok<Receipt>(await publish(online, dir));
    const home = online.home;
    await stop(online);
    // The version's files and every layout are gone; only the store and the ledger remain.
    const versionDir = join(home.home, "versions", first.versionId);
    unsealTree(versionDir);
    rmSync(versionDir, { recursive: true });
    rmSync(join(home.home, "deps", "locks"), { recursive: true });
    const before = registry.requests.length;
    const offline = await start({
      home,
      env: { MOSTRA_OFFLINE: "1" },
      registryUrl: "http://127.0.0.1:9/",
    });
    const again = ok<Receipt>(await publish(offline, dir));
    expect(again).toMatchObject({ versionId: first.versionId, version: 1, reused: true });
    expect(existsSync(join(versionDir, "client", "index.html"))).toBe(true);
    expect(registry.requests.length).toBe(before);
  });

  it("relinks a lock layout to the warm set when the runtime has moved", async () => {
    // A warm set at a path of its own: package.json, and node_modules of absolute links to the
    // real packages, as a runtime bundle unpacked elsewhere would have.
    const warmCopy = (): string => {
      const real = fileURLToPath(new URL("../../../warm", import.meta.url));
      const dir = join(tempDir("deps-warm"), "warm");
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(join(dir, "package.json"), readFileSync(join(real, "package.json")));
      for (const entry of readdirSync(join(real, "node_modules"))) {
        if (entry.startsWith(".")) continue;
        const names = entry.startsWith("@")
          ? readdirSync(join(real, "node_modules", entry)).map((name) => `${entry}/${name}`)
          : [entry];
        for (const name of names) {
          mkdirSync(join(dir, "node_modules", name, ".."), { recursive: true });
          symlinkSync(
            realpathSync(join(real, "node_modules", name)),
            join(dir, "node_modules", name),
          );
        }
      }
      return dir;
    };
    const first = warmCopy();
    const online = await start({ env: { MOSTRA_WARM_DIR: first } });
    const dir = artifact({ "index.tsx": PEER_PAGE });
    const receipt = ok<Receipt>(await publish(online, dir));
    const home = online.home;
    await stop(online);
    rmSync(first, { recursive: true });
    const versionDir = join(home.home, "versions", receipt.versionId);
    unsealTree(versionDir);
    rmSync(versionDir, { recursive: true });
    const second = warmCopy();
    const moved = await start({ home, env: { MOSTRA_WARM_DIR: second, MOSTRA_OFFLINE: "1" } });
    expect(ok<Receipt>(await publish(moved, dir))).toMatchObject({
      versionId: receipt.versionId,
      reused: true,
    });
    const [layout] = layouts(moved);
    // The layout's `warm` link stands for the moved warm set: a symlink to it, or on Windows a
    // link farm whose marker names it (D150).
    const target = await linkTarget(join(home.home, "deps", "locks", layout as string, "warm"));
    expect(realpathSync(target ?? "")).toBe(realpathSync(join(second, "node_modules")));
  });
});

describe("offline (DP-04)", () => {
  it("keeps tags and the release age offline (review findings 3 and 4)", async () => {
    const online = await start();
    const first = artifact({ "index.tsx": "export default function Page() { return <p />; }\n" });
    const add = (target: Running, dir: string, packages: string[]) =>
      target.client.call("deps/add", { artifact: { path: dir }, packages });
    // The store gets a fresh release (named exactly) and a mature package with two versions.
    ok(await add(online, first, ["mostra-fixture-fresh@1.0.0", "mostra-fixture-peer@1.0.0"]));
    ok(await add(online, first, ["mostra-fixture-peer@1.1.0"]));
    const home = online.home;
    await stop(online);
    // The same registry stays configured, as on a machine that went offline; pnpm's metadata
    // cache is per registry. No request may reach it.
    const before = registry.requests.length;
    const offline = await start({ home, env: { MOSTRA_OFFLINE: "1" } });
    const second = artifact({
      "index.tsx":
        'import { fresh } from "mostra-fixture-fresh";\nexport default function Page() { return <p>{fresh}</p>; }\n',
    });
    // A bare import doesn't take the fresh release just because the store holds it.
    const bare = await publish(offline, second);
    expect(bare.error?.data.code).toBe("MOSTRA_DEP_NOT_FOUND");
    expect(bare.error?.data.message).toContain("at least a day old");
    // A tag the registry never had isn't "the highest stored version".
    expect((await add(offline, second, ["mostra-fixture-peer@nonexistent"])).error?.data.code).toBe(
      "MOSTRA_DEP_NOT_FOUND",
    );
    // A tag the cached metadata names resolves to its version, offline.
    expect(
      ok<{ packages: unknown[] }>(await add(offline, second, ["mostra-fixture-peer@latest"]))
        .packages,
    ).toEqual([{ name: "mostra-fixture-peer", version: "1.1.0", warm: false }]);
    expect(registry.requests.length).toBe(before);
  });

  it("knows what the store holds after a crash while a layout is finished (review finding 5)", async () => {
    const crashing = await start({ env: { MOSTRA_TEST_FAULTS: "deps:before-marker:crash" } });
    const dir = artifact({ "index.tsx": PEER_PAGE });
    void publish(crashing, dir).catch(() => undefined);
    await crashing.daemon.exited;
    running.splice(running.indexOf(crashing), 1);
    // The next start removes the unfinished layout; offline, the store still serves its packages.
    const before = registry.requests.length;
    const offline = await start({ home: crashing.home, env: { MOSTRA_OFFLINE: "1" } });
    const receipt = ok<Receipt>(await publish(offline, dir));
    expect(lockOf(offline, receipt.versionId)).toContain('"mostra-fixture-peer": "1.1.0"');
    expect(registry.requests.length).toBe(before);
  });

  it("answers a package the store doesn't hold with MOSTRA_DEP_OFFLINE within a second", async () => {
    const target = await start({ env: { MOSTRA_OFFLINE: "1" } });
    const before = registry.requests.length;
    const dir = artifact({
      "index.tsx":
        'import { label } from "mostra-fixture-util";\nexport default function Page() { return <p>{label}</p>; }\n',
    });
    const started = performance.now();
    const response = await publish(target, dir);
    const elapsed = performance.now() - started;
    expect(response.error?.data.code).toBe("MOSTRA_DEP_OFFLINE");
    expect(response.error?.data.message).toContain("mostra-fixture-util");
    expect(elapsed).toBeLessThan(1000);
    expect(registry.requests.length).toBe(before);
  });

  it("answers an unreachable registry with MOSTRA_DEP_OFFLINE, not a hang", async () => {
    const target = await start({ registryUrl: "http://127.0.0.1:9/" });
    const dir = artifact({
      "index.tsx":
        'import { label } from "mostra-fixture-util";\nexport default function Page() { return <p>{label}</p>; }\n',
    });
    const started = performance.now();
    const response = await publish(target, dir);
    expect(response.error?.data.code).toBe("MOSTRA_DEP_OFFLINE");
    expect(response.error?.data.message).toContain("can't be reached");
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("stops an install that outlives its limit with MOSTRA_DEP_TIMEOUT", async () => {
    const target = await start({ env: { MOSTRA_TEST_INSTALL_TIMEOUT_MS: "4000" } });
    const dir = artifact({ "index.tsx": "export default function Page() { return <p />; }\n" });
    const response = await target.client.call("deps/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-slow"],
    });
    expect(response.error?.data.code).toBe("MOSTRA_DEP_TIMEOUT");
    expect(layouts(target)).toEqual([]);
  });
});

describe("lifecycle scripts (DP-05)", () => {
  it("end with the supervisor: a SIGKILLed supervisor leaves no install child or script running", async () => {
    const target = await start();
    const dir = artifact({ "index.tsx": "export default function Page() { return <p />; }\n" });
    void target.client.call("deps/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-slow"],
    });
    // The slow postinstall writes its PID into the layout it is installed in, then waits.
    const locks = join(target.home.home, "deps", "locks");
    let pidFile: string | undefined;
    await eventually(
      () => {
        for (const layout of existsSync(locks) ? readdirSync(locks) : []) {
          const file = join(locks, layout, "slow.pid");
          if (existsSync(file) && readFileSync(file, "utf8") !== "") pidFile = file;
        }
        return pidFile !== undefined;
      },
      30_000,
      "the slow postinstall",
    );
    const script = Number(readFileSync(pidFile as string, "utf8"));
    expect(alive(script)).toBe(true);
    process.kill(target.daemon.status.pid as number, "SIGKILL");
    await target.daemon.exited;
    running.splice(running.indexOf(target), 1);
    // Nothing restarts the home: the install child ends its group when its channel closes.
    await eventually(() => !alive(script), 10_000, "the script to end");
  });

  it("run in the install child, in the artifact's directory with the artifact environment", async () => {
    const target = await start();
    const dir = artifact({
      "index.tsx":
        'import "mostra-fixture-postinstall";\nexport default function Page() { return <p>installed</p>; }\n',
    });
    // A user's npm settings that would change what D95 promises; Mostra's own settings win.
    writeFileSync(join(target.user, ".npmrc"), "ignore-scripts=true\nshamefully-hoist=true\n");
    ok<Receipt>(await publish(target, dir));
    const [layout] = layouts(target);
    const layoutDir = join(target.home.home, "deps", "locks", layout as string);
    const pnpmDir = join(layoutDir, "node_modules", ".pnpm");
    const record = JSON.parse(
      readFileSync(
        join(
          pnpmDir,
          "mostra-fixture-postinstall@1.0.0",
          "node_modules",
          "mostra-fixture-postinstall",
          "record.json",
        ),
        "utf8",
      ),
    ) as {
      pid: number;
      env: Record<string, string>;
      ancestors: { pid: number; command: string; cwd: string | null }[];
    };
    const supervisor = target.daemon.status.pid as number;
    // The script's ancestry: the shell pnpm runs it in, pnpm, then the install child (connected to
    // the supervisor, D95), then the supervisor.
    const index = record.ancestors.findIndex((process) =>
      process.command.includes("deps/child/install"),
    );
    expect(index).toBeGreaterThanOrEqual(1);
    const installChild = record.ancestors[index];
    const pnpm = record.ancestors[index - 1];
    expect(pnpm?.command).toContain("pnpm.cjs install --frozen-lockfile");
    // On Windows the child's gate (`mostra-win gate`, D150) stands between it and the supervisor.
    const above = WINDOWS ? index + 2 : index + 1;
    if (WINDOWS) expect(record.ancestors[index + 1]?.command).toContain("mostra-win");
    expect(record.ancestors[above]?.pid).toBe(supervisor);
    expect(record.pid).not.toBe(supervisor);
    expect(record.ancestors.slice(0, index).map((process) => process.pid)).not.toContain(
      supervisor,
    );
    // The install child, and pnpm with it, run in the artifact's source directory. Windows shows
    // no process's working directory to another; there INIT_CWD below and the gate's own spawn
    // directory stand for it.
    if (!WINDOWS) {
      expect(installChild?.cwd).toBe(dir);
      expect(pnpm?.cwd).toBe(dir);
    }
    // The artifact environment, not the supervisor's.
    expect(record.env["MOSTRA_TEST_SUPERVISOR_ONLY"]).toBeUndefined();
    expect(record.env[WINDOWS ? "USERPROFILE" : "HOME"]).toBe(target.user);
    expect(record.env["INIT_CWD"]).toBe(layoutDir);
    expect(Object.keys(record.env).filter((name) => name.startsWith("MOSTRA_"))).toEqual([]);
  });
});

describe("gc and the dependency state (VR-06, D140 item 14)", () => {
  interface GcResult {
    readonly dryRun: boolean;
    readonly versions: readonly { readonly number: number }[];
    readonly lockLayouts: { readonly count: number };
    readonly storePackages: { readonly count: number; readonly bytes: number };
    readonly caches: { readonly count: number };
    readonly warnings?: readonly { readonly code: string }[];
  }
  const metadata = (target: Running): string[] => {
    const dir = join(target.home.home, "deps", "cache");
    return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("metadata")) : [];
  };

  it("collects a package only the collected version used, prunes the store through the real installer, and keeps the metadata cache (Opus review finding 1)", async () => {
    const target = await start();
    const dir = artifact({
      "index.tsx":
        'import { label } from "mostra-fixture-util";\nexport default function Page() { return <p>{label}</p>; }\n',
    });
    const v1 = ok<Receipt>(await publish(target, dir));
    expect(lockOf(target, v1.versionId)).toContain("mostra-fixture-util");
    writeFileSync(
      join(dir, "index.tsx"),
      "export default function Page() { return <p>plain</p>; }\n",
    );
    const v2 = ok<Receipt>(await publish(target, dir));
    expect(v2.version).toBe(2);
    const storeFiles = (): number => {
      let total = 0;
      const walk = (path: string): void => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(join(path, entry.name));
          else total += 1;
        }
      };
      walk(join(target.home.home, "deps", "store"));
      return total;
    };
    const cacheBefore = metadata(target);
    expect(cacheBefore.length).toBeGreaterThan(0);
    const filesBefore = storeFiles();
    const planned = ok<GcResult>(await target.client.call("gc/run", { dryRun: true }));
    expect(planned.versions.map((version) => version.number)).toEqual([1]);
    expect(planned.lockLayouts.count).toBe(1);
    expect(planned.storePackages.count).toBeGreaterThan(0);
    const collected = ok<GcResult>(await target.client.call("gc/run", {}));
    expect(collected.warnings).toBeUndefined();
    expect(collected.versions).toEqual(planned.versions);
    expect(collected.lockLayouts.count).toBe(planned.lockLayouts.count);
    expect(collected.storePackages.count).toBe(planned.storePackages.count);
    expect(collected.storePackages.bytes).toBeGreaterThan(0);
    expect(storeFiles()).toBeLessThan(filesBefore);
    expect(layouts(target)).toEqual([]);
    // pnpm's prune empties the metadata cache it's given; the home's, which offline
    // resolution reads (D95), is never it.
    expect(metadata(target)).toEqual(cacheBefore);
    // Nothing is left to collect, and the store's index agrees with the store.
    const again = ok<GcResult>(await target.client.call("gc/run", {}));
    expect(again.storePackages.count).toBe(0);
    expect(again.lockLayouts.count).toBe(0);
    // The collected version comes back on republish, its package installed again.
    writeFileSync(
      join(dir, "index.tsx"),
      'import { label } from "mostra-fixture-util";\nexport default function Page() { return <p>{label}</p>; }\n',
    );
    const back = ok<Receipt>(await publish(target, dir));
    expect(back.versionId).toBe(v1.versionId);
    expect(back.version).toBe(1);
    expect(layouts(target).length).toBe(1);
  }, 180_000);

  it("reports a step it couldn't finish as a warning beside what it removed, and runs the rest (Opus review finding 1)", async () => {
    const target = await start({ env: { MOSTRA_TEST_FAULTS: "gc:dependencies:throw" } });
    const dir = artifact({
      "index.tsx": "export default function Page() { return <p>one</p>; }\n",
    });
    ok<Receipt>(await publish(target, dir));
    writeFileSync(
      join(dir, "index.tsx"),
      "export default function Page() { return <p>two</p>; }\n",
    );
    ok<Receipt>(await publish(target, dir));
    const collected = ok<GcResult>(await target.client.call("gc/run", {}));
    expect(collected.versions.map((version) => version.number)).toEqual([1]);
    expect(collected.warnings?.map((warning) => warning.code)).toEqual([
      "MOSTRA_HOME_GC_INCOMPLETE",
    ]);
    expect(collected.lockLayouts.count).toBe(0);
    // The steps after it still ran.
    expect(collected.caches).toBeDefined();
    const detail = ok<{ versions: { number: number; collected?: string }[] }>(
      await target.client.call("artifact/get", { artifact: { path: dir } }),
    );
    expect(detail.versions.find((version) => version.number === 1)?.collected).toBeDefined();
  }, 120_000);
});
