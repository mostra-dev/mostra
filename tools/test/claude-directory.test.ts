/**
 * Claude's plugin directory's folder (MT-07): `claude-directory/`, built beside the full plugin
 * from the same definition and Skill. The folder passes the directory's rules, each rule goes red
 * on its violation, the plugin's root is byte for byte what it is without the folder, and each
 * Markdown example gives back its source example's files exactly.
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkTree } from "../lib/files.ts";
import { buildPlugin, type PluginTree, writeTree } from "../plugins/build.ts";
import { checkClaudeDirectory, checkPlugin, claudeDirectoryRules } from "../plugins/check.ts";
import {
  CLAUDE_DIRECTORY,
  EXAMPLE_INTRO,
  exampleMarkdown,
  forClaudeDirectory,
  rewriteExampleLinks,
  splitExampleMarkdown,
} from "../plugins/claude-directory.ts";
import { PLUGIN, type PluginDefinition } from "../plugins/definition.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** A repository with what the generator reads: the Skill, the license files, the icon. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "directory-root-"));
  cpSync(join(REPO, "skills"), join(root, "skills"), { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) cpSync(join(REPO, file), join(root, file));
  if (PLUGIN.icon !== undefined) {
    mkdirSync(join(root, dirname(PLUGIN.icon)), { recursive: true });
    cpSync(join(REPO, PLUGIN.icon), join(root, PLUGIN.icon));
  }
  return root;
}

const input = (root: string) => ({ root, version: "1.2.3", telemetryEndpoint: "" });

function built(definition: PluginDefinition = PLUGIN, root = repository()) {
  const dir = join(mkdtempSync(join(tmpdir(), "directory-")), "mostra");
  writeTree(buildPlugin(definition, input(root)), dir);
  const folder = join(dir, CLAUDE_DIRECTORY);
  return {
    dir,
    root,
    folder,
    check: () => checkPlugin(dir, definition, input(root)),
    checkFolder: () => checkClaudeDirectory(folder, definition, input(root)),
  };
}

const off: PluginDefinition = {
  ...PLUGIN,
  features: {
    ...PLUGIN.features,
    claudeDirectory: { ...PLUGIN.features.claudeDirectory, enabled: false },
  },
};

const readJson = (dir: string, path: string) =>
  JSON.parse(readFileSync(join(dir, path), "utf8")) as Record<string, unknown>;

/** The Skill's files, by path below `skills/mostra/`. */
function skillFiles(root = REPO): Map<string, Buffer> {
  const source = join(root, "skills", "mostra");
  return new Map(
    walkTree(source)
      .filter((entry) => entry.kind === "file")
      .map((entry) => [entry.path, readFileSync(join(source, entry.path))] as const),
  );
}

/** Paths and bytes outside the folder. */
function outside(tree: PluginTree): Map<string, Buffer> {
  return new Map(
    [...tree]
      .filter(([path]) => !path.startsWith(`${CLAUDE_DIRECTORY}/`))
      .map(([path, contents]) => [path, Buffer.from(contents)] as const),
  );
}

describe("Claude's directory's folder (MT-07)", () => {
  it("builds a folder with the Skill and only the remote server, which every rule passes", () => {
    const { folder, check } = built();
    expect(check()).toEqual([]);
    const paths = walkTree(folder)
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        ".claude-plugin/plugin.json",
        ".claude-plugin/icon.png",
        ".claude-plugin/marketplace.json",
        ".mcp.json",
        "README.md",
        "LICENSE",
        "NOTICE",
        "skills/mostra/SKILL.md",
        "skills/mostra/assets/examples/decision.md",
        "skills/mostra/assets/examples/inbox.md",
        "skills/mostra/assets/examples/dashboard.md",
        "skills/mostra/assets/examples/specimen.md",
      ]),
    );
    // Nothing but Markdown, JSON, plain text and the PNG icon.
    for (const path of paths)
      expect(path, path).toMatch(/(\.md|\.json|\.png|(^|\/)(LICENSE|NOTICE))$/);
    expect(readJson(folder, ".mcp.json")).toEqual({
      mcpServers: { "mostra-remote": { type: "http", url: PLUGIN.features.remoteMcp.url } },
    });
    const manifest = readJson(folder, ".claude-plugin/plugin.json");
    expect(Object.keys(manifest).sort()).toEqual(
      [
        "author",
        "description",
        "homepage",
        "icon",
        "keywords",
        "license",
        "name",
        "privacyPolicyUrl",
        "repository",
        "version",
      ].sort(),
    );
    expect(manifest).toMatchObject({ name: "mostra", version: "1.2.3" });
    // The icon is the root's, byte for byte: the listing keeps its first submission's.
    expect(readFileSync(join(folder, ".claude-plugin/icon.png"))).toEqual(
      readFileSync(join(REPO, PLUGIN.icon as string)),
    );
    const readme = readFileSync(join(folder, "README.md"), "utf8");
    for (const named of [
      PLUGIN.features.remoteMcp.url as string,
      PLUGIN.features.remoteMcp.privacyPolicyUrl as string,
      PLUGIN.repository,
      "@mostra/cli",
    ])
      expect(readme, named).toContain(named);
    expect(readme).not.toContain("--embedded");
  });

  it("leaves everything outside the folder byte for byte as the build without it", () => {
    const root = repository();
    const withFolder = buildPlugin(PLUGIN, input(root));
    const without = buildPlugin(off, input(root));
    expect([...without.keys()].some((path) => path.startsWith(`${CLAUDE_DIRECTORY}/`))).toBe(false);
    const a = outside(withFolder);
    const b = outside(without);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [path, bytes] of b) expect(a.get(path)?.equals(bytes), path).toBe(true);
    // And the plugin without it passes the harnesses' check as it always did.
    const plain = built(off, root);
    expect(plain.check()).toEqual([]);
  });

  it("gives back each example's files from its Markdown, byte for byte", () => {
    const skill = skillFiles();
    const copy = forClaudeDirectory(skill, PLUGIN.features.claudeDirectory.compatibility);
    for (const name of ["decision", "inbox", "dashboard", "specimen"]) {
      const markdown = copy.get(`assets/examples/${name}.md`)?.toString("utf8") ?? "";
      expect(markdown.split("\n")[0]).toBe(EXAMPLE_INTRO);
      expect(markdown).toMatch(/^## index\.tsx$/m);
      expect(markdown.indexOf("## index.tsx")).toBeLessThan(
        markdown.search(/^## (?!index\.tsx)/m) === -1
          ? Infinity
          : markdown.search(/^## (?!index\.tsx)/m),
      );
      const back = splitExampleMarkdown(markdown);
      const own = `assets/examples/${name}/`;
      const source = [...skill].filter(([path]) => path.startsWith(own));
      expect(source.length).toBeGreaterThan(0);
      expect([...back.keys()].sort()).toEqual(
        source.map(([path]) => path.slice(own.length)).sort(),
      );
      for (const [path, bytes] of source)
        expect(back.get(path.slice(own.length)), path).toBe(bytes.toString("utf8"));
      expect(copy.has(`${own}index.tsx`)).toBe(false);
    }
    // A file whose text holds fences of its own still comes back whole.
    const tricky = new Map([
      ["index.tsx", "const md = `\n```tsx\nx\n```\n`;\n"],
      ["notes/a.md", "````\nfour\n````\n\n"],
    ]);
    expect(splitExampleMarkdown(exampleMarkdown(tricky))).toEqual(tricky);
    // What a block couldn't give back exactly is refused at the build.
    expect(() => exampleMarkdown(new Map([["index.tsx", "no newline"]]))).toThrow(/newline/);
    expect(() => exampleMarkdown(new Map([["index.tsx", "a\r\n"]]))).toThrow(/carriage/);
    expect(() => exampleMarkdown(new Map([["logo.png", Buffer.from([0x89, 0, 1])]]))).toThrow(
      /\.png/,
    );
    expect(() => exampleMarkdown(new Map([["../x.tsx", "x\n"]]))).toThrow(/path/);
  });

  it("changes the Skill only by its examples' links and its compatibility field", () => {
    const skill = skillFiles();
    const { compatibility } = PLUGIN.features.claudeDirectory;
    const copy = forClaudeDirectory(skill, compatibility);
    const names = ["dashboard", "decision", "inbox", "specimen"];
    let rewritten = 0;
    for (const [path, bytes] of skill) {
      if (path.startsWith("assets/examples/")) continue;
      const folder = copy.get(path)?.toString("utf8") ?? "";
      let original = bytes.toString("utf8");
      if (path === "SKILL.md")
        original = original.replace(/^compatibility: .*$/m, `compatibility: ${compatibility}`);
      // Undo the one rewrite, and the copy is the repository's file again.
      let undone = folder;
      for (const name of names)
        undone = undone.replaceAll(`assets/examples/${name}.md`, `assets/examples/${name}/`);
      expect(undone, path).toBe(original);
      if (folder !== bytes.toString("utf8")) rewritten += 1;
    }
    // SKILL.md, design.md and walkthrough.md point at the examples.
    expect(rewritten).toBe(3);
    expect(copy.get("SKILL.md")?.toString("utf8")).toContain(
      "[assets/examples/decision.md](assets/examples/decision.md)",
    );
    // A link into an example's directory is left as it is, for the link check to name.
    expect(
      rewriteExampleLinks("[a](../assets/examples/inbox/actions.ts) [b](assets/examples/inbox/)", [
        "inbox",
      ]),
    ).toBe("[a](../assets/examples/inbox/actions.ts) [b](assets/examples/inbox.md)");
    // Only the Skill's own path: another folder's `my-assets/examples/inbox/` is left alone.
    expect(
      rewriteExampleLinks("see my-assets/examples/inbox/ and x/assets/examples/inbox/", ["inbox"]),
    ).toBe("see my-assets/examples/inbox/ and x/assets/examples/inbox.md");
    // The repository's Skill keeps its own field.
    expect(skill.get("SKILL.md")?.toString("utf8")).not.toContain("connector (`artifact_create`");
    // A field YAML would read otherwise is refused at the build.
    expect(() => forClaudeDirectory(skill, "a: b")).toThrow(/YAML/);
  });

  it("refuses each thing the directory refuses from an organization that isn't verified", () => {
    const seeds: [string, (folder: string) => void, RegExp][] = [
      [
        "a .tsx example file",
        (f) => writeFileSync(join(f, "skills/mostra/assets/examples/page.tsx"), "export {};\n"),
        /page\.tsx isn't Markdown, plain text, JSON, YAML or an image/,
      ],
      [
        "a stylesheet",
        (f) => writeFileSync(join(f, "skills/mostra/studio.css"), "a{}\n"),
        /studio\.css isn't Markdown/,
      ],
      [
        "an image that isn't one",
        (f) => writeFileSync(join(f, "skills/mostra/shot.png"), "not a png\n"),
        /shot\.png isn't the image its name says/,
      ],
      [
        "a file in another encoding",
        (f) => writeFileSync(join(f, "notes.txt"), Buffer.from([0xff, 0xfe, 0x41])),
        /notes\.txt isn't UTF-8 text/,
      ],
      [
        "a script",
        (f) => writeFileSync(join(f, "setup.md"), "#!/bin/sh\necho hi\n"),
        /setup\.md starts with #!/,
      ],
      [
        "a package manifest",
        (f) => writeFileSync(join(f, "package.json"), "{}\n"),
        /package\.json is a package manager's file/,
      ],
      [
        "a lockfile",
        (f) => writeFileSync(join(f, "skills/mostra/pnpm-lock.yaml"), "lockfileVersion: 9\n"),
        /pnpm-lock\.yaml is a package manager's file/,
      ],
      [
        "a package source",
        (f) => writeFileSync(join(f, ".npmrc"), "registry=https://example.com\n"),
        /\.npmrc/,
      ],
      [
        "a second .claude-plugin",
        (f) => {
          mkdirSync(join(f, "skills/.claude-plugin"), { recursive: true });
          writeFileSync(join(f, "skills/.claude-plugin/plugin.json"), '{"name":"x"}\n');
        },
        /skills\/\.claude-plugin is a second \.claude-plugin folder/,
      ],
      [
        "a second .mcp.json",
        (f) => writeFileSync(join(f, "skills/.mcp.json"), '{"mcpServers":{}}\n'),
        /skills\/\.mcp\.json is a second \.mcp\.json/,
      ],
      [
        "an Agent Plugins mcp.json",
        (f) => writeFileSync(join(f, "mcp.json"), '{"mcpServers":{}}\n'),
        /mcp\.json declares servers outside \.mcp\.json/,
      ],
      [
        "an .svg",
        (f) => writeFileSync(join(f, "logo.svg"), "<svg/>\n"),
        /logo\.svg is an \.svg other than the icon/,
      ],
      [
        "a local server",
        (f) =>
          writeFileSync(
            join(f, ".mcp.json"),
            JSON.stringify({
              mcpServers: {
                "mostra-remote": { type: "http", url: PLUGIN.features.remoteMcp.url },
                mostra: { command: "npx", args: ["-y", "@mostra/cli@1.2.3", "mcp", "--embedded"] },
              },
            }),
          ),
        /server mostra starts a program/,
      ],
      [
        "a remote server over HTTP",
        (f) =>
          writeFileSync(
            join(f, ".mcp.json"),
            JSON.stringify({ mcpServers: { "mostra-remote": { type: "http", url: "http://x" } } }),
          ),
        /\.mcp\.json breaks its shape/,
      ],
      [
        "no .mcp.json",
        (f) => rmSync(join(f, ".mcp.json")),
        /\.mcp\.json is missing while features\.remoteMcp is on/,
      ],
      [
        "a field the report named unknown",
        (f) => {
          const manifest = readJson(f, ".claude-plugin/plugin.json");
          writeFileSync(
            join(f, ".claude-plugin/plugin.json"),
            JSON.stringify({ ...manifest, documentationUrl: "https://example.com/docs" }),
          );
        },
        /plugin\.json breaks its shape/,
      ],
      [
        "a component in the manifest",
        (f) => {
          const manifest = readJson(f, ".claude-plugin/plugin.json");
          writeFileSync(
            join(f, ".claude-plugin/plugin.json"),
            JSON.stringify({ ...manifest, mcpServers: { x: { command: "x" } } }),
          );
        },
        /plugin\.json breaks its shape/,
      ],
      [
        "an icon the folder lacks",
        (f) => rmSync(join(f, ".claude-plugin/icon.png")),
        /icon \.\/\.claude-plugin\/icon\.png isn't in the folder/,
      ],
      [
        "a hook",
        (f) => writeFileSync(join(f, "settings.json"), '{"hooks":{}}\n'),
        /settings\.json declares hooks/,
      ],
      [
        "a variable read",
        (f) =>
          writeFileSync(
            join(f, ".mcp.json"),
            JSON.stringify({
              // biome-ignore lint/suspicious/noTemplateCurlyInString: the variable is the violation
              mcpServers: { "mostra-remote": { type: "http", url: "https://${HOST}/mcp" } },
            }),
          ),
        /\.mcp\.json reads a variable/,
      ],
      [
        "a bin folder",
        (f) => {
          mkdirSync(join(f, "bin"));
          writeFileSync(join(f, "bin/README.md"), "x\n");
        },
        /bin\/ is a folder of components/,
      ],
      [
        "a link to an example's directory",
        (f) => {
          const path = join(f, "skills/mostra/references/design.md");
          writeFileSync(path, `${readFileSync(path, "utf8")}\n[x](../assets/examples/decision/)\n`);
        },
        /design\.md links to \.\.\/assets\/examples\/decision\/, which the folder lacks/,
      ],
      [
        "a link out of the folder",
        (f) => {
          const path = join(f, "README.md");
          writeFileSync(path, `${readFileSync(path, "utf8")}\n[x](../README.md)\n`);
        },
        /README\.md links to \.\.\/README\.md, outside the folder/,
      ],
      [
        "a changed Skill",
        (f) => {
          const path = join(f, "skills/mostra/references/page.md");
          writeFileSync(path, `${readFileSync(path, "utf8")}\nAnother line.\n`);
        },
        /references\/page\.md differs from the repository's Skill/,
      ],
      [
        "an example that doesn't give its file back",
        (f) => {
          const path = join(f, "skills/mostra/assets/examples/decision.md");
          writeFileSync(path, readFileSync(path, "utf8").replace("Checkout", "Check-out"));
        },
        /decision\.md doesn't give back index\.tsx exactly/,
      ],
      [
        "an example left as a directory",
        (f) => {
          mkdirSync(join(f, "skills/mostra/assets/examples/inbox"));
          writeFileSync(join(f, "skills/mostra/assets/examples/inbox/notes.md"), "x\n");
        },
        /doesn't hold exactly the repository's Skill/,
      ],
      [
        "the repository's compatibility field",
        (f) => {
          const path = join(f, "skills/mostra/SKILL.md");
          writeFileSync(
            path,
            readFileSync(path, "utf8").replace(
              /^compatibility: .*$/m,
              "compatibility: Needs a shell.",
            ),
          );
        },
        /SKILL\.md's compatibility isn't the folder's/,
      ],
      [
        "a README that doesn't name the server",
        (f) => {
          const path = join(f, "README.md");
          writeFileSync(
            path,
            readFileSync(path, "utf8").replaceAll(PLUGIN.features.remoteMcp.url as string, "it"),
          );
        },
        /README\.md doesn't disclose https:\/\/api\.mostradev\.com\/mcp/,
      ],
      ["no license", (f) => rmSync(join(f, "LICENSE")), /LICENSE is missing/],
      [
        "a second skill",
        (f) => {
          mkdirSync(join(f, "skills/other"));
          writeFileSync(join(f, "skills/other/SKILL.md"), "---\nname: other\n---\n");
        },
        /skills\/other\/ is a skill the definition doesn't carry/,
      ],
      [
        "a reference link to a file the folder lacks",
        (f) => {
          const path = join(f, "README.md");
          writeFileSync(path, `${readFileSync(path, "utf8")}\n[x][gone]\n\n[gone]: ./GONE.md\n`);
        },
        /README\.md links to \.\/GONE\.md, which the folder lacks/,
      ],
      [
        "a link",
        (f) => symlinkSync("README.md", join(f, "LINK.md")),
        /LINK\.md isn't a regular file or folder/,
      ],
    ];
    for (const [name, seed, problem] of seeds) {
      const { dir, folder, check } = built();
      seed(folder);
      const found = check().join("\n");
      expect(found, name).toMatch(problem);
      // Every problem names the rule's source and the day it was read.
      expect(found, name).toMatch(/\(the directory's rule: .+; .+, read \d{4}-\d{2}-\d{2}\)/);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is red on the root plugin, which the directory refused from an unverified organization", () => {
    const { dir, root } = built();
    const problems = checkClaudeDirectory(dir, PLUGIN, input(root)).join("\n");
    expect(problems).toMatch(/assets\/examples\/decision\/index\.tsx isn't Markdown/);
    expect(problems).toMatch(/assets\/examples\/inbox\/actions\.ts isn't Markdown/);
    expect(problems).toMatch(/server mostra starts a program/);
    expect(problems).toMatch(/\.claude-plugin\/plugin\.json breaks its shape/);
  });

  it("names each rule's source and the day it was read", () => {
    const rules = claudeDirectoryRules();
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const { rule, source, read } of rules) {
      expect(source, rule).not.toBe("");
      expect(read, rule).toMatch(/^2026-\d{2}-\d{2}$/);
    }
  });

  it("refuses a folder the definition doesn't turn on, and a missing one it does", () => {
    const { dir, root } = built();
    expect(checkPlugin(dir, off, input(root)).join("\n")).toMatch(
      /claude-directory\/ is there while features\.claudeDirectory is off/,
    );
    const plain = built(off, root);
    expect(checkPlugin(plain.dir, PLUGIN, input(root)).join("\n")).toMatch(
      /claude-directory\/ is missing while features\.claudeDirectory is on/,
    );
  });
});
