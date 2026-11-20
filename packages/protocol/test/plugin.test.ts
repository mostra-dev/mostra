import { readFileSync } from "node:fs";
import {
  HomeConfig,
  packAddMethod,
  pluginAddMethod,
  pluginListMethod,
  pluginRemoveMethod,
  pluginValidateMethod,
} from "@mostra/protocol";
import {
  ACKNOWLEDGED_CLASSES,
  checkPluginManifest,
  coreCommandTaken,
  formatLicenseExpression,
  LicenseExpressionError,
  licenseTerms,
  manifestScopes,
  PLUGIN_CONTRACTS,
  packageLicense,
  packageLicenseTerms,
  packVariables,
  parseLicenseExpression,
  parsePackAddress,
  RegistryItemSchema,
  spdxClass,
  stampServed,
  unreadableLicenseRef,
} from "@mostra/protocol/plugin";
import { describe, expect, it } from "vitest";
import { spdxModule, spdxTables } from "../src/plugin/spdx-tables.ts";

const root = new URL("..", import.meta.url);

/** A manifest that loads: one exporter and one CLI command. */
const valid = {
  name: "dev.acme/pdf",
  title: "PDF",
  contracts: { exporter: "^0.1.0", "cli-command": "^0.1.0" },
  contributes: {
    exporters: [{ id: "pdf", entry: "./dist/pdf.js" }],
    cliCommands: [{ command: "pdf open", entry: "./dist/cli.js", export: "open" }],
  },
  effects: ["filesystem"],
  license: "Apache-2.0",
  bundledLicenses: [
    {
      package: "remotion",
      license: "LicenseRef-Remotion",
      class: "source-available" as const,
      summary: "Free for individuals and small companies; a company license otherwise.",
      url: "https://www.remotion.dev/license",
    },
  ],
  platforms: ["darwin", "linux", "win32"],
};

describe("the SPDX tables", () => {
  it("are what the vendored SPDX License List data gives", () => {
    const read = (name: string) => readFileSync(new URL(`data/spdx/${name}`, root), "utf8");
    const generated = readFileSync(new URL("src/plugin/spdx.generated.ts", root), "utf8");
    expect(generated).toBe(
      spdxModule(spdxTables(read("spdx-licenses.json"), read("spdx-exceptions.json"))),
    );
  });
});

describe("license expressions", () => {
  it("parse SPDX's grammar, with canonical IDs and either case of operator", () => {
    const expression = parseLicenseExpression(
      "(mit or apache-2.0) AND GPL-2.0-only WITH Classpath-exception-2.0",
    );
    expect(formatLicenseExpression(expression)).toBe(
      "(MIT OR Apache-2.0) AND GPL-2.0-only WITH Classpath-exception-2.0",
    );
    expect(formatLicenseExpression(parseLicenseExpression("GPL-2.0+"))).toBe("GPL-2.0+");
    expect(formatLicenseExpression(parseLicenseExpression("DocumentRef-x:LicenseRef-y"))).toBe(
      "DocumentRef-x:LicenseRef-y",
    );
  });

  it("refuse what isn't an expression, saying why", () => {
    for (const bad of [
      "",
      "MIT AND",
      "(MIT",
      "NotALicense",
      "MIT WITH nothing",
      "AND MIT",
      "MIT MIT",
    ]) {
      expect(() => parseLicenseExpression(bad), bad).toThrow(LicenseExpressionError);
    }
  });

  it("class each license from the SPDX List's own flags", () => {
    expect(spdxClass("MIT")).toBe("osi-permissive");
    expect(spdxClass("Apache-2.0")).toBe("osi-permissive");
    expect(spdxClass("GPL-3.0-only")).toBe("osi-copyleft");
    expect(spdxClass("MPL-2.0")).toBe("osi-copyleft");
    expect(spdxClass("CC0-1.0")).toBe("public-domain");
    expect(spdxClass("CC-BY-4.0")).toBe("free");
    expect(spdxClass("BUSL-1.1")).toBe("source-available");
    expect(spdxClass("SSPL-1.0")).toBe("source-available");
    expect(spdxClass("CC-BY-NC-4.0")).toBe("source-available");
    expect(ACKNOWLEDGED_CLASSES.has("source-available")).toBe(true);
    expect(ACKNOWLEDGED_CLASSES.has("free")).toBe(false);
  });

  it("take the OR branch that needs the fewest acknowledgments, and every AND term", () => {
    expect(licenseTerms(parseLicenseExpression("BUSL-1.1 OR MIT"))).toEqual([
      { id: "MIT", class: "osi-permissive" },
    ]);
    expect(licenseTerms(parseLicenseExpression("BUSL-1.1 AND MIT"))).toEqual([
      { id: "BUSL-1.1", class: "source-available" },
      { id: "MIT", class: "osi-permissive" },
    ]);
  });

  it("class a reference as its plugin declares it, never as OSI-approved", () => {
    const declared = (id: string) =>
      id === "LicenseRef-Remotion" ? ("source-available" as const) : undefined;
    expect(licenseTerms(parseLicenseExpression("LicenseRef-Remotion"), declared)).toEqual([
      { id: "LicenseRef-Remotion", class: "source-available" },
    ]);
    expect(licenseTerms(parseLicenseExpression("LicenseRef-Other"), declared)).toEqual([
      { id: "LicenseRef-Other", class: "unknown" },
    ]);
    expect(licenseTerms(parseLicenseExpression("LicenseRef-X"), () => "osi-permissive")).toEqual([
      { id: "LicenseRef-X", class: "unknown" },
    ]);
  });

  it("read package.json license fields, old forms included, and name an unreadable one", () => {
    expect(packageLicense({ license: "MIT" })).toBe("MIT");
    expect(packageLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(packageLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe(
      "(MIT OR Apache-2.0)",
    );
    expect(packageLicense({})).toBeUndefined();
    expect(packageLicenseTerms("remotion", "SEE LICENSE IN LICENSE.md")).toEqual([
      { id: "LicenseRef-npm-remotion", class: "unknown" },
    ]);
    expect(packageLicenseTerms("@acme/x", "UNLICENSED")).toEqual([
      { id: "LicenseRef-npm-acme-x", class: "proprietary" },
    ]);
    expect(unreadableLicenseRef("@a/b.c")).toBe("LicenseRef-npm-a-b.c");
  });
});

describe("the plugin manifest", () => {
  it("takes the themes a plugin carries, and warns about entries that aren't one (D179 item 4)", () => {
    const check = checkPluginManifest({
      name: "dev.acme/brand",
      contracts: {},
      contributes: {
        themes: [{ theme: "./themes/brand.json" }, { theme: "../outside.json" }, "brand"],
      },
      license: "MIT",
    });
    expect(check.manifest?.contributes.themes).toEqual([{ theme: "./themes/brand.json" }]);
    expect(check.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(
      check.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.path.join(".")),
    ).toEqual(["mostra.contributes.themes.1", "mostra.contributes.themes.2"]);
    // A list that isn't one is ignored with a warning; nothing else carried means nothing to load.
    const odd = checkPluginManifest({
      name: "dev.acme/brand",
      contracts: {},
      contributes: { themes: "./themes/brand.json" },
      license: "MIT",
    });
    expect(odd.manifest).toBeUndefined();
    expect(odd.issues.map((issue) => `${issue.severity} ${issue.path.join(".")}`)).toEqual(
      expect.arrayContaining(["warning mostra.contributes.themes", "error mostra.contributes"]),
    );
  });

  it("reports every invalid field in one run, a schema error beside a rule's (EX-02)", () => {
    const check = checkPluginManifest({
      name: "Not A Name",
      contracts: { "cli-command": "^0.1.0" },
      contributes: {
        cliCommands: [{ command: "publish", entry: "/abs.js" }],
      },
      license: "Not-A-License",
      effects: ["teleport"],
    });
    expect(check.manifest).toBeUndefined();
    const paths = check.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("mostra.name");
    expect(paths).toContain("mostra.contributes.cliCommands.0.entry");
    expect(paths).toContain("mostra.contributes.cliCommands.0.command");
    expect(paths).toContain("mostra.license");
    expect(paths).toContain("mostra.effects.0");
  });

  it("accepts a valid manifest, and says where it may be installed", () => {
    const check = checkPluginManifest(valid);
    expect(check.issues).toEqual([]);
    expect(check.manifest?.name).toBe("dev.acme/pdf");
    expect(manifestScopes(check.manifest ?? (valid as never))).toEqual(["artifact", "home"]);
    expect(
      manifestScopes({
        ...valid,
        contracts: { "embed-engine": "^0.1.0" },
        contributes: { embedEngines: [{ id: "x", entry: "./x.js" }] },
      }),
    ).toEqual(["artifact"]);
  });

  it("reports every invalid field, each at its path", () => {
    const check = checkPluginManifest({
      name: "Not A Name",
      contracts: { exporter: "^0.1.0", nonsense: "1" },
      contributes: {
        exporters: [
          { id: "pdf", entry: "../outside.js" },
          { id: "Bad ID", entry: "./b.js" },
        ],
      },
      effects: ["telepathy"],
      license: 42,
    });
    const errors = check.issues.filter((issue) => issue.severity === "error");
    const paths = errors.map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "mostra.name",
        "mostra.contracts.nonsense",
        "mostra.contributes.exporters.0.entry",
        "mostra.contributes.exporters.1.id",
        "mostra.license",
      ]),
    );
    expect(check.manifest).toBeUndefined();
  });

  it("needs a contract for each kind of contribution, unique IDs and free commands", () => {
    const check = checkPluginManifest({
      ...valid,
      contracts: {},
      contributes: {
        exporters: [
          { id: "pdf", entry: "./a.js" },
          { id: "pdf", entry: "./b.js" },
        ],
        cliCommands: [{ command: "plugin add", entry: "./c.js" }],
      },
    });
    const messages = check.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    expect(messages.join("\n")).toMatch(/contributes\.exporters: .*"exporter"/);
    expect(messages.join("\n")).toMatch(/exporters\.1: "pdf" is contributed twice/);
    expect(messages.join("\n")).toMatch(/cliCommands\.0\.command: .*collide/);
  });

  it("warns about keys and effects this release doesn't know, and loads the rest", () => {
    const check = checkPluginManifest({ ...valid, future: true, effects: ["network", "dreams"] });
    expect(check.manifest).toBeDefined();
    expect(check.issues.map((issue) => [issue.severity, issue.path.join(".")])).toEqual([
      ["warning", "mostra.future"],
      ["warning", "mostra.effects.1"],
    ]);
  });

  it("checks bundled licenses: expressions, and classes only for references", () => {
    const check = checkPluginManifest({
      ...valid,
      bundledLicenses: [
        { package: "a", license: "MIT", class: "proprietary" },
        { package: "b", license: "LicenseRef-B", class: "osi-permissive" },
        { package: "c", license: "Not-An-Expression" },
      ],
    });
    expect(
      check.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.path.join(".")),
    ).toEqual([
      "mostra.bundledLicenses.0.class",
      "mostra.bundledLicenses.1.class",
      "mostra.bundledLicenses.2.license",
    ]);
  });

  it("refuses a manifest that contributes nothing or isn't an object", () => {
    expect(checkPluginManifest("x").issues[0]?.severity).toBe("error");
    expect(
      checkPluginManifest({ ...valid, contracts: {}, contributes: {} }).issues.some((issue) =>
        issue.message.includes("contributes nothing"),
      ),
    ).toBe(true);
  });
});

describe("the contract table", () => {
  it("names each contract's package and lets only exporters and commands into the home", () => {
    for (const [name, info] of Object.entries(PLUGIN_CONTRACTS)) {
      expect(info.package).toBe(`@mostra/contract-${name}`);
      expect(info.implements.length).toBeGreaterThan(0);
      const manifest = JSON.parse(
        readFileSync(new URL(`../contract-${name}/package.json`, root), "utf8"),
      ) as { version: string };
      expect(info.implements.at(-1), name).toBe(manifest.version);
    }
    expect(
      Object.values(PLUGIN_CONTRACTS)
        .filter((info) => info.scopes.includes("home"))
        .map((info) => info.name),
    ).toEqual(["exporter", "cli-command"]);
  });

  it("serves a stamp of the contract's compatible line, whatever its patch (WP-16 review)", () => {
    const stamp = (version: string) => ({ name: "exporter", version });
    // At 0.x a line is a minor; a newer patch a caret range resolved is served.
    expect(stampServed(stamp("0.1.4"), "exporter", ["0.1.3"])).toBe(true);
    expect(stampServed(stamp("0.1.0"), "exporter", ["0.1.3"])).toBe(true);
    expect(stampServed(stamp("0.2.0"), "exporter", ["0.1.3"])).toBe(false);
    // From 1.0 a line is a major.
    expect(stampServed(stamp("1.4.0"), "exporter", ["1.3.0"])).toBe(true);
    expect(stampServed(stamp("2.0.0"), "exporter", ["1.3.0"])).toBe(false);
    // Another contract's stamp, or one that isn't a version, never is.
    expect(stampServed({ name: "connector", version: "0.1.3" }, "exporter", ["0.1.3"])).toBe(false);
    expect(stampServed(stamp("latest"), "exporter", ["0.1.3"])).toBe(false);
  });

  it("keeps Mostra's own commands: equal, or a prefix either way", () => {
    expect(coreCommandTaken(["plugin", "add"])).toEqual(["plugin", "add"]);
    expect(coreCommandTaken(["plugin"])).toEqual(["plugin", "add"]);
    expect(coreCommandTaken(["share", "stop", "now"])).toEqual(["share"]);
    expect(coreCommandTaken(["term", "record"])).toBeUndefined();
  });
});

describe("pack items and addresses", () => {
  it("names the variables a pack read takes from its caller: GitHub's, shadcn's, the proxies and components.json's", () => {
    const names = packVariables(
      JSON.stringify({
        registries: {
          "@acme": {
            url: "https://r.acme.dev/{name}.json",
            params: { t: ["$", "{ACME_TOKEN}"].join("") },
            headers: { authorization: `Bearer ${["$", "{ACME_KEY}"].join("")}` },
          },
          "@plain": "https://plain.dev/{name}.json",
        },
      }),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "REGISTRY_URL",
        "HTTPS_PROXY",
        "ACME_TOKEN",
        "ACME_KEY",
      ]),
    );
    expect(packVariables("not json")).toEqual(packVariables(undefined));
  });

  it("read shadcn's address forms, and leave npm specs alone", () => {
    expect(parsePackAddress("https://ui.example/r/button.json")).toEqual({
      kind: "url",
      url: "https://ui.example/r/button.json",
    });
    expect(parsePackAddress("./item.json")).toEqual({ kind: "file", path: "./item.json" });
    expect(parsePackAddress("acme/ui/rules/agent#v1.2.0")).toEqual({
      kind: "github",
      owner: "acme",
      repo: "ui",
      item: "rules/agent",
      ref: "v1.2.0",
    });
    expect(parsePackAddress("@acme/input-form")).toEqual({
      kind: "namespace",
      namespace: "@acme",
      item: "input-form",
    });
    expect(parsePackAddress("plugin:@acme/mostra-pdf/report")).toEqual({
      kind: "plugin",
      package: "@acme/mostra-pdf",
      item: "report",
    });
    expect(parsePackAddress("recharts@3")).toBeUndefined();
    expect(parsePackAddress("react-hook-form")).toBeUndefined();
  });

  it("accept a shadcn item unchanged, unknown keys and all, and a Mostra block", () => {
    const item = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: "hello",
      type: "registry:block",
      registryDependencies: ["button", "@acme/input", "https://example.com/r/foo.json"],
      dependencies: ["is-even@3.0.0"],
      files: [{ path: "registry/hello.tsx", type: "registry:component", content: "export {}" }],
      cssVars: { theme: { "font-heading": "Poppins" }, light: { brand: "oklch(0.2 0 0)" } },
      css: { "@layer base": { body: { "font-size": "1rem" } } },
      someFutureKey: { anything: true },
      mostra: { base: "base", fields: ["hello.name"], license: "MIT" },
    };
    const parsed = RegistryItemSchema.parse(item);
    expect(parsed).toEqual(item);
  });
});

describe("the plugin methods", () => {
  it("are host protocol methods with their schemas", () => {
    expect(pluginValidateMethod.method).toBe("plugin/validate");
    expect(pluginAddMethod.mutating).toBe(true);
    expect(pluginRemoveMethod.mutating).toBe(true);
    expect(pluginListMethod.mutating).toBe(false);
    expect(packAddMethod.mutating).toBe(true);
    expect(() =>
      pluginAddMethod.params.parse({ packages: [], artifact: { path: "/a" } }),
    ).toThrow();
    expect(
      pluginAddMethod.params.parse({
        home: true,
        packages: ["mostra-pdf"],
        acceptLicenses: ["LicenseRef-X"],
      }),
    ).toMatchObject({ home: true });
  });

  it("let a host set the home's license policy", () => {
    expect(HomeConfig.parse({ licenses: { accept: ["LicenseRef-Remotion"] } })).toEqual({
      licenses: { accept: ["LicenseRef-Remotion"] },
    });
  });
});
