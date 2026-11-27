/**
 * The built-in `static` and `html` exporters (D185 item 7) on a small client build with a demo:
 * what the review of WP-24 found in them stays fixed. A stylesheet of another site stays in the
 * exported page and is named as needing a network (finding 8); a demo's document below its root
 * resolves the demo's files from the root when opened from disk (finding 15).
 */
import type { FileTree } from "@mostra/contract-exporter";
import { htmlExporter, staticExporter } from "@mostra/plugin-mcp-app";
import { describe, expect, it } from "vitest";

/** A file tree from paths and contents, as the plugin child hands an exporter. */
function tree(files: Record<string, string>): FileTree {
  const bytes = (value: string) => new TextEncoder().encode(value);
  const get = (path: string): string => {
    const value = files[path];
    if (value === undefined) throw new Error(`no file ${path}`);
    return value;
  };
  return {
    list: async () => Object.keys(files).sort(),
    read: async (path) => bytes(get(path)),
    readText: async (path) => get(path),
  };
}

const BASE = "/_mostra/demos/site/";
const FONTS = "https://fonts.example.com/css2?family=Inter";

/** A page with its own stylesheet and another site's, and a demo with a page below its root. */
const BUILD = {
  "client/index.html": `<!doctype html><html lang="en"><head><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="/assets/page.css"><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`,
  "client/assets/index.js": 'document.getElementById("root").textContent = "page";\n',
  "client/assets/page.css": "body { color: rgb(1, 2, 3); }\n",
  // A classic script: a build Mostra can't join into one document, so its files are made relative.
  [`client${BASE}index.html`]: `<!doctype html><html><head><script src="${BASE}app.js"></script></head><body><a href="${BASE}about/">About</a></body></html>`,
  [`client${BASE}about/index.html`]: `<!doctype html><html><head><script src="${BASE}app.js"></script></head><body>About</body></html>`,
  [`client${BASE}app.js`]: `fetch("${BASE}data.json");\n`,
  [`client${BASE}data.json`]: "[]\n",
};

const VERSION = {
  artifactId: "art_01KEXPORTBUILTIN0000000000",
  versionId: "ver_ABCDEFGHJKMNPQRSTVWXYZ0123",
  number: 1,
  title: "Built-in exports",
  manifest: {},
  registry: {},
  server: false,
  publishedAt: "2026-11-27T09:00:00.000Z",
};

const OPTIONS = {
  facts: { as: "static", artifactId: VERSION.artifactId, title: VERSION.title },
  demos: [{ name: "site", routing: "history", base: BASE }],
};

async function exported(exporter: typeof staticExporter) {
  const result = await exporter.export(
    { version: VERSION, files: tree(BUILD), options: OPTIONS as never },
    { signal: new AbortController().signal, log() {}, mostraVersion: "0.21.0" },
  );
  const file = (path: string): string => {
    const found = result.files.find((one) => one.path === path)?.content;
    if (found === undefined) throw new Error(`no ${path} in the export`);
    return typeof found === "string" ? found : new TextDecoder().decode(found);
  };
  return { result, file };
}

describe("the built-in exporters", () => {
  it("keep another site's stylesheet in the page and name it, inlining their own (review finding 8)", async () => {
    for (const exporter of [staticExporter, htmlExporter]) {
      const { file } = await exported(exporter);
      const page = file("index.html");
      expect(page).toContain(`href="${FONTS}"`);
      expect(page).not.toContain('href="/assets/page.css"');
      expect(page).toContain("rgb(1, 2, 3)");
      const report = JSON.parse(file(".mostra-report.json")) as { notInlined: string[] };
      expect(report.notInlined).toContain(FONTS);
    }
  });

  it("make a demo's page below its root resolve the demo's files from the root on disk (review finding 15)", async () => {
    const { file } = await exported(staticExporter);
    const root = file("demos/site/index.html");
    const nested = file("demos/site/about/index.html");
    // The root needs no <base>: a fragment link there still means this document.
    expect(root).not.toContain("<base ");
    expect(root).toContain('src="./app.js"');
    expect(nested).toContain('<base href="../">');
    expect(nested).toContain('src="./app.js"');
    // A script's URLs resolve from the document it runs in, which is the root's either way.
    expect(file("demos/site/app.js")).toContain('fetch("./data.json")');
    // As built, for the folder served at a host's root, nothing changes.
    expect(file("_mostra/demos/site/about/index.html")).toContain(`src="${BASE}app.js"`);
  });
});
