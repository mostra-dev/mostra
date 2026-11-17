/**
 * The MCP Apps reference host (WP-17, MC-02, ROUND-3 §10): what the end-to-end suites render
 * inline pages in. A host page on one origin, on ext-apps' AppBridge, frames a sandbox proxy on
 * another origin, which loads a view's HTML under the CSP MCP Apps builds from its resource's
 * declaration (`default-src 'none'` and the spec's restrictive defaults when it declares none);
 * the host's MCP client runs here, in Node, connected to the real `mostra mcp` over stdio, as a
 * desktop host's is.
 */
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { rolldown } from "rolldown";
import { CLI } from "./mostra.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** The extension a client names to say it shows MCP Apps (SEP-1724). */
const UI_EXTENSION = {
  extensions: {
    "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
  },
};

/** A resource's declared origins, as MCP Apps names them. */
export interface DeclaredCsp {
  readonly connectDomains?: readonly string[];
  readonly resourceDomains?: readonly string[];
  readonly frameDomains?: readonly string[];
  readonly baseUriDomains?: readonly string[];
}

/**
 * The CSP a host sets for a view (MCP Apps 2026-01-26, Host Behavior): the restrictive default,
 * opened only for what the resource declares.
 */
export function viewPolicy(csp: DeclaredCsp | undefined, frameAncestor: string): string {
  const resources = (csp?.resourceDomains ?? []).join(" ");
  const connect = (csp?.connectDomains ?? []).join(" ");
  const frames = (csp?.frameDomains ?? []).join(" ");
  const bases = (csp?.baseUriDomains ?? []).join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${resources}`.trim(),
    `style-src 'self' 'unsafe-inline' ${resources}`.trim(),
    `img-src 'self' data: ${resources}`.trim(),
    `font-src 'self' ${resources}`.trim(),
    `media-src 'self' data: ${resources}`.trim(),
    `connect-src ${connect || "'none'"}`,
    `frame-src ${frames || "'none'"}`,
    `base-uri ${bases || "'self'"}`,
    "object-src 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join("; ");
}

/** The sandbox proxy: relays messages, and writes the view into its inner frame. */
const SANDBOX = `<!doctype html><html><head><meta charset="utf-8"><title>sandbox</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head><body>
<script>
(() => {
  const host = window.parent;
  let inner;
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source === host) {
      if (data && data.method === "ui/notifications/sandbox-resource-ready") {
        inner = document.createElement("iframe");
        inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
        document.body.append(inner);
        const doc = inner.contentDocument;
        doc.open();
        doc.write(data.params.html);
        doc.close();
        return;
      }
      if (inner) inner.contentWindow.postMessage(data, "*");
    } else if (inner && event.source === inner.contentWindow) {
      host.postMessage(data, "*");
    }
  });
  host.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
})();
</script></body></html>`;

/** A running reference host: its page's address, and the sandbox proxy's on another origin. */
export interface ReferenceHost {
  /** The host page (`http://127.0.0.1:<port>/`). */
  readonly url: string;
  /** The sandbox proxy (`http://localhost:<port>/sandbox.html`): another origin, and site. */
  readonly sandbox: string;
  close(): Promise<void>;
}

let bundled: Promise<string> | undefined;

/** The host page's script: the page and ext-apps' AppBridge, bundled once per run. */
function hostScript(): Promise<string> {
  bundled ??= (async () => {
    const build = await rolldown({
      input: join(HERE, "mcp-apps-host-page.ts"),
      platform: "browser",
      logLevel: "silent",
    });
    const { output } = await build.generate({ format: "esm", codeSplitting: false });
    await build.close();
    return output[0].code;
  })();
  return bundled;
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("no address"));
      else resolve(address.port);
    });
  });
}

/** Starts the reference host's two origins. */
export async function startReferenceHost(): Promise<ReferenceHost> {
  const script = await hostScript();
  let hostOrigin = "";
  const page = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    if (path === "/host.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
    } else if (path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body><script type="module" src="/host.js"></script></body></html>',
      );
    } else response.writeHead(404).end();
  });
  const sandbox = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    if (url.pathname !== "/sandbox.html") {
      response.writeHead(404).end();
      return;
    }
    const declared = url.searchParams.get("csp");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": viewPolicy(
        declared ? (JSON.parse(declared) as DeclaredCsp) : undefined,
        hostOrigin,
      ),
    });
    response.end(SANDBOX);
  });
  const pagePort = await listen(page, "127.0.0.1");
  const sandboxPort = await listen(sandbox, "127.0.0.1");
  hostOrigin = `http://127.0.0.1:${pagePort}`;
  return {
    url: `${hostOrigin}/`,
    sandbox: `http://localhost:${sandboxPort}/sandbox.html`,
    close: async () => {
      await Promise.all(
        [page, sandbox].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    },
  };
}

/** The host's MCP client: the real `mostra mcp` over stdio, on the run's home. */
export async function hostClient(
  home: string,
  env: Readonly<Record<string, string>> = {},
): Promise<Client> {
  const { MOSTRA_HOME: _home, ...inherited } = process.env;
  const client = new Client(
    { name: "mostra-reference-host", version: "1.0.0" },
    { capabilities: UI_EXTENSION as never },
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "--embedded"],
      env: {
        ...(Object.fromEntries(
          Object.entries(inherited).filter(([, value]) => value !== undefined),
        ) as Record<string, string>),
        MOSTRA_HOME: home,
        ...env,
      },
      stderr: "inherit",
    }),
  );
  return client;
}
