/**
 * The harness-plugin generator (AX-10, D147, WP-14): it builds a plugin every harness's checks
 * pass, and each check goes red on its violation.
 */
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

const input = (root: string, telemetryEndpoint = "") => ({
  root,
  version: "1.2.3",
  telemetryEndpoint,
});

function built(definition: PluginDefinition = PLUGIN, root = repository(), endpoint = "") {
  const dir = join(mkdtempSync(join(tmpdir(), "plugin-")), "mostra");
  writeTree(buildPlugin(definition, input(root, endpoint)), dir);
  return { dir, root, check: () => checkPlugin(dir, definition, input(root, endpoint)) };
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
        localMcp: { ...PLUGIN.features.localMcp, enabled: true, args: ["mcp", "--plugin"] },
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
});
