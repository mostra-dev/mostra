import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, bumped, crateProblems, next, pendingBump } from "../release/versions.ts";

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

  it("finds a crate that left the group's version", () => {
    const root = workspace({});
    expect(next(root)).toBe("0.1.0");
    writeFileSync(
      join(root, "crates", "mostra-host", "Cargo.toml"),
      '[package]\nname = "mostra-host"\nversion = "0.0.9"\n',
    );
    expect(crateProblems(root)[0]).toContain("mostra-host is at 0.0.9");
  });
});
