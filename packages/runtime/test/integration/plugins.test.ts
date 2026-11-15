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
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
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

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");

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
    // With server code, which an exporter must never read (D172 item 11).
    const dir = artifact({
      "actions.ts":
        '"use server";\nexport async function ping(): Promise<number> {\n  return 1;\n}\n',
    });
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
    // The exporter got what its contract promises: the version's facts, the options its schema
    // took, and none of the server code however a path named it (WP-16 review).
    expect(readFileSync(join(out, "words.txt"), "utf8")).toMatch(
      /^artifact: \d+ files, \d+ bytes, \{"size":"a4"\} \{"server":true,"registry":true,"publishedAt":true,"hidden":4,"listed":false\}$/,
    );
    expect([...readFileSync(join(out, "nested", "bytes.bin"))]).toEqual([1, 2, 3]);
    expect(exported.entry).toBe(join(out, "words.txt"));
    expect(exported.findings).toMatchObject([{ code: "COUNTED" }]);

    // Options the schema refuses refuse the export before it runs; nothing is written.
    const badOptions = join(tempDir("plugins-export"), "out");
    const refusedOptions = await target.client.call("plugin/export", {
      artifact: { artifactId: receipt.artifactId },
      exporter: "words",
      out: badOptions,
      options: { size: "a3" },
    });
    expect(code(refusedOptions)).toBe("MOSTRA_PLUGIN_OPTIONS_INVALID");
    expect(existsSync(badOptions)).toBe(false);

    // A `file` exporter writes its one file at `out` itself.
    const file = join(tempDir("plugins-export"), "summary.txt");
    const summary = ok<{ files: string[]; entry: string }>(
      await target.client.call("plugin/export", {
        artifact: { artifactId: receipt.artifactId },
        exporter: "summary",
        out: file,
      }),
    );
    expect(summary.files).toEqual([file]);
    expect(readFileSync(file, "utf8")).toBe("version 1");

    // A file where another needs a directory refuses the whole export, writing nothing.
    const clashed = join(tempDir("plugins-export"), "out");
    const clash = await target.client.call("plugin/export", {
      artifact: { artifactId: receipt.artifactId },
      exporter: "clash",
      out: clashed,
    });
    expect(code(clash)).toBe("MOSTRA_PLUGIN_FAILED");
    expect(clash.error?.data.message).toContain("a file where a directory must be");
    expect(existsSync(clashed)).toBe(false);

    const unknown = await target.client.call("plugin/export", {
      artifact: { artifactId: receipt.artifactId },
      exporter: "nope",
      out: join(tempDir("plugins-export"), "out"),
    });
    expect(code(unknown)).toBe("MOSTRA_PLUGIN_EXPORTER_UNKNOWN");
  });

  it("says an exporter whose child dies failed, and writes nothing", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-crash@1.0.0"],
      }),
    );
    const receipt = ok<{ artifactId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    const out = join(tempDir("plugins-export"), "out");
    const failed = await target.client.call("plugin/export", {
      artifact: { artifactId: receipt.artifactId },
      exporter: "crash",
      out,
    });
    expect(code(failed)).toBe("MOSTRA_PLUGIN_FAILED");
    expect(existsSync(out)).toBe(false);
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
    // An artifact's plugin may contribute an ID the home's plugins do: the artifact uses its
    // own, and says so; a home install never breaks an artifact (D172 item 5).
    const dir = artifact();
    const twin = ok<AddResult>(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words-twin@1.0.0"],
      }),
    );
    expect(twin.plugins[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MOSTRA_PLUGIN_SHADOWED",
    );
    const receipt = ok<{ artifactId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    const out = join(tempDir("plugins-export"), "out");
    const exported = ok<{ exporter: { package: string } }>(
      await target.client.call("plugin/export", {
        artifact: { artifactId: receipt.artifactId },
        exporter: "words",
        out,
      }),
    );
    expect(exported.exporter.package).toBe("mostra-fixture-words-twin");
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
    // No time and no person (D172 item 6): the same acknowledgment made later, in another home,
    // gives the same lockfile, so the same source gives the same version.
    expect(lock).not.toMatch(/\bat: /);
    const other = await start();
    const copy = artifact();
    ok(
      await other.client.call("plugin/add", {
        artifact: { path: copy },
        packages: [plugin],
        acceptLicenses: [license],
      }),
    );
    const copied = ok<{ versionId: string }>(
      await other.client.call("artifact/publish", { source: { path: copy } }),
    );
    expect(
      readFileSync(join(other.home.home, "versions", copied.versionId, "lock.yaml"), "utf8"),
    ).toBe(lock);
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

describe("the plugin gate on every change (WP-16 review)", () => {
  const engineLicense = "LicenseRef-FixtureEngine";

  it("checks a plugin upgrade by mostra add before any of it runs (R01 finding 1)", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    // 1.1.0 brings the engine, whose license nobody acknowledged: deps/add refuses before its
    // postinstall runs, and the artifact keeps 1.0.0.
    const refused = await target.client.call("deps/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-words@1.1.0"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    expect(refused.error?.data.message).toContain("LicenseRef-npm-fixture-engine");
    expect(refused.error?.data.fix?.command).toContain("mostra add mostra-fixture-words@1.1.0");
    expect(find(join(target.home.home, "deps"), "engine-installed.txt")).toEqual([]);
    const listed = ok<{ plugins: { version: string }[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins.map((plugin) => plugin.version)).toEqual(["1.0.0"]);
    // Acknowledged, the upgrade installs, its script runs, and the lockfile records both.
    ok(
      await target.client.call("deps/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.1.0"],
        acceptLicenses: ["LicenseRef-npm-fixture-engine"],
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
    expect(lock).toContain('"mostra-fixture-words": "1.1.0"');
    expect(lock).toContain('"LicenseRef-npm-fixture-engine":');
  });

  it("discloses a peer dependency's license, which the installer installs (R02 finding 4)", async () => {
    const target = await start();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: artifact() },
      packages: ["mostra-fixture-peer-plugin@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    expect(refused.error?.data.message).toContain("fixture-engine@2.0.0");
    expect(find(join(target.home.home, "deps"), "engine-installed.txt")).toEqual([]);
  });

  it("never lets a plugin call a package it can't read OSI-licensed (R03 finding 2)", async () => {
    const target = await start();
    const refused = await target.client.call("plugin/add", {
      artifact: { path: artifact() },
      packages: ["mostra-fixture-claims-mit@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    expect(refused.error?.data.message).toContain("LicenseRef-npm-fixture-closed (proprietary");
    // Acknowledged, it installs, and both claims Mostra couldn't confirm are said as warnings.
    const added = ok<AddResult>(
      await target.client.call("plugin/add", {
        artifact: { path: artifact() },
        packages: ["mostra-fixture-claims-mit@1.0.0"],
        acceptLicenses: ["LicenseRef-npm-fixture-closed"],
      }),
    );
    const warnings = added.plugins[0]?.diagnostics.filter(
      (diagnostic) => diagnostic.code === "MOSTRA_LICENSE_MISMATCH",
    );
    expect(warnings?.length).toBe(2);
  });

  it("asks again for a license whose class changed since it was acknowledged (R01, addendum)", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-engine-plugin@1.0.0"],
        acceptLicenses: [engineLicense],
      }),
    );
    const refused = await target.client.call("plugin/add", {
      artifact: { path: dir },
      packages: ["mostra-fixture-engine-plugin@1.1.0"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    expect(refused.error?.data.message).toContain(`${engineLicense} (proprietary`);
  });

  it("refuses a command another begins with, in one scope (R03, cut by the cap)", async () => {
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
      packages: ["mostra-fixture-words-prefix@1.0.0"],
    });
    expect(code(refused)).toBe("MOSTRA_PLUGIN_CONFLICT");
    expect(refused.error?.data.message).toContain('"words count"');
  });

  it("keeps a plugin another call added while a removal waited (R01 finding 4)", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    // Both at once on one connection: whichever runs second sees what the first recorded.
    const [added, removed] = await Promise.all([
      target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-pack@1.0.0"],
      }),
      target.client.call("plugin/remove", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words"],
      }),
    ]);
    ok(added);
    ok(removed);
    const listed = ok<{ plugins: { package: string }[] }>(
      await target.client.call("plugin/list", { artifact: { path: dir } }),
    );
    expect(listed.plugins.map((plugin) => plugin.package)).toEqual(["mostra-fixture-pack"]);
  });

  it("exports a version with the plugins it was published with, after they left the artifact (R01 finding 6)", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    const receipt = ok<{ artifactId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    ok(
      await target.client.call("plugin/remove", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words"],
      }),
    );
    const out = join(tempDir("plugins-export"), "summary.txt");
    ok(
      await target.client.call("plugin/export", {
        artifact: { artifactId: receipt.artifactId },
        version: 1,
        exporter: "summary",
        out,
      }),
    );
    expect(readFileSync(out, "utf8")).toBe("version 1");
  });

  it("checks licenses again at publish, before plugins load, and records a host's acceptance there (R01 finding 2)", async () => {
    const home = testHome();
    const first = await start({ home });
    const dir = artifact();
    ok(
      await first.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-engine-plugin@1.0.0"],
        acceptLicenses: [engineLicense],
      }),
    );
    await first.client.call("mostra/shutdown", {});
    await first.daemon.exited;
    running.splice(running.indexOf(first), 1);
    // The working lockfile loses its acknowledgment, as a resolution that moved the plugins' tree
    // would leave a license unrecorded.
    const ledger = new Database(join(home.home, "store", "ledger.sqlite"));
    const row = ledger
      .prepare("SELECT key, lock_text FROM dependency_lock WHERE lock_text LIKE '%licenses:%'")
      .get() as { key: string; lock_text: string };
    ledger
      .prepare("UPDATE dependency_lock SET lock_text = ? WHERE key = ?")
      .run(`${row.lock_text.slice(0, row.lock_text.indexOf("licenses:")).trimEnd()}\n`, row.key);
    ledger.close();
    const second = await start({ home });
    const refused = await second.client.call("artifact/publish", { source: { path: dir } });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    // Its fix is a command that runs as given: no placeholder.
    expect(refused.error?.data.fix?.command).toMatch(
      /^mostra plugin add mostra-fixture-engine-plugin --artifact \S+ --accept-license LicenseRef-FixtureEngine$/,
    );
    await second.client.call("mostra/shutdown", {});
    await second.daemon.exited;
    running.splice(running.indexOf(second), 1);
    // A host that accepts the license: the publish records the acceptance as the host's.
    const third = await start({
      home,
      initialize: {
        client: { name: "fixture-host", version: "1" },
        home: { path: home.home, licenses: { accept: [engineLicense] } },
      },
    });
    const receipt = ok<{ versionId: string }>(
      await third.client.call("artifact/publish", { source: { path: dir } }),
    );
    const lock = readFileSync(join(home.home, "versions", receipt.versionId, "lock.yaml"), "utf8");
    expect(lock).toContain(`"${engineLicense}":`);
    expect(lock).toMatch(/by: "?host"?/);
  });

  it("validates a package's entries only once its licenses are acknowledged (R01 finding 10)", async () => {
    const target = await start();
    const marker = "entry-loaded.txt";
    const dir = packageDir({
      "package.json": JSON.stringify({
        name: "mostra-fixture-validate-engine",
        version: "1.0.0",
        type: "module",
        license: "MIT",
        dependencies: { "fixture-closed": "1.0.0" },
        mostra: {
          name: "dev.mostra.fixtures/validate-engine",
          contracts: { exporter: `^${implemented("exporter")}` },
          contributes: { exporters: [{ id: "v", entry: "./exporter.js" }] },
          license: "MIT",
        },
      }),
      "exporter.js": `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./${marker}", import.meta.url), "yes");\nexport default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "v", output: { mediaType: "text/plain", layout: "directory" }, async export() { return { files: [] }; } };\n`,
      "node_modules/fixture-closed/package.json": JSON.stringify({
        name: "fixture-closed",
        version: "1.0.0",
        license: "UNLICENSED",
      }),
    });
    const blocked = ok<{ valid: boolean; diagnostics: { code: string }[] }>(
      await target.client.call("plugin/validate", { path: dir }),
    );
    expect(blocked.valid).toBe(false);
    expect(blocked.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MOSTRA_LICENSE_UNACCEPTED",
    );
    expect(existsSync(join(dir, marker))).toBe(false);
    const loaded = ok<{ valid: boolean }>(
      await target.client.call("plugin/validate", {
        path: dir,
        acceptLicenses: ["LicenseRef-npm-fixture-closed"],
      }),
    );
    expect(loaded.valid).toBe(true);
    expect(existsSync(join(dir, marker))).toBe(true);
  });

  it("finds a plugin's commands without installing anything (R01, addendum)", async () => {
    const target = await start();
    const dir = artifact();
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-words@1.0.0"],
      }),
    );
    const locks = join(target.home.home, "deps", "locks");
    const layouts = readdirSync(locks);
    for (const layout of layouts) rmSync(join(locks, layout), { recursive: true, force: true });
    const commands = ok<{ commands: unknown[] }>(
      await target.client.call("plugin/commands", { artifact: { path: dir } }),
    );
    expect(commands.commands).toEqual([]);
    expect(readdirSync(locks)).toEqual([]);
  });
});
