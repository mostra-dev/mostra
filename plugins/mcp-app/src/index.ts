/**
 * `@mostra/plugin-mcp-app`: Mostra's MCP App exporter (D175 item 2, MC-02), the first first-party
 * plugin, on `@mostra/contract-exporter`. It turns one published version into an MCP App: one
 * self-contained HTML5 page (`index.html`, `text/html;profile=mcp-app`) that a chat host shows
 * inline as `ui://mostra/view/<versionId>`, and `mcp-app.json`, that resource's description with
 * the origins it declares (`_meta.ui.csp`). Every home has it (scope `bundled`, D175 item 3), so
 * `mostra export <artifact> --as mcp-app --out <dir>` and `artifact_open` work with nothing
 * installed.
 *
 * @packageDocumentation
 */
import {
  defineExporter,
  type Exporter,
  type ExporterDefinition,
  type ExportResult,
  type Finding,
} from "@mostra/contract-exporter";
import {
  APP_PAGE_MAX_CHARS,
  MCP_APP_MIME_TYPE,
  type McpAppResourceMeta,
  mcpAppUri,
} from "@mostra/protocol";
import { bundleEntry, clientFiles, extensionOf, FONT_EXTENSIONS } from "./bundle.ts";
import { httpsOrigin, inlineStylesheet, ownOrigins, pageHtml, readBuiltPage } from "./page.ts";

/** The exporter's ID: what `mostra export --as` names. */
export const EXPORTER_ID = "mcp-app";

/** What `mcp-app.json` holds: the page's `ui://` resource as MCP lists it. */
export interface McpAppDescription {
  /** The page's resource: `ui://mostra/view/<versionId>`. */
  readonly uri: string;
  /** A stable machine name: `mostra-<versionId>`. */
  readonly name: string;
  /** The artifact's title, for people. */
  readonly title: string;
  /** The artifact's description, when it has one. */
  readonly description?: string;
  /** `text/html;profile=mcp-app`. */
  readonly mimeType: string;
  /** What the page declares to its host: the origins it reaches, its border preference. */
  readonly _meta: { readonly ui: McpAppResourceMeta };
}

/** The origins an option lists, each an `https:` origin, deduplicated. */
function originsOption(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  const origins: string[] = [];
  for (const entry of value as string[]) {
    const origin = httpsOrigin(entry);
    if (origin === undefined || origin !== entry.replace(/\/$/, "")) {
      throw new Error(`${name} takes https: origins such as https://api.example.com, not ${entry}`);
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** The exporter `mcp-app`: one version as an MCP App (the package's default export). */
const exporter: Exporter = defineExporter<ExporterDefinition>({
  id: EXPORTER_ID,
  title: "MCP App",
  description:
    "One self-contained page that chat hosts show inline (MCP Apps), with its ui:// resource's description.",
  output: { mediaType: MCP_APP_MIME_TYPE, layout: "directory" },
  options: {
    type: "object",
    additionalProperties: false,
    properties: {
      connectDomains: {
        type: "array",
        items: { type: "string" },
        description: "More https: origins the page fetches from, beyond those its code names.",
      },
      resourceDomains: {
        type: "array",
        items: { type: "string" },
        description: "More https: origins the page loads images, styles or media from.",
      },
      prefersBorder: {
        type: "boolean",
        description:
          "Whether the host draws a border and background around the page; true unless set.",
      },
    },
  },
  async export({ version, files, options }, { signal }): Promise<ExportResult> {
    const findings: Finding[] = [];
    const client = await clientFiles(files);
    const built = readBuiltPage(await files.readText("client/index.html"));
    // Every stylesheet of the build: the page's own first, then those a dynamic import loads.
    const stylesheets = [
      ...built.stylesheets,
      ...[...client.paths]
        .filter((path) => extensionOf(path) === ".css" && !built.stylesheets.includes(path))
        .sort(),
    ];
    const cssParts: string[] = [];
    const cssOrigins = new Set<string>();
    let fonts = 0;
    for (const sheet of stylesheets) {
      if (!client.paths.has(sheet)) continue;
      const inlined = await inlineStylesheet(
        new TextDecoder().decode(await client.read(sheet)),
        client,
      );
      cssParts.push(inlined.css);
      for (const origin of inlined.origins) cssOrigins.add(origin);
      fonts += inlined.fonts;
    }
    if (signal.aborted) throw new Error("cancelled");
    const bundled = await bundleEntry(built.entry, client, (path) =>
      FONT_EXTENSIONS.includes(extensionOf(path)),
    );
    const codeOrigins = await ownOrigins(files, bundled.modules);
    const connectDomains = [
      ...new Set([...codeOrigins, ...originsOption(options["connectDomains"], "connectDomains")]),
    ].sort();
    const resourceDomains = [
      ...new Set([
        ...codeOrigins,
        ...cssOrigins,
        ...originsOption(options["resourceDomains"], "resourceDomains"),
      ]),
    ].sort();
    const meta: McpAppResourceMeta = {
      ...(connectDomains.length > 0 || resourceDomains.length > 0
        ? {
            csp: {
              ...(connectDomains.length > 0 ? { connectDomains } : {}),
              ...(resourceDomains.length > 0 ? { resourceDomains } : {}),
            },
          }
        : {}),
      // Said every time, since hosts' own defaults differ (MCP Apps recommends an explicit value):
      // a border and background, so the page and its bar read as one card, unless asked otherwise.
      prefersBorder:
        typeof options["prefersBorder"] === "boolean" ? options["prefersBorder"] : true,
    };
    const html = pageHtml({
      title: version.title,
      lang: built.lang,
      versionId: version.versionId,
      css: cssParts.join("\n"),
      code: bundled.code,
    });
    if (html.length > APP_PAGE_MAX_CHARS) {
      findings.push({
        code: "PAGE_TOO_LARGE",
        severity: "error",
        message: `The page is ${Math.ceil(html.length / 1024 / 1024)} MiB, past the 16 MiB an MCP App may be.`,
        hint: "Load large media from an https: origin instead of bundling it.",
      });
    }
    if (version.server) {
      findings.push({
        code: "SERVER_CODE",
        severity: "hint",
        message:
          "The page's actions and live data reach Mostra through its MCP server's app tools; a host that serves this page without them shows them as unavailable.",
      });
    }
    if (fonts > 0) {
      findings.push({
        code: "FONTS_FROM_HOST",
        severity: "hint",
        message: `The page's own faces (${fonts}) are left out: a chat host loads no font files, and its own faces take their place.`,
      });
    }
    if (resourceDomains.length > 0 || connectDomains.length > 0) {
      findings.push({
        code: "ORIGINS_DECLARED",
        severity: "hint",
        message: `The page declares ${[...new Set([...connectDomains, ...resourceDomains])].join(", ")} for a host that shows this resource itself; shown inline through artifact_open, whose loader declares no origin, it loads none of them, and says so for each (D175 item 2).`,
      });
    }
    const description: McpAppDescription = {
      uri: mcpAppUri(version.versionId),
      name: `mostra-${version.versionId}`,
      title: version.title,
      ...(version.description !== undefined ? { description: version.description } : {}),
      mimeType: MCP_APP_MIME_TYPE,
      _meta: { ui: meta },
    };
    return {
      files: [
        { path: "index.html", content: html },
        { path: "mcp-app.json", content: `${JSON.stringify(description, null, 2)}\n` },
      ],
      entry: "index.html",
      findings,
    };
  },
});

export default exporter;
