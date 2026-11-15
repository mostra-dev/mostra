/**
 * Plugins and packs through the built `mostra` (D30, D31): a home's plugin installed from a
 * registry, its CLI command run as a command of `mostra`, its exporter through `export --as`, a
 * license acknowledged with `--accept-license`, and an item copied in by `mostra add`. The
 * registry is the runtime's test registry, in a process of its own.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cli, envelope, type TestHome, testHome } from "../support.ts";

const REGISTRY = fileURLToPath(
  new URL("../../../runtime/test/registry-process.ts", import.meta.url),
);

let registry: ChildProcess;
let url = "";
let home: TestHome;

beforeAll(async () => {
  registry = spawn(process.execPath, [REGISTRY], { stdio: ["pipe", "pipe", "inherit"] });
  const line = await new Promise<string>((resolve, reject) => {
    registry.once("error", reject);
    createInterface({ input: registry.stdout as NodeJS.ReadableStream }).once("line", resolve);
  });
  url = (JSON.parse(line) as { url: string }).url;
  home = testHome({ npm_config_registry: url });
}, 60_000);

afterAll(async () => {
  await cli(["daemon", "stop", "--json"], { env: home.env });
  await home.cleanup();
  registry.stdin?.end();
});

const json = async (args: string[], cwd?: string) => {
  const ran = await cli([...args, "--json"], { env: home.env, ...(cwd ? { cwd } : {}) });
  return { ran, value: envelope(ran) };
};

/** An artifact directory with an entry. */
function artifact(name: string): string {
  const dir = join(home.root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.tsx"), "export default function Page() { return <p>Hi</p>; }\n");
  return dir;
}

describe("plugins through mostra (D30)", () => {
  it("installs a home plugin, runs its command as mostra's own and exports with it", async () => {
    const added = await json(["plugin", "add", "mostra-fixture-words@1.0.0", "--global"]);
    expect(added.ran.code, added.ran.stderr).toBe(0);
    expect(added.value.result).toMatchObject({ added: ["mostra-fixture-words"] });

    // A plugin's command, from anywhere, its call reaching the home's daemon.
    const counted = await json(["words", "count", "one", "two", "three"]);
    expect(counted.ran.code, `${counted.ran.stderr}\n${counted.ran.stdout}`).toBe(0);
    expect(counted.value.result).toMatchObject({ count: 3 });
    expect(typeof (counted.value.result as { pid: unknown }).pid).toBe("number");
    // Help lists it beside mostra's own when it runs.
    const help = await cli(["words", "count", "--help"], { env: home.env });
    expect(help.stdout).toContain("Count the words of a sentence.");
    // Words no plugin and no command of mostra's take stay unknown.
    const unknown = await json(["wordz"]);
    expect(unknown.value.error?.code).toBe("MOSTRA_CLI_UNKNOWN_COMMAND");

    const dir = artifact("words-artifact");
    expect((await json(["publish", dir])).ran.code).toBe(0);
    // An option the exporter's schema doesn't take refuses the export; one it takes reaches it.
    const refused = await json([
      "export",
      dir,
      "--as",
      "words",
      "--out",
      join(home.root, "refused-out"),
      "--option",
      "pages=2",
    ]);
    expect(refused.ran.code).toBe(1);
    expect(refused.value.error?.code).toBe("MOSTRA_PLUGIN_OPTIONS_INVALID");
    const out = join(home.root, "words-out");
    const exported = await json([
      "export",
      dir,
      "--as",
      "words",
      "--out",
      out,
      "--option",
      "size=letter",
    ]);
    expect(exported.ran.code, exported.ran.stderr).toBe(0);
    expect(readFileSync(join(out, "words.txt"), "utf8")).toContain('{"size":"letter"}');

    const listed = await json(["plugin", "list", "--global"]);
    expect(listed.value.result).toMatchObject({ plugins: [{ package: "mostra-fixture-words" }] });
    const removed = await json(["plugin", "remove", "mostra-fixture-words", "--global"]);
    expect(removed.ran.code).toBe(0);
    expect((await json(["words", "count", "a"])).value.error?.code).toBe(
      "MOSTRA_CLI_UNKNOWN_COMMAND",
    );
  }, 240_000);

  it("refuses a license until --accept-license names it, then records it (EX-04)", async () => {
    const dir = artifact("engine-artifact");
    const refused = await json([
      "plugin",
      "add",
      "mostra-fixture-engine-plugin@1.0.0",
      "--artifact",
      dir,
    ]);
    expect(refused.ran.code).toBe(1);
    expect(refused.value.error?.code).toBe("MOSTRA_LICENSE_UNACCEPTED");
    const command = (refused.value.error as { fix?: { command?: string } } | undefined)?.fix
      ?.command as string;
    expect(command).toContain("--accept-license LicenseRef-FixtureEngine");
    // The fix, run as given, installs it.
    const words = shellWords(command).slice(1);
    const accepted = await json(words);
    expect(
      accepted.ran.code,
      `${command}\n${JSON.stringify(accepted.value.error ?? null)}\n${accepted.ran.stderr}`,
    ).toBe(0);
    expect((accepted.value.result as { licenses: unknown[] }).licenses).toContainEqual(
      expect.objectContaining({ id: "LicenseRef-FixtureEngine", acknowledgment: "accepted" }),
    );
  }, 240_000);

  it("copies an item into the artifact with mostra add", async () => {
    const dir = artifact("item-artifact");
    const item = join(home.root, "greeting.json");
    writeFileSync(
      item,
      JSON.stringify({
        name: "greeting",
        type: "registry:component",
        files: [
          {
            path: "greeting.tsx",
            type: "registry:component",
            content: "export const Greeting = () => <p>hi</p>;\n",
          },
        ],
      }),
    );
    const added = await json(["add", "./greeting.json", "--artifact", dir], home.root);
    expect(added.ran.code, added.ran.stderr).toBe(0);
    expect(added.value.result).toMatchObject({
      files: [{ path: "components/greeting.tsx", action: "created" }],
    });
    expect(existsSync(join(dir, "components", "greeting.tsx"))).toBe(true);
  }, 120_000);
});

/**
 * A fix command's words as the shell an agent pastes it into reads them: POSIX single quotes
 * (with `'\\''` for a quote), and the double quotes Mostra writes on Windows.
 */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] as string;
    if (char === " ") {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'" || char === '"') {
      const end = command.indexOf(char, i + 1);
      word = (word ?? "") + command.slice(i + 1, end);
      i = end;
    } else if (char === "\\" && command[i + 1] === "'") {
      word = `${word ?? ""}'`;
      i += 1;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}
