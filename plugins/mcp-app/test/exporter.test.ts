/**
 * The MCP App exporter (D175 item 2, MC-02) on a client build with everything a page can hold:
 * chunks a dynamic import loads, stylesheets, images named in code and in CSS, the build's own
 * faces, origins the artifact's code and its packages name, and text that would end a script.
 */
import { runInNewContext } from "node:vm";
import type { FileTree } from "@mostra/contract-exporter";
import exporter, { EXPORTER_ID } from "@mostra/plugin-mcp-app";
import { describe, expect, it } from "vitest";
import { rawText } from "../src/page.ts";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

/** A file tree from paths and contents, as the plugin child hands an exporter. */
function tree(files: Record<string, string | Uint8Array>): FileTree {
  const bytes = (value: string | Uint8Array) =>
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`no file ${path}`);
      return bytes(value);
    },
    readText: async (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`no file ${path}`);
      return new TextDecoder().decode(bytes(value));
    },
  };
}

const map = (sources: string[], contents: string[]) =>
  JSON.stringify({ version: 3, sources, sourcesContent: contents, mappings: "" });

/** A built page as Vite writes one: an entry, a lazy chunk with its stylesheet, assets. */
function build(): Record<string, string | Uint8Array> {
  return {
    "client/index.html": [
      '<!doctype html><html lang="de"><head>',
      '<meta name="mostra-version" content="ver_ABCDEFGHJKMNPQRSTVWXYZ0123" />',
      '<script type="module" crossorigin src="/assets/index-A1.js"></script>',
      '<link rel="stylesheet" crossorigin href="/assets/index-B2.css">',
      '</head><body><div id="root"></div></body></html>',
    ].join(""),
    "client/assets/index-A1.js": [
      'const logo = "/assets/logo-C3.png";',
      'const docs = "https://react.dev/errors";',
      'const api = "https://api.example.com/v1";',
      'export const ending = "</script><!-- <script>";',
      "globalThis.__page = { logo, api, docs, ending };",
      'globalThis.__lazy = import("./lazy-D4.js").then((m) => m.lazy);',
      "//# sourceMappingURL=index-A1.js.map",
    ].join("\n"),
    "client/assets/index-A1.js.map": map(
      [
        "../../staging/publish-X/source/index.tsx",
        "../../node_modules/.pnpm/react-dom@19/node_modules/react-dom/cjs/react-dom.js",
      ],
      [
        'fetch("https://api.example.com/v1/answers");',
        'throw new Error("https://react.dev/errors/418");',
      ],
    ),
    "client/assets/lazy-D4.js": 'export const lazy = "lazy loaded";\n',
    "client/assets/lazy-E5.css": ".lazy { background: url(/assets/logo-C3.png); }",
    "client/assets/index-B2.css": [
      "/*! tailwindcss https://tailwindcss.com */",
      '@font-face { font-family: Figtree; src: url(/assets/figtree-F6.woff2) format("woff2"); }',
      ".hero { background-image: url('/assets/logo-C3.png'); }",
      ".cdn { background-image: url(https://cdn.example.org/bg.png); }",
      ".end::after { content: '</style>'; }",
    ].join("\n"),
    "client/assets/logo-C3.png": PNG,
    "client/assets/figtree-F6.woff2": new Uint8Array([1, 2, 3]),
    "registry.json": "{}",
    "manifest.json": "{}",
    "lock.yaml": "",
  };
}

const VERSION = {
  artifactId: "art_01KAPPEXPORTER000000000000",
  versionId: "ver_ABCDEFGHJKMNPQRSTVWXYZ0123",
  number: 3,
  title: 'Plan <review> & "pick"',
  description: "Choose a plan.",
  manifest: {},
  registry: {},
  server: true,
  publishedAt: "2026-11-16T12:00:00.000Z",
};

async function exported(options: Record<string, unknown> = {}) {
  const result = await exporter.export(
    { version: VERSION, files: tree(build()), options: options as never },
    { signal: new AbortController().signal, log() {}, mostraVersion: "0.16.0" },
  );
  const html = result.files.find((file) => file.path === "index.html")?.content as string;
  const description = JSON.parse(
    result.files.find((file) => file.path === "mcp-app.json")?.content as string,
  ) as { uri: string; mimeType: string; _meta: { ui: Record<string, unknown> } };
  return { result, html, description };
}

/** The page's module script, as the browser would run it. */
function moduleOf(html: string): string {
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("no module script");
  return match[1] as string;
}

describe("the MCP App exporter (D175 item 2, MC-02)", () => {
  it("is a stamped exporter of a directory: the page and its resource's description", async () => {
    expect(exporter.id).toBe(EXPORTER_ID);
    expect(exporter.contract.name).toBe("exporter");
    expect(exporter.output).toEqual({
      mediaType: "text/html;profile=mcp-app",
      layout: "directory",
    });
    const { result, description } = await exported();
    expect(result.entry).toBe("index.html");
    expect(description.uri).toBe("ui://mostra/view/ver_ABCDEFGHJKMNPQRSTVWXYZ0123");
    expect(description.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("holds the whole build in one document: one module, its lazy chunk inlined, no other file", async () => {
    const { html } = await exported();
    expect(html.match(/<script type="module">/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
    expect(html).not.toMatch(/<link[^>]*stylesheet/);
    expect(html).not.toContain("sourceMappingURL");
    expect(html).toContain('<meta name="mostra-target" content="mcp-app" />');
    expect(html).toContain(
      '<meta name="mostra-version" content="ver_ABCDEFGHJKMNPQRSTVWXYZ0123" />',
    );
    expect(html).toContain('<html lang="de">');
    // The module, run as is, loads its lazy chunk without a network.
    const sandbox: Record<string, unknown> = {};
    const code = moduleOf(html).replace(/^export\s*\{[^}]*\};?\s*$/m, "");
    runInNewContext(code, { globalThis: sandbox });
    expect(await (sandbox["__lazy"] as Promise<string>)).toBe("lazy loaded");
    const page = sandbox["__page"] as { logo: string; ending: string };
    expect(page.logo).toMatch(/^data:image\/png;base64,/);
    expect(page.ending).toBe("</script><!-- <script>");
  });

  it("never lets the page's text end its script or stylesheet early", async () => {
    const { html } = await exported();
    // One closing tag per element the document opens: the token table, the guard, the module.
    expect(html.match(/<\/script/gi)).toHaveLength(3);
    expect(html.match(/<\/style/gi)).toHaveLength(1);
    expect(rawText("a</script>b<script c<!--d", "script")).toBe(
      "a\\x3C/script>b\\x3Cscript c\\x3C!--d",
    );
    expect(rawText("x</STYLE>", "style")).toBe("x<\\/STYLE>");
  });

  it("inlines every stylesheet with its images, and leaves the build's faces to the host", async () => {
    const { html, result } = await exported();
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    expect(style).toContain('.hero { background-image: url("data:image/png;base64,');
    expect(style).toContain('.lazy { background: url("data:image/png;base64,');
    expect(style).not.toContain("@font-face");
    expect(style).not.toContain("figtree");
    expect(result.findings?.map((finding) => finding.code)).toContain("FONTS_FROM_HOST");
  });

  it("declares the origins the artifact's own code and its stylesheets name, never a package's documentation", async () => {
    const { description, result } = await exported();
    expect(description._meta.ui).toEqual({
      csp: {
        connectDomains: ["https://api.example.com"],
        resourceDomains: ["https://api.example.com", "https://cdn.example.org"],
      },
    });
    const declared = JSON.stringify(description);
    expect(declared).not.toContain("react.dev");
    expect(declared).not.toContain("tailwindcss.com");
    expect(result.findings?.map((finding) => finding.code)).toContain("ORIGINS_DECLARED");
  });

  it("adds the origins its options name, and refuses one that isn't an https: origin", async () => {
    const { description } = await exported({
      connectDomains: ["https://data.example.net"],
      prefersBorder: false,
    });
    expect(description._meta.ui).toMatchObject({
      csp: { connectDomains: ["https://api.example.com", "https://data.example.net"] },
      prefersBorder: false,
    });
    await expect(exported({ connectDomains: ["http://plain.example"] })).rejects.toThrow(
      /https: origins/,
    );
    await expect(exported({ resourceDomains: ["https://x.example/path"] })).rejects.toThrow(
      /https: origins/,
    );
  });

  it("names the page's title and server code, escaped as text", async () => {
    const { html, result } = await exported();
    expect(html).toContain("<title>Plan &lt;review&gt; &amp; &quot;pick&quot;</title>");
    expect(result.findings?.map((finding) => finding.code)).toContain("SERVER_CODE");
  });

  it("carries the table of Mostra's tokens and the host's variables, as JSON the page reads", async () => {
    const { html } = await exported();
    const json = /<script type="application\/json" id="mostra-host-tokens">([^<]*)<\/script>/.exec(
      html,
    )?.[1];
    const table = JSON.parse(json ?? "{}") as Record<string, string[]>;
    expect(table["--background"]).toEqual(["--color-background-primary"]);
    expect(table["--font-sans"]).toEqual(["--font-sans"]);
  });

  it("refuses a build whose module imports what the build doesn't hold", async () => {
    const files = build();
    files["client/assets/index-A1.js"] = 'import "react";\nexport const x = 1;\n';
    await expect(
      exporter.export(
        { version: VERSION, files: tree(files), options: {} },
        { signal: new AbortController().signal, log() {}, mostraVersion: "0.16.0" },
      ),
    ).rejects.toThrow(/isn't a file of the build/);
  });
});
