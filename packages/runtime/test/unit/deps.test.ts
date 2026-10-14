/**
 * The deps module's pure parts (D95): the static import scan, package names and specs, the
 * lockfile's text, the offline flag and the artifact environment.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOffline,
  lockDigest,
  lockText,
  packageOf,
  parseLock,
  parseSpec,
  scanImports,
} from "../../src/deps/index.ts";
import { workspaceSettings } from "../../src/deps/installer.ts";
import { artifactEnvironment } from "../../src/processes/index.ts";
import { tempDir } from "../support.ts";

function tree(files: Record<string, string>): string {
  const dir = tempDir("deps-scan");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("the import scan", () => {
  it("finds every package a script, an MDX file or a stylesheet loads, with its first site", async () => {
    const dir = tree({
      "index.tsx": [
        'import React from "react";',
        'import type { Props } from "types-only";',
        'import { type A, type B } from "all-types";',
        'import { type C, d } from "mixed-types";',
        'export * from "@scope/reexport/sub";',
        'import "./local";',
        'import "@/components/ui/button";',
        'import fs from "node:fs";',
        'import path from "path";',
        'const later = import("dynamic-pkg");',
        // A computed specifier names no package the scan can know.
        "const computed = import(`computed-" + "$" + "{later}`);",
        'const old = require("cjs-pkg");',
        'import raw from "query-pkg/file.txt?raw";',
        'import { dryRun } from "@mostra/server";',
        "/** @jsxImportSource pragma-pkg */",
        "",
      ].join("\n"),
      "page.mdx": [
        "---",
        "title: Not an import",
        "---",
        'import { Chart } from "mdx-pkg"',
        "",
        "```js",
        'import fake from "fenced-pkg"',
        "```",
        "",
        "Some prose that says import nothing.",
        "",
      ].join("\n"),
      "styles.css":
        '@import "tailwindcss";\n@import url("css-pkg/dist/style.css");\n@plugin "@tailwindcss/typography";\n',
      "types.d.ts": 'import x from "declaration-pkg";\n',
      "public/vendor.js": 'import x from "public-pkg";\n',
    });
    const found = await scanImports(dir);
    expect([...found.keys()]).toEqual([
      "@scope/reexport",
      "@tailwindcss/typography",
      "cjs-pkg",
      "css-pkg",
      "dynamic-pkg",
      "mdx-pkg",
      "mixed-types",
      "pragma-pkg",
      "query-pkg",
      "react",
      "tailwindcss",
    ]);
    expect(found.get("react")).toEqual({ file: "index.tsx", line: 1, column: 19 });
    expect(found.get("mdx-pkg")).toEqual({ file: "page.mdx", line: 4, column: 23 });
    expect(found.get("css-pkg")?.file).toBe("styles.css");
  });

  it("skips files that don't parse; the build reports them", async () => {
    const found = await scanImports(
      tree({ "index.tsx": 'import { from "broken";\n', "ok.ts": 'import "fine";\n' }),
    );
    expect([...found.keys()]).toEqual(["fine"]);
  });
});

describe("package names and specs", () => {
  it("names the package of an import specifier", () => {
    expect(packageOf("react/jsx-runtime")).toBe("react");
    expect(packageOf("@xyflow/react/dist/style.css")).toBe("@xyflow/react");
    expect(packageOf("JSONStream")).toBe("JSONStream");
    for (const none of [
      "./a",
      "/abs",
      "#internal",
      "@/x",
      "node:fs",
      "fs",
      "https://x.test/a.js",
      "\0virtual",
      "@mostra/server",
      "@scope",
    ]) {
      expect(packageOf(none), none).toBeUndefined();
    }
  });

  it("parses registry specs and refuses everything else", () => {
    expect(parseSpec("three")).toEqual({ name: "three" });
    expect(parseSpec("three@0.186.1")).toEqual({
      name: "three",
      range: "0.186.1",
      exact: "0.186.1",
    });
    expect(parseSpec("@xyflow/react@^12")).toEqual({ name: "@xyflow/react", range: "^12" });
    expect(parseSpec("motion@next")).toEqual({ name: "motion", range: "next" });
    for (const bad of [
      "",
      "three@",
      "git+https://x.test/r.git",
      "./local",
      "github:a/b",
      "a b",
      "three@>>1",
    ]) {
      expect(parseSpec(bad), bad).toBeUndefined();
    }
  });
});

describe("the lockfile", () => {
  const warm = { react: "19.3.0", "react-dom": "19.3.0" };

  it("keeps WP-03's form for an artifact without on-demand packages", () => {
    expect(lockText({ warm, packages: {} })).toBe(
      [
        "# Mostra lockfile: the packages this version was built with. Frozen at publish.",
        "lockfileVersion: 1",
        "warm:",
        '  "react": "19.3.0"',
        '  "react-dom": "19.3.0"',
        "",
      ].join("\n"),
    );
  });

  it("carries the direct packages and the installer's lockfile exactly, and any change changes its digest", () => {
    const pnpm =
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      three:\n        specifier: 0.186.1\n        version: 0.186.1\n";
    const text = lockText({ warm, packages: { three: "0.186.1" }, pnpm });
    const back = parseLock(text);
    expect(back).toEqual({ warm, packages: { three: "0.186.1" }, pnpm });
    expect(lockText(back)).toBe(text);
    const changed = lockText({ warm, packages: { three: "0.186.2" }, pnpm });
    expect(lockDigest(changed)).not.toBe(lockDigest(text));
    expect(
      lockDigest(lockText({ warm, packages: { three: "0.186.1" }, pnpm: `${pnpm}# x\n` })),
    ).not.toBe(lockDigest(text));
  });
});

describe("the install child's settings and environment", () => {
  it("applies the one-day release age to resolutions only, exempting exact names", () => {
    expect(workspaceSettings(false)).toBe("minimumReleaseAge: 0\n");
    expect(workspaceSettings({ exempt: [] })).toBe("minimumReleaseAge: 1440\n");
    expect(workspaceSettings({ exempt: ["b", "@a/x", "b"] })).toBe(
      'minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - "@a/x"\n  - "b"\n',
    );
  });

  it("passes the artifact environment's allowlist and npm's configuration, nothing else", () => {
    const env = artifactEnvironment({
      PATH: "/bin",
      HOME: "/home/u",
      CC: "clang",
      HTTPS_PROXY: "http://proxy",
      npm_config_registry: "http://registry",
      MOSTRA_HOME: "/home/u/.mostra",
      GITHUB_TOKEN: "ghp_secret",
      OPENAI_API_KEY: "sk-secret",
      CI: "1",
      NODE_OPTIONS: "--require evil",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/u",
      CC: "clang",
      HTTPS_PROXY: "http://proxy",
      npm_config_registry: "http://registry",
    });
  });

  it("is offline when MOSTRA_OFFLINE says so", () => {
    expect(isOffline({ MOSTRA_OFFLINE: "1" })).toBe(true);
    expect(isOffline({ MOSTRA_OFFLINE: "true" })).toBe(true);
    // This machine has a network interface, so only the flag can make it offline here.
    expect(isOffline({ MOSTRA_OFFLINE: "0" })).toBe(isOffline({}));
    expect(isOffline({ MOSTRA_OFFLINE: "false" })).toBe(isOffline({}));
  });
});
