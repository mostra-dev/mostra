import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apply,
  bumped,
  crateProblems,
  next,
  pendingBump,
  rehearsal,
  skillPinProblems,
} from "../release/versions.ts";

/** A tiny workspace: the group, a non-member, the host crate and changesets. */
function workspace(changesets: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "versions-"));
  mkdirSync(join(root, ".changeset"));
  writeFileSync(
    join(root, ".changeset", "config.json"),
    JSON.stringify({ fixed: [["@mostra/sdk", "@mostra/cli"]] }),
  );
  for (const [name, text] of Object.entries(changesets))
    writeFileSync(join(root, ".changeset", name), text);
  writeFileSync(join(root, ".changeset", "README.md"), "# Changesets\n");
  for (const [dir, name] of [
    ["sdk", "@mostra/sdk"],
    ["cli", "@mostra/cli"],
    ["contract-x", "@mostra/contract-x"],
  ] as const) {
    mkdirSync(join(root, "packages", dir), { recursive: true });
    writeFileSync(
      join(root, "packages", dir, "package.json"),
      `${JSON.stringify({ name, version: "0.1.0" }, null, 2)}\n`,
    );
  }
  mkdirSync(join(root, "crates", "mostra-host"), { recursive: true });
  writeFileSync(
    join(root, "crates", "mostra-host", "Cargo.toml"),
    '[package]\nname = "mostra-host"\nversion = "0.1.0"\npublish = false\n',
  );
  writeFileSync(
    join(root, "Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "mostra-host"\nversion = "0.1.0"\n',
  );
  return root;
}

describe("release versions (D143)", () => {
  it("bumps as Changesets does", () => {
    expect(bumped("0.1.0", "patch")).toBe("0.1.1");
    expect(bumped("0.1.3", "minor")).toBe("0.2.0");
    expect(bumped("0.9.3", "major")).toBe("1.0.0");
  });

  it("rehearses the highest bump the group's pending changesets ask for, ignoring other packages", () => {
    const root = workspace({
      "a.md": '---\n"@mostra/sdk": patch\n---\n\nA fix.\n',
      "b.md": '---\n"@mostra/cli": minor\n"@mostra/contract-x": major\n---\n\nA feature.\n',
    });
    expect(pendingBump(root)).toBe("minor");
    expect(next(root)).toBe("0.2.0");
    apply(next(root), root);
    expect(JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8"))).toEqual(
      { name: "@mostra/cli", version: "0.2.0" },
    );
    expect(
      JSON.parse(readFileSync(join(root, "packages", "contract-x", "package.json"), "utf8"))
        .version,
    ).toBe("0.1.0");
    expect(readFileSync(join(root, "crates", "mostra-host", "Cargo.toml"), "utf8")).toContain(
      'version = "0.2.0"',
    );
    expect(readFileSync(join(root, "Cargo.lock"), "utf8")).toContain(
      'name = "mostra-host"\nversion = "0.2.0"',
    );
    expect(crateProblems(root)).toEqual([]);
  });

  it("rehearses the next patch when npm already has the tree's version and nothing is pending (#69)", () => {
    const root = workspace({});
    expect(rehearsal(() => true, root)).toEqual({ rehearse: true, version: "0.1.1" });
    // A version pull request: its version isn't on npm yet, so it is built as it stands.
    expect(rehearsal(() => false, root)).toEqual({ rehearse: false, version: "0.1.0" });
    const pending = workspace({ "a.md": '---\n"@mostra/sdk": minor\n---\n\nA feature.\n' });
    expect(rehearsal(() => true, pending)).toEqual({ rehearse: true, version: "0.2.0" });
    expect(rehearsal(() => false, pending)).toEqual({ rehearse: true, version: "0.2.0" });
  });

  it("finds a crate that left the group's version", () => {
    const root = workspace({});
    expect(next(root)).toBe("0.1.0");
    writeFileSync(
      join(root, "crates", "mostra-host", "Cargo.toml"),
      '[package]\nname = "mostra-host"\nversion = "0.0.9"\n',
    );
    expect(crateProblems(root)[0]).toContain("mostra-host is at 0.0.9");
  });

  it("keeps the Skill's CLI pins at the group's version, and sync moves them (WP-14)", () => {
    const root = workspace({});
    mkdirSync(join(root, "skills", "mostra", "references"), { recursive: true });
    const skill = join(root, "skills", "mostra", "SKILL.md");
    const reference = join(root, "skills", "mostra", "references", "page.md");
    writeFileSync(
      skill,
      '---\nname: mostra\nmetadata:\n  version: "0.1.0"\n---\n\nRun `npx -y @mostra/cli@0.1.0 verify`.\n',
    );
    writeFileSync(reference, "No pin here, then `npx -y @mostra/cli@0.1.0 publish`.\n");
    expect(skillPinProblems(root)).toEqual([]);
    // A pin left behind is found, in the frontmatter and in the text.
    writeFileSync(reference, "Then `npx -y @mostra/cli@0.0.9 publish`.\n");
    expect(skillPinProblems(root)).toEqual([
      expect.stringContaining("references/page.md runs @mostra/cli@0.0.9"),
    ]);
    apply("0.2.0", root);
    expect(readFileSync(skill, "utf8")).toContain('  version: "0.2.0"');
    expect(readFileSync(skill, "utf8")).toContain("@mostra/cli@0.2.0 verify");
    expect(readFileSync(reference, "utf8")).toContain("@mostra/cli@0.2.0 publish");
    expect(skillPinProblems(root)).toEqual([]);
    // A Skill that pins nothing gives an agent without mostra no way to run it.
    writeFileSync(skill, '---\nname: mostra\nmetadata:\n  version: "0.2.0"\n---\n');
    writeFileSync(reference, "Nothing.\n");
    expect(skillPinProblems(root)).toEqual([expect.stringContaining("pins no @mostra/cli")]);
  });
});
