/**
 * The harness-plugin generator (AX-10, D147, WP-14): it builds a plugin every harness's checks
 * pass, and each check goes red on its violation.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPlugin, writeTree } from "../plugins/build.ts";
import { checkPlugin } from "../plugins/check.ts";
import { PLUGIN, type PluginDefinition } from "../plugins/definition.ts";
import { publishPlugin } from "../plugins/publish.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** A repository with what the generator reads: the Skill, the license files, the CLI reference. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-root-"));
  cpSync(join(REPO, "skills"), join(root, "skills"), { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) cpSync(join(REPO, file), join(root, file));
  mkdirSync(join(root, "docs", "reference"), { recursive: true });
  writeFileSync(join(root, "docs", "reference", "cli.md"), "# The mostra CLI\n\n## mostra new\n");
  return root;
}

const input = (root: string, telemetryEndpoint = "", version = "1.2.3") => ({
  root,
  version,
  telemetryEndpoint,
});

function built(
  definition: PluginDefinition = PLUGIN,
  root = repository(),
  endpoint = "",
  version = "1.2.3",
) {
  const dir = join(mkdtempSync(join(tmpdir(), "plugin-")), "mostra");
  writeTree(buildPlugin(definition, input(root, endpoint, version)), dir);
  return {
    dir,
    root,
    check: () => checkPlugin(dir, definition, input(root, endpoint, version)),
  };
}

const readJson = (dir: string, path: string) =>
  JSON.parse(readFileSync(join(dir, path), "utf8")) as Record<string, unknown>;

describe("the harness plugins (AX-10)", () => {
  it("builds one plugin whose manifests and rules hold for every harness", () => {
    const { dir, check } = built();
    expect(check()).toEqual([]);
    expect(readJson(dir, "plugin.json")).toMatchObject({ name: "mostra", version: "1.2.3" });
    expect(readJson(dir, ".claude-plugin/plugin.json")).toMatchObject({ name: "mostra" });
    expect(readJson(dir, "gemini-extension.json")).toMatchObject({ name: "mostra" });
    // The Skill is a real copy, byte for byte.
    expect(readFileSync(join(dir, "skills/mostra/SKILL.md"))).toEqual(
      readFileSync(join(REPO, "skills/mostra/SKILL.md")),
    );
    // Features off: no MCP server anywhere, and the README says this release sends nothing.
    expect(readJson(dir, "gemini-extension.json")["mcpServers"]).toBeUndefined();
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("sends no usage data");
  });

  it("refuses a link, a hook, another version, a changed Skill or a missing disclosure", () => {
    const seeds: [string, (dir: string) => void, RegExp][] = [
      ["link", (dir) => symlinkSync("SKILL.md", join(dir, "skills/mostra/LINK.md")), /is a link/],
      ["hooks", (dir) => mkdirSync(join(dir, "hooks")), /hooks directory/],
      [
        "hook in a manifest",
        (dir) => {
          const manifest = readJson(dir, ".claude-plugin/plugin.json");
          writeFileSync(
            join(dir, ".claude-plugin/plugin.json"),
            JSON.stringify({ ...manifest, hooks: {} }),
          );
        },
        /declares hooks/,
      ],
      [
        "version",
        (dir) => {
          const manifest = readJson(dir, "gemini-extension.json");
          writeFileSync(
            join(dir, "gemini-extension.json"),
            JSON.stringify({ ...manifest, version: "1.2.2" }),
          );
        },
        /gemini-extension.json is at 1.2.2/,
      ],
      [
        "schema",
        (dir) => {
          const manifest = readJson(dir, "plugin.json");
          writeFileSync(
            join(dir, "plugin.json"),
            JSON.stringify({ ...manifest, hooks: "./h.json" }),
          );
        },
        /Agent Plugins schema/,
      ],
      [
        "Skill",
        (dir) => writeFileSync(join(dir, "skills/mostra/SKILL.md"), "changed"),
        /differs from the repository's/,
      ],
      [
        "disclosure",
        (dir) => {
          const text = readFileSync(join(dir, "README.md"), "utf8");
          writeFileSync(join(dir, "README.md"), text.replaceAll("cdn.playwright.dev", "a CDN"));
        },
        /doesn't disclose cdn.playwright.dev/,
      ],
      [
        "upgrade prompt",
        (dir) => {
          const text = readFileSync(join(dir, "README.md"), "utf8");
          writeFileSync(join(dir, "README.md"), `${text}\nUpgrade to the Pro plan.\n`);
        },
        /no plans, upgrades or trials/,
      ],
      [
        "system file",
        (dir) => writeFileSync(join(dir, "skills/mostra/.DS_Store"), "x"),
        /operating system's file/,
      ],
      [
        "binary file",
        (dir) => writeFileSync(join(dir, "skills/mostra/notes.pdf"), Buffer.from([0x25, 0, 0xff])),
        /binary file other than an image/,
      ],
      [
        "package source",
        (dir) => writeFileSync(join(dir, ".npmrc"), "registry=https://example.com\n"),
        /sets a package source/,
      ],
      [
        "credential from the environment",
        (dir) =>
          writeFileSync(
            join(dir, "skills/mostra/references/extra.md"),
            'Run `printf %s "$GITHUB_TOKEN" | mostra secret set GITHUB_TOKEN`.\n',
          ),
        /reads \$GITHUB_TOKEN from the environment/,
      ],
      [
        "unpinned launch",
        (dir) => {
          const manifest = readJson(dir, ".claude-plugin/plugin.json");
          writeFileSync(
            join(dir, ".claude-plugin/plugin.json"),
            JSON.stringify({ ...manifest, description: "npx @mostra/cli@latest mcp" }),
          );
        },
        /launches @mostra\/cli@latest/,
      ],
      // The Opus review's finding 5: files the check didn't look at.
      [
        "hook in a marketplace entry",
        (dir) => {
          const market = readJson(dir, ".claude-plugin/marketplace.json");
          const plugins = market["plugins"] as Record<string, unknown>[];
          writeFileSync(
            join(dir, ".claude-plugin/marketplace.json"),
            JSON.stringify({ ...market, plugins: [{ ...plugins[0], hooks: {} }] }),
          );
        },
        /marketplace.json declares hooks/,
      ],
      [
        "upgrade prompt in the Skill",
        (dir) =>
          writeFileSync(
            join(dir, "skills/mostra/references/extra.md"),
            "Upgrade to the Pro plan for more pages.\n",
          ),
        /skills\/mostra\/references\/extra.md says "Upgrade to"/,
      ],
      [
        "a component in Claude's manifest",
        (dir) => {
          const manifest = readJson(dir, ".claude-plugin/plugin.json");
          writeFileSync(
            join(dir, ".claude-plugin/plugin.json"),
            JSON.stringify({ ...manifest, commands: "./commands" }),
          );
        },
        /\.claude-plugin\/plugin.json breaks its harness's shape/,
      ],
      [
        "a context file in Gemini's manifest",
        (dir) => {
          const manifest = readJson(dir, "gemini-extension.json");
          writeFileSync(
            join(dir, "gemini-extension.json"),
            JSON.stringify({ ...manifest, contextFileName: "GEMINI.md" }),
          );
        },
        /gemini-extension.json breaks its harness's shape/,
      ],
      [
        "another policy in the Codex marketplace",
        (dir) => {
          const market = readJson(dir, ".agents/plugins/marketplace.json");
          const plugins = market["plugins"] as Record<string, unknown>[];
          writeFileSync(
            join(dir, ".agents/plugins/marketplace.json"),
            JSON.stringify({
              ...market,
              plugins: [{ ...plugins[0], policy: { installation: "ALWAYS" } }],
            }),
          );
        },
        /\.agents\/plugins\/marketplace.json breaks its harness's shape/,
      ],
    ];
    for (const [name, seed, problem] of seeds) {
      const { dir, check } = built();
      seed(dir);
      expect(check().join("\n"), name).toMatch(problem);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns a server on everywhere at once, pinned to the release (WP-15, WP-30)", () => {
    const definition: PluginDefinition = {
      ...PLUGIN,
      features: {
        localMcp: {
          ...PLUGIN.features.localMcp,
          enabled: true,
          args: ["mcp", "--plugin"],
          verifiedOn: ["darwin", "linux", "win32"],
        },
        remoteMcp: {
          enabled: true,
          owner: "WP-30",
          url: "https://mcp.example.com/mcp",
          privacyPolicyUrl: "https://example.com/privacy",
        },
      },
    };
    const { dir, check } = built(definition);
    expect(check()).toEqual([]);
    const launch = { command: "npx", args: ["-y", "@mostra/cli@1.2.3", "mcp", "--plugin"] };
    expect(readJson(dir, "mcp.json")["mcpServers"]).toEqual({
      mostra: { type: "stdio", ...launch },
      "mostra-remote": { type: "streamable-http", url: "https://mcp.example.com/mcp" },
    });
    expect(readJson(dir, ".mcp.json")["mcpServers"]).toMatchObject({ mostra: launch });
    expect(readJson(dir, "gemini-extension.json")["mcpServers"]).toMatchObject({ mostra: launch });
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("https://mcp.example.com/mcp");
    expect(readJson(dir, ".claude-plugin/plugin.json")["privacyPolicyUrl"]).toBe(
      "https://example.com/privacy",
    );
    // Every launch runs an exact version: a bare command, an unpinned or ranged package, another
    // package launcher, or a remote over HTTP is refused (the Opus review's finding 8).
    const launches: [unknown, RegExp][] = [
      [{ command: "mostra", args: ["mcp"] }, /runs mostra, which no version pins/],
      [
        { command: "npx", args: ["-y", "some-helper"] },
        /some-helper, which isn't an exact version/,
      ],
      [{ command: "npx", args: ["-y", "some-helper@^1.0.0"] }, /isn't an exact version/],
      [{ command: "uvx", args: ["helper"] }, /runs uvx helper, which isn't an exact version/],
      [{ command: "npx", args: ["-y", "some-helper@1.0.0"] }, /^$/],
      [{ command: "uvx", args: ["--from", "helper==1.2.0", "helper"] }, /^$/],
      [{ command: "./bin/server", args: [] }, /^$/],
    ];
    for (const [server, problem] of launches) {
      const mcp = readJson(dir, ".mcp.json") as { mcpServers: Record<string, unknown> };
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { ...mcp.mcpServers, helper: server } }),
      );
      const found = check()
        .filter((line) => line.includes("server helper"))
        .join("\n");
      expect(found, JSON.stringify(server)).toMatch(problem);
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify(mcp));
    }
    const gemini = readJson(dir, "gemini-extension.json");
    writeFileSync(
      join(dir, "gemini-extension.json"),
      JSON.stringify({ ...gemini, mcpServers: { plain: { httpUrl: "http://mcp.example.com" } } }),
    );
    expect(check().join("\n")).toMatch(/server plain isn't HTTPS/);
    writeFileSync(join(dir, "gemini-extension.json"), JSON.stringify(gemini));
    // The local server is on only once its launch was started on every system (finding 9).
    const unproven = built({
      ...definition,
      features: {
        ...definition.features,
        localMcp: { ...definition.features.localMcp, verifiedOn: ["darwin", "linux"] },
      },
    });
    expect(unproven.check().join("\n")).toMatch(/wasn't started from every harness on win32/);
    // A server file left behind when the feature is off again is refused.
    const off = built();
    writeFileSync(join(off.dir, "mcp.json"), readFileSync(join(dir, "mcp.json")));
    expect(off.check().join("\n")).toMatch(/mcp.json declares a server no feature turns on/);
    // A remote server needs an https URL.
    expect(() =>
      buildPlugin(
        {
          ...PLUGIN,
          features: { ...PLUGIN.features, remoteMcp: { enabled: true, owner: "WP-30" } },
        },
        input(repository()),
      ),
    ).toThrow(/https/);
  });

  it("carries the listing icon where each harness reads it, and refuses one of the wrong size", () => {
    const root = repository();
    const png = (side: number) => {
      const header = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
      header.writeUInt32BE(13, 8);
      header.write("IHDR", 12, "latin1");
      header.writeUInt32BE(side, 16);
      header.writeUInt32BE(side, 20);
      return header;
    };
    writeFileSync(join(root, "icon.png"), png(512));
    const definition = { ...PLUGIN, icon: "icon.png" };
    const { dir, check } = built(definition, root);
    expect(check()).toEqual([]);
    expect(readJson(dir, ".claude-plugin/plugin.json")["icon"]).toBe("./.claude-plugin/icon.png");
    writeFileSync(join(dir, "assets/icon.png"), png(256));
    expect(check().join("\n")).toMatch(/assets\/icon.png is 256×256/);
  });

  it("names the telemetry endpoint when a release has one", () => {
    const { dir, check } = built(PLUGIN, repository(), "https://telemetry.example.com/v1");
    expect(check()).toEqual([]);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(
      "https://telemetry.example.com/v1",
    );
  });

  it("tells WP-15 to turn the local server on once the CLI has mostra mcp", () => {
    const { root, check } = built();
    writeFileSync(join(root, "docs", "reference", "cli.md"), "# The mostra CLI\n\n## mostra mcp\n");
    expect(check().join("\n")).toMatch(/WP-15 turns on features.localMcp/);
  });

  it("publishes a release once, as a tagged commit, and never moves a published tag", () => {
    const remote = join(mkdtempSync(join(tmpdir(), "plugin-remote-")), "plugin.git");
    spawnSync("git", ["init", "--quiet", "--bare", "--initial-branch", "main", remote]);
    const tag = (name: string) =>
      spawnSync("git", ["--git-dir", remote, "rev-parse", `${name}^{tree}`], {
        encoding: "utf8",
      }).stdout.trim();
    const { dir } = built();
    expect(publishPlugin({ tree: dir, version: "1.2.3", remote })).toBe("published");
    const first = tag("v1.2.3");
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(tag("main")).toBe(first);
    // A retried release with the same tree is done; with another tree it fails.
    expect(publishPlugin({ tree: dir, version: "1.2.3", remote })).toBe("already-published");
    writeFileSync(join(dir, "README.md"), "changed\n");
    expect(() => publishPlugin({ tree: dir, version: "1.2.3", remote })).toThrow(/never moves/);
    expect(tag("v1.2.3")).toBe(first);
    // A tree built for another version is never tagged as this one.
    expect(() => publishPlugin({ tree: dir, version: "1.2.4", remote })).toThrow(/not of 1\.2\.4/);
    // The next release is the next commit on main.
    const next = built(PLUGIN, repository(), "", "1.2.5").dir;
    expect(publishPlugin({ tree: next, version: "1.2.5", remote })).toBe("published");
    expect(tag("main")).toBe(tag("v1.2.5"));
    expect(tag("v1.2.5")).not.toBe(first);
    // An older release published late (a retried run after a newer one) is tagged off main,
    // which keeps the newest (Opus review, finding 2).
    const older = built(PLUGIN, repository(), "", "1.2.4").dir;
    expect(publishPlugin({ tree: older, version: "1.2.4", remote })).toBe("tagged");
    expect(tag("main")).toBe(tag("v1.2.5"));
    const tree = (ref: string) =>
      spawnSync("git", ["--git-dir", remote, "rev-parse", `${ref}^{tree}`], {
        encoding: "utf8",
      }).stdout.trim();
    expect(tree("v1.2.4")).not.toBe(tree("v1.2.5"));
    expect(
      spawnSync("git", ["--git-dir", remote, "show", "v1.2.4:plugin.json"], { encoding: "utf8" })
        .stdout,
    ).toContain('"version": "1.2.4"');
    // And a retry of it is done.
    expect(publishPlugin({ tree: older, version: "1.2.4", remote })).toBe("already-published");
    expect(tag("main")).toBe(tag("v1.2.5"));
  });
});
