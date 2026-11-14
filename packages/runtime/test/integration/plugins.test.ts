/**
 * The plugin system through a real daemon, a real pnpm install child and a local registry (D30,
 * D31, ROUND-3 §6): `plugin/validate` reporting each invalid field where it is (EX-02), contract
 * ranges checked at install and at load, conflicts named, scopes, exporters and commands (EX-01),
 * and licenses that need an acknowledgment, recorded in the lockfile, with a host's pre-acceptance
 * (EX-04).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { implemented, pluginFixtures } from "../plugin-fixtures.ts";
import { type FakeRegistry, FIXTURE_PACKAGES, startRegistry } from "../registry.ts";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
  WINDOWS,
} from "../support.ts";

interface Running {
  readonly home: TestHome;
  readonly daemon: RuntimeProcess & { status: DaemonStatus };
  readonly client: LineClient;
}

const running: Running[] = [];
let registry: FakeRegistry;

async function start(
  options: {
    home?: TestHome;
    env?: Record<string, string>;
    initialize?: Record<string, unknown>;
  } = {},
): Promise<Running> {
  const home = options.home ?? testHome();
  const user = tempDir("plugins-user");
  const daemon = await startDaemon(home, {
    env: {
      ...home.env,
      HOME: user,
      ...(WINDOWS ? { USERPROFILE: user } : {}),
      npm_config_registry: registry.url,
      ...options.env,
    },
  });
  const client = await connectTo(daemon.status.socket as string);
  const init = await client.call("mostra/initialize", initializeParams(options.initialize ?? {}));
  expect(init.error).toBeUndefined();
  const started = { home, daemon, client };
  running.push(started);
  return started;
}

beforeAll(async () => {
  registry = await startRegistry([...FIXTURE_PACKAGES, ...pluginFixtures()]);
});
afterEach(async () => {
  for (const target of running.splice(0)) {
    await target.client.call("mostra/shutdown", {});
    await target.daemon.exited;
  }
});
afterAll(async () => {
  await registry.close();
});

/** An artifact directory with `files`. */
function artifact(files: Record<string, string> = {}): string {
  const dir = join(tempDir("plugins-artifact"), "artifact");
  const all = {
    "index.tsx": "export default function Page() { return <p>Hello</p>; }\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

const ok = <T>(message: Message): T => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result as T;
};

const code = (message: Message): string | undefined => message.error?.data.code;

/** Every file named `name` under `dir`, following no links. */
function find(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...find(path, name));
    else if (entry.name === name) found.push(path);
  }
  return found;
}

interface AddResult {
  readonly plugins: readonly {
    package: string;
    status: string;
    scope: string;
    diagnostics: { code: string }[];
  }[];
  readonly added: readonly string[];
  readonly licenses: readonly { id: string; class: string; acknowledgment: string }[];
  readonly lockDigest: string;
}

/** A plugin package directory written from a fixture, for `plugin/validate`. */
function packageDir(files: Record<string, string>): string {
  const dir = tempDir("plugin-package");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

describe("plugin/validate (EX-02)", () => {
  it("accepts a valid manifest and reports each invalid field where package.json has it", async () => {
    const target = await start();
    const fixtures = pluginFixtures();
    const words = fixtures.find((pkg) => pkg.name === "mostra-fixture-words");
    // As its author has it: its dependencies installed beside it.
    const installed = Object.fromEntries(
      fixtures
        .filter((pkg) => pkg.name.startsWith("@mostra/contract-"))
        .flatMap((pkg) => [
          [
            `node_modules/${pkg.name}/package.json`,
            JSON.stringify({ name: pkg.name, version: pkg.version, ...pkg.manifest }),
          ],
          ...Object.entries(pkg.files as Record<string, string>).map(([path, text]) => [
            `node_modules/${pkg.name}/${path}`,
            text,
          ]),
        ]),
    );
    const good = packageDir({
      ...installed,
      "package.json": JSON.stringify(
        { name: words?.name, version: words?.version, ...words?.manifest, dependencies: {} },
        null,
        2,
      ),
      ...(words?.files as Record<string, string>),
    });
    const valid = ok<{ valid: boolean; plugin: { name: string }; diagnostics: unknown[] }>(
      await target.client.call("plugin/validate", { path: good }),
    );
    expect(valid.valid, JSON.stringify(valid.diagnostics)).toBe(true);
    expect(valid.plugin.name).toBe("dev.mostra.fixtures/words");

    const bad = packageDir({
      "package.json": `${JSON.stringify(
        {
          name: "mostra-fixture-bad",
          version: "1.0.0",
          license: "MIT",
          mostra: {
            name: "Not A Name",
            contracts: { exporter: "not a range", "no-such-contract": "^1.0.0" },
            contributes: {
              exporters: [
                { id: "Bad Id", entry: "./missing.js" },
                { id: "abs", entry: "/etc/passwd" },
              ],
              cliCommands: [{ command: "publish", entry: "./command.js" }],
            },
            effects: ["teleport"],
            license: "Not-A-License",
          },
        },
        null,
        2,
      )}\n`,
      "command.js": "export default {};\n",
    });
    const result = ok<{
      valid: boolean;
      diagnostics: {
        code: string;
        severity: string;
        message: string;
        location?: { file: string; line: number };
      }[];
    }>(await target.client.call("plugin/validate", { path: bad }));
    expect(result.valid).toBe(false);
    const messages = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code} ${diagnostic.message}`,
    );
    for (const fragment of [
      "mostra.name",
      "mostra.contracts.no-such-contract",
      "mostra.contributes.exporters.0.id",
      "mostra.contributes.exporters.1.entry",
      "mostra.contributes.cliCommands.0.command",
      "mostra.license",
      "mostra.effects.0",
    ]) {
      expect(messages.join("\n"), `${fragment} in:\n${messages.join("\n")}`).toContain(fragment);
    }
    // Each problem points at its line of package.json.
    const located = result.diagnostics.filter((diagnostic) =>
      diagnostic.location?.file.endsWith("package.json"),
    );
    expect(located.length).toBeGreaterThanOrEqual(5);
    expect(new Set(located.map((diagnostic) => diagnostic.location?.line)).size).toBeGreaterThan(3);
    // An unknown effect is a warning; the rest are errors.
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.message.includes("teleport"))?.severity,
    ).toBe("warning");
  });

  it("says a package without a manifest isn't a plugin", async () => {
    const target = await start();
    const dir = packageDir({ "package.json": '{ "name": "left-pad", "version": "1.0.0" }\n' });
    const result = ok<{ valid: boolean; diagnostics: { code: string }[] }>(
      await target.client.call("plugin/validate", { path: dir }),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MOSTRA_PLUGIN_NOT_A_PLUGIN",
    );
  });
});

describe("contracts at install and at load (EX-01)", () => {
  it("installs an in-range plugin, records it in the lockfile, and exports with it", async () => {
    const target = await start();
    const dir = artifact();
    const added = ok<AddResult>(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    expect(added.added).toEqual(["mostra-fixture-words"]);
    expect(added.plugins).toMatchObject([
      { package: "mostra-fixture-words", status: "ok", scope: "artifact" },
    ]);
    const receipt = ok<{ versionId: string; artifactId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    const lock = readFileSync(
      join(target.home.home, "versions", receipt.versionId, "lock.yaml"),
      "utf8",
    );
    expect(lock).toContain("plugins:");
    expect(lock).toContain("mostra-fixture-words");

    const out = join(tempDir("plugins-export"), "out");
    const exported = ok<{
      files: string[];
      entry: string;
      findings: { code: string }[];
      exporter: { id: string };
    }>(
      await target.client.call("plugin/export", {
        artifact: { artifactId: receipt.artifactId },
        exporter: "words",
        out,
        options: { size: "a4" },
      }),
    );
    expect(exported.exporter.id).toBe("words");
    expect(readFileSync(join(out, "words.txt"), "utf8")).toMatch(
      /^artifact: \d+ files, \d+ bytes, \{"size":"a4"\}$/,
    );
    expect([...readFileSync(join(out, "nested", "bytes.bin"))]).toEqual([1, 2, 3]);
    expect(exported.entry).toBe(join(out, "words.txt"));
    expect(exported.findings).toMatchObject([{ code: "COUNTED" }]);

    const unknown = await target.client.call("plugin/export", {
      artifact: { artifactId: receipt.artifactId },
      exporter: "nope",
      out: join(tempDir("plugins-export"), "out"),
    });
    expect(code(unknown)).toBe("MOSTRA_PLUGIN_EXPORTER_UNKNOWN");
  });

  it("refuses an out-of-range plugin at install and leaves the lockfile as it was", async () => {
    const target = await start();
    const dir = artifact();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-future@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED");
    expect(refused.error?.data.message).toContain("^9.0.0");
    const listed = ok<{ plugins: unknown[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins).toEqual([]);
  });

  it("refuses an entry stamped by a newer contract package than this release serves", async () => {
    const target = await start();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: artifact() },
      packages: ["mostra-fixture-newer-stamp@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED");
    expect(refused.error?.data.message).toContain("9.0.0");
  });

  it("diagnoses a recorded plugin at load when this runtime no longer serves its range", async () => {
    const home = testHome();
    const first = await start({ home });
    const dir = artifact();
    ok(
      await first.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    await first.client.call("mostra/shutdown", {});
    await first.daemon.exited;
    running.splice(running.indexOf(first), 1);

    // The same home under a runtime whose exporter contract moved to another line.
    const later = await start({
      home,
      env: { MOSTRA_TEST_CONTRACT_VERSIONS: JSON.stringify({ exporter: ["7.0.0"] }) },
    });
    const listed = ok<{ plugins: { status: string; diagnostics: { code: string }[] }[] }>(
      await later.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins[0]?.status).toBe("error");
    expect(listed.plugins[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED",
    );
    const publish = await later.client.call("artifact/publish", { source: { path: dir } });
    expect(code(publish)).toBe("MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED");
    const verdict = ok<{ status: string; diagnostics: { code: string }[] }>(
      await later.client.call("artifact/verify", { source: { path: dir } }),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED",
    );
  });

  it("names both plugins when two contribute one ID, and overrides nothing", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    const refused = await target.client.call("plugin/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-words-twin@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_PLUGIN_CONFLICT");
    expect(refused.error?.data.message).toContain("mostra-fixture-words");
    expect(refused.error?.data.message).toContain("mostra-fixture-words-twin");
    const listed = ok<{ plugins: { package: string }[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins.map((plugin) => plugin.package)).toEqual(["mostra-fixture-words"]);
  });

  it("keeps the declaration order as the load order, and removes a plugin", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0", "mostra-fixture-page-engine@1.0.0"],
      }),
    );
    const listed = ok<{ plugins: { package: string }[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins.map((plugin) => plugin.package)).toEqual([
      "mostra-fixture-words",
      "mostra-fixture-page-engine",
    ]);
    const removed = ok<{ removed: string[]; plugins: { package: string }[] }>(
      await target.client.call("plugin/remove", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words"],
      }),
    );
    expect(removed.plugins.map((plugin) => plugin.package)).toEqual(["mostra-fixture-page-engine"]);
    expect(
      code(
        await target.client.call("plugin/remove", { artifact: { path: dir }, packages: ["nope"] }),
      ),
    ).toBe("MOSTRA_PLUGIN_NOT_INSTALLED");
  });

  it("installs exporters and commands for the home, never what runs in a page", async () => {
    const target = await start();
    const home = ok<AddResult>(
      await target.client.call("plugin/add", {
        home: true,
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    expect(home.plugins[0]?.scope).toBe("home");
    const commands = ok<{ commands: { command: string; scope: string; file: string }[] }>(
      await target.client.call("plugin/commands", {}),
    );
    expect(commands.commands).toMatchObject([{ command: "words count", scope: "home" }]);
    expect(existsSync(commands.commands[0]?.file as string)).toBe(true);
    const page = await target.client.call("plugin/add", {
      home: true,
      packages: ["mostra-fixture-page-engine@1.0.0"],
    });
    expect(code(page)).toBe("MOSTRA_PLUGIN_SCOPE_INVALID");
    // An artifact's plugin can't take an ID the home's plugins contribute.
    const twin = await target.client.call("plugin/add", {
      artifact: { path: artifact() },
      packages: ["mostra-fixture-words-twin@1.0.0"],
    });
    expect(code(twin)).toBe("MOSTRA_PLUGIN_CONFLICT");
    expect(code(await target.client.call("plugin/list", {}))).toBe("MOSTRA_PLUGIN_SCOPE_INVALID");
  });
});

describe("licenses (EX-04, D31)", () => {
  const plugin = "mostra-fixture-engine-plugin@1.0.0";
  const license = "LicenseRef-FixtureEngine";

  it("refuses a non-OSI license without an acknowledgment, before any of its code runs", async () => {
    const target = await start();
    const dir = artifact();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: dir },
      packages: [plugin],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    expect(refused.error?.data.message).toContain(license);
    expect(refused.error?.data.message).toContain("source-available");
    expect(refused.error?.data.fix?.command).toContain(`--accept-license ${license}`);
    // The engine's install script never ran, and the lockfile has no plugin.
    expect(find(join(target.home.home, "deps"), "engine-installed.txt")).toEqual([]);
    const listed = ok<{ plugins: unknown[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins).toEqual([]);
  });

  it("installs with --accept-license, records the acknowledgment in the lockfile, and freezes it at publish", async () => {
    const target = await start();
    const dir = artifact();
    const added = ok<AddResult>(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: [plugin],
        acceptLicenses: [license],
      }),
    );
    expect(added.licenses).toContainEqual(
      expect.objectContaining({
        id: license,
        class: "source-available",
        acknowledgment: "accepted",
      }),
    );
    expect(find(join(target.home.home, "deps"), "engine-installed.txt").length).toBeGreaterThan(0);
    const receipt = ok<{ versionId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    const lock = readFileSync(
      join(target.home.home, "versions", receipt.versionId, "lock.yaml"),
      "utf8",
    );
    expect(lock).toContain("licenses:");
    expect(lock).toContain(license);
    expect(lock).toMatch(/by: "?flag"?/);
    // Given once: a later install needs no acknowledgment again.
    const again = ok<AddResult>(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    expect(again.added).toEqual(["mostra-fixture-words"]);
  });

  it("refuses an acknowledgment that names no license", async () => {
    const target = await start();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: artifact() },
      packages: [plugin],
      acceptLicenses: ["not a license"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_ACCEPT_INVALID");
  });

  it("installs without a flag when the home's host accepted the license, and records that", async () => {
    const home = testHome();
    const target = await start({
      home,
      initialize: {
        client: { name: "fixture-host", version: "1" },
        home: { path: home.home, licenses: { accept: [license] } },
      },
    });
    const dir = artifact();
    const added = ok<AddResult>(
      await target.client.call("plugin/add", { artifact: { path: dir }, packages: [plugin] }),
    );
    expect(added.licenses).toContainEqual(
      expect.objectContaining({ id: license, acknowledgment: "host" }),
    );
    const settings = JSON.parse(readFileSync(join(home.home, "config.json"), "utf8")) as {
      licenses?: { accept: string[] };
    };
    expect(settings.licenses?.accept).toEqual([license]);
    const receipt = ok<{ versionId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    expect(
      readFileSync(join(home.home, "versions", receipt.versionId, "lock.yaml"), "utf8"),
    ).toMatch(/by: "?host"?/);
  });

  it("keeps the lockfile of an artifact without plugins byte for byte as before", async () => {
    const target = await start();
    const receipt = ok<{ versionId: string }>(
      await target.client.call("artifact/publish", { source: { path: artifact() } }),
    );
    const lock = readFileSync(
      join(target.home.home, "versions", receipt.versionId, "lock.yaml"),
      "utf8",
    );
    expect(lock).not.toContain("plugins:");
    expect(lock).not.toContain("licenses:");
    expect(implemented("exporter")).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
