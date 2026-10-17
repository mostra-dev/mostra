/**
 * Server code's packages run from their own directories (D135, AC-01): the server bundle keeps
 * package imports external, and the worker resolves them from the layout the version was built
 * against, so a native addon loads, a package finds the files beside it, React exists once, and a
 * version whose warm packages the runtime no longer holds runs against the ones it locked. Through a
 * real daemon, a local registry (no network) and real workers.
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPage } from "../action-page.ts";
import { GatewayHome } from "../gateway-home.ts";
import {
  type FakeRegistry,
  FIXTURE_PACKAGES,
  type FixturePackage,
  startRegistry,
} from "../registry.ts";
import { tempDir } from "../support.ts";

const WARM = fileURLToPath(new URL("../../../warm", import.meta.url));

/** A prebuilt N-API addon to stand in for any native package (better-sqlite3's, MIT). */
function prebuiltAddon(): Uint8Array {
  const root = join(
    realpathSync(join(WARM, "..", "runtime", "node_modules", "better-sqlite3")),
    "prebuilds",
  );
  return readFileSync(join(root, `${process.platform}-${process.arch}.node`));
}

const PACKAGES: readonly FixturePackage[] = [
  ...FIXTURE_PACKAGES,
  {
    name: "mostra-fixture-self",
    version: "1.0.0",
    manifest: { type: "module", main: "index.js" },
    files: {
      "index.js": [
        'import { readFileSync } from "node:fs";',
        "export function greeting() {",
        '  return readFileSync(new URL("./greeting.txt", import.meta.url), "utf8").trim();',
        "}",
        "",
      ].join("\n"),
      "greeting.txt": "hello from beside the package\n",
    },
  },
  {
    name: "mostra-fixture-cjs-self",
    version: "1.0.0",
    manifest: { main: "index.js" },
    files: {
      "index.js": [
        'const { readFileSync } = require("node:fs");',
        'const { join } = require("node:path");',
        'exports.data = () => readFileSync(join(__dirname, "data.txt"), "utf8").trim();',
        "",
      ].join("\n"),
      "data.txt": "commonjs data\n",
    },
  },
  {
    name: "mostra-fixture-native",
    version: "1.0.0",
    manifest: { main: "index.js" },
    files: {
      "index.js": 'module.exports = require("./build/Release/addon.node");\n',
      "build/Release/addon.node": prebuiltAddon(),
    },
  },
  // The version the warm set holds today, served under the same name, so a version whose runtime
  // moved on can install what it locked.
  {
    name: "cn",
    version: JSON.parse(readFileSync(join(WARM, "node_modules", "cn", "package.json"), "utf8"))
      .version as string,
    manifest: { type: "module", main: "index.js" },
    files: { "index.js": 'export const mostraMarker = "pinned";\nexport const cn = () => "";\n' },
  },
];

/** A warm set like the runtime's, but holding another version of `cn`: a runtime that moved on. */
function movedWarmSet(): string {
  const dir = tempDir("moved-warm");
  cpSync(join(WARM, "package.json"), join(dir, "package.json"));
  const modules = join(dir, "node_modules");
  mkdirSync(modules);
  const real = join(WARM, "node_modules");
  for (const entry of readdirSync(real)) {
    if (entry === "cn" || entry === ".bin") continue;
    symlinkSync(realpathSync(join(real, entry)), join(modules, entry));
  }
  mkdirSync(join(modules, "cn"));
  writeFileSync(
    join(modules, "cn", "package.json"),
    JSON.stringify({ name: "cn", version: "9.9.9", type: "module", main: "index.js" }),
  );
  writeFileSync(
    join(modules, "cn", "index.js"),
    'export const mostraMarker = "moved";\nexport const cn = () => "";\n',
  );
  return dir;
}

describe("server code's packages (D135, AC-01)", () => {
  const gateway = new GatewayHome();
  let registry: FakeRegistry;
  let env: NodeJS.ProcessEnv;
  let published: Awaited<ReturnType<GatewayHome["publish"]>>;

  beforeAll(async () => {
    registry = await startRegistry(PACKAGES);
    env = {
      HOME: tempDir("server-packages-user"),
      npm_config_registry: registry.url,
      MOSTRA_TEST_WORKER_IDLE_MS: "1500",
    };
    await gateway.start({ env });
    published = await gateway.publish("server-packages");
  }, 300_000);

  afterAll(async () => {
    await gateway.stop();
    await registry.close();
  });

  const lockLayout = (): string => {
    const lock = readFileSync(
      join(gateway.home.home, "versions", published.versionId, "lock.yaml"),
    );
    return join(
      gateway.home.home,
      "deps",
      "locks",
      createHash("sha256").update(lock).digest("hex"),
    );
  };

  it("keeps package imports out of the server bundle, which imports them by name", () => {
    const entry = readFileSync(
      join(gateway.home.home, "versions", published.versionId, "server", "entry.mjs"),
      "utf8",
    );
    for (const name of ["mostra-fixture-native", "mostra-fixture-self", "react", "cn"]) {
      expect(entry).toMatch(new RegExp(`from ["']${name}["']`));
    }
    expect(entry).not.toContain("hello from beside the package");
  });

  it("runs packages from their own directories: a native addon, their own files, one React", async () => {
    const page = await openPage(published.url);
    expect((await page.call("actions.ts#ownFiles", [])).value).toEqual({
      esm: "hello from beside the package",
      cjs: "commonjs data",
    });
    expect((await page.call("actions.ts#addon", [])).value).toBe("function");
    // The package's hooks and the bundle's React are one React: two would throw here.
    expect((await page.call("actions.ts#render", [])).value).toContain("clicks");
    expect((await page.call("actions.ts#warmCopy", [])).value).toBe("warm");
  }, 120_000);

  it("installs a removed layout again from the store before the worker starts", async () => {
    const layout = lockLayout();
    expect(existsSync(layout)).toBe(true);
    await gateway.stop();
    rmSync(layout, { recursive: true, force: true });
    const before = registry.requests.length;
    await gateway.start({ env });
    const page = await openPage(published.url);
    expect((await page.call("actions.ts#addon", [])).value).toBe("function");
    expect(existsSync(join(layout, ".mostra-layout"))).toBe(true);
    // From the home's store: no package was downloaded again.
    expect(registry.requests.slice(before).filter((path) => path.endsWith(".tgz"))).toEqual([]);
  }, 120_000);

  it("runs a version against the warm packages it locked after the runtime's moved on", async () => {
    await gateway.stop();
    await gateway.start({ env: { ...env, MOSTRA_WARM_DIR: movedWarmSet() } });
    const page = await openPage(published.url);
    // The moved warm set holds cn 9.9.9; the version locked the earlier one, installed for it.
    expect((await page.call("actions.ts#warmCopy", [])).value).toBe("pinned");
    expect((await page.call("actions.ts#addon", [])).value).toBe("function");
    expect((await page.call("actions.ts#render", [])).value).toContain("clicks");
    const locks = readdirSync(join(gateway.home.home, "deps", "locks"));
    expect(locks.some((name) => name.startsWith("pinned-"))).toBe(true);
  }, 120_000);
});
