/**
 * The loader page (`ui://mostra/app`, D175 item 1): the one static resource `artifact_open` names,
 * since a chat host reads a tool's UI once and may prefetch it (VERIFIED_FACTS, WP-17). It opens
 * the MCP Apps handshake with the host, waits for `artifact_open`'s result, reads that version's
 * page (`ui://mostra/view/<versionId>`) through the host's `resources/read`, and runs it in its
 * own document, handing it the host connection (`window.__mostraMcpApp`), so the page never
 * initializes twice. Where it can't (no result, no resource reads, a refused read), it says so
 * and offers the full page.
 *
 * It is one HTML5 document with inline script and style only, so the host's default policy shows
 * it; it reads nothing but what the host hands it, and renders every string as text.
 */
import {
  MCP_APP_HANDOFF,
  MCP_APP_LOADER_URI,
  MCP_APP_MIME_TYPE,
  MCP_APPS_PROTOCOL_VERSION,
} from "@mostra/protocol";

/** The words the loader shows; viewer-facing (D149), plain text. */
export const LOADER_WORDS: {
  readonly opening: string;
  readonly cancelled: string;
  readonly noPage: string;
  readonly failed: string;
  readonly personal: string;
  readonly open: string;
} = {
  opening: "Opening the page…",
  cancelled: "The page wasn't opened.",
  noPage: "This chat app can't show the page here.",
  failed: "The page couldn't be opened here.",
  personal: "This link is made for one person, so it opens only for them.",
  open: "Open the full page",
};

/**
 * How long the loader waits for `artifact_open`'s result before it says the page couldn't open: a
 * host that never sends it would otherwise leave "Opening the page…" up for good (R02 finding 8).
 */
const RESULT_WAIT_MS = 30_000;

/** The loader's script, run in the host's frame. */
function loaderScript(version: string): string {
  const words = JSON.stringify(LOADER_WORDS);
  return `(() => {
  "use strict";
  const WORDS = ${words};
  const HANDOFF = ${JSON.stringify(MCP_APP_HANDOFF)};
  const host = window.parent;
  const status = document.getElementById("mostra-loader");
  const pending = new Map();
  const kept = [];
  let next = 0;
  let handed = false;
  // Once the page has its handoff, what the host says next is the page's (R02 finding 19).
  let offered = false;
  let initialize;
  let toolInput;
  let toolResult;
  let resultArrived;
  const result = new Promise((resolve) => { resultArrived = resolve; });

  const send = (message) => host.postMessage(message, "*");
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      next += 1;
      const id = "mostra-loader-" + next;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  const size = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height } });
  };
  const merge = (context) => {
    if (initialize && context && typeof context === "object") {
      initialize = { ...initialize, hostContext: { ...(initialize.hostContext || {}), ...context } };
    }
  };

  const listen = (event) => {
    if (handed || event.source !== host) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
    if (typeof data.id === "string" && pending.has(data.id) && !("method" in data)) {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) waiting.reject(new Error(String(data.error.message || "refused")));
      else waiting.resolve(data.result);
      return;
    }
    switch (data.method) {
      case "ui/notifications/tool-input":
        toolInput = data.params && data.params.arguments;
        return;
      case "ui/notifications/tool-input-partial":
        return;
      case "ui/notifications/tool-result":
        toolResult = data.params;
        resultArrived(data.params);
        return;
      case "ui/notifications/tool-cancelled":
        resultArrived(undefined);
        return;
      case "ui/notifications/host-context-changed":
        if (offered) kept.push({ data, origin: event.origin, source: event.source });
        else merge(data.params);
        return;
      case "ui/resource-teardown":
        // Nothing is saved before the page runs: answer at once.
        if (data.id !== undefined) send({ jsonrpc: "2.0", id: data.id, result: {} });
        return;
      default:
        // Kept for the page, which takes the connection over.
        kept.push({ data, origin: event.origin, source: event.source });
    }
  };
  window.addEventListener("message", listen);

  const say = (text, url) => {
    status.textContent = "";
    const line = document.createElement("p");
    line.textContent = text;
    status.append(line);
    if (typeof url === "string" && /^https?:/.test(url)) {
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = WORDS.open;
      open.addEventListener("click", () => {
        request("ui/open-link", { url }).catch(() => undefined);
      });
      status.append(open);
    }
    size();
  };

  const html = (contents) => {
    const first = Array.isArray(contents) ? contents[0] : undefined;
    if (!first || typeof first !== "object") return undefined;
    if (typeof first.text === "string") return first.text;
    if (typeof first.blob === "string") {
      const bytes = Uint8Array.from(atob(first.blob), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return undefined;
  };

  // The page takes this document over: its head and body replace the loader's, and its scripts
  // are made again so they run (a parsed document's scripts never do).
  const run = (text) => {
    const page = new DOMParser().parseFromString(text, "text/html");
    for (const { name, value } of [...page.documentElement.attributes]) {
      document.documentElement.setAttribute(name, value);
    }
    const scripts = [];
    const adopt = (node) => {
      if (node.nodeName === "SCRIPT") {
        const script = document.createElement("script");
        for (const { name, value } of [...node.attributes]) script.setAttribute(name, value);
        script.textContent = node.textContent;
        scripts.push(script);
        return document.createComment("script");
      }
      return document.importNode(node, true);
    };
    const head = [...page.head.childNodes].map(adopt);
    const body = [...page.body.childNodes].map(adopt);
    document.head.replaceChildren(...head);
    document.body.replaceChildren(...body);
    for (const { name, value } of [...page.body.attributes]) document.body.setAttribute(name, value);
    for (const script of scripts) {
      (script.type === "application/json" ? document.head : document.body).append(script);
    }
  };

  (async () => {
    try {
      initialize = await request("ui/initialize", {
        appInfo: { name: "mostra", version: ${JSON.stringify(version)} },
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        protocolVersion: ${JSON.stringify(MCP_APPS_PROTOCOL_VERSION)},
      });
    } catch {
      say(WORDS.failed);
      return;
    }
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    if (initialize && initialize.hostContext && initialize.hostContext.theme) {
      document.documentElement.style.colorScheme = initialize.hostContext.theme;
    }
    size();
    const answered = await Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve(null), ${RESULT_WAIT_MS})),
    ]);
    if (answered === null) return say(WORDS.failed);
    const handles =
      answered && answered.structuredContent && answered.structuredContent.mostra;
    const url = handles && typeof handles.url === "string" ? handles.url : undefined;
    if (!answered) return say(WORDS.cancelled);
    if (answered.isError || !handles || typeof handles.versionId !== "string") {
      return say(WORDS.failed, url);
    }
    // One person's own link: opened here it would act as them, so it isn't, nor offered.
    if (handles.personal === true) return say(WORDS.personal);
    // Reading the page is all it takes: without the host's tool calls the page still shows, and
    // says its answers stay in this browser (D175 item 7, R02 finding 8).
    const capabilities = (initialize && initialize.hostCapabilities) || {};
    if (!capabilities.serverResources) return say(WORDS.noPage, url);
    let text;
    try {
      const read = await request("resources/read", { uri: "ui://mostra/view/" + handles.versionId });
      text = html(read && read.contents);
    } catch {
      text = undefined;
    }
    if (typeof text !== "string") return say(WORDS.failed, url);
    Object.defineProperty(window, HANDOFF, {
      configurable: false,
      value: Object.freeze({
        initialize,
        toolInput,
        toolResult,
        claim() {
          handed = true;
          window.removeEventListener("message", listen);
          return kept.splice(0);
        },
      }),
    });
    offered = true;
    run(text);
  })();
})();`;
}

/** The loader page, `ui://mostra/app`, of this release. */
export function loaderHtml(version: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    "<title>Mostra</title>",
    "<style>",
    "html { color-scheme: light dark; }",
    "body { margin: 0; font: 14px/1.5 var(--font-sans, system-ui, sans-serif); color: var(--color-text-primary, CanvasText); background: transparent; }",
    "#mostra-loader { padding: 16px; }",
    "#mostra-loader p { margin: 0 0 12px; }",
    "#mostra-loader button { font: inherit; padding: 6px 12px; border-radius: var(--border-radius-md, 6px); border: 1px solid var(--color-border-primary, GrayText); background: var(--color-background-secondary, Canvas); color: inherit; cursor: pointer; }",
    "</style>",
    "</head>",
    "<body>",
    `<div id="mostra-loader" role="status"><p>${LOADER_WORDS.opening}</p></div>`,
    `<script>${loaderScript(version).replaceAll("</script", "<\\/script")}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/** The loader's resource as `resources/list` and `resources/read` describe it. */
export const LOADER_RESOURCE: {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
} = {
  uri: MCP_APP_LOADER_URI,
  name: "mostra-app",
  title: "Mostra page",
  description: "Shows a Mostra artifact's page inline: artifact_open's result names the version.",
  mimeType: MCP_APP_MIME_TYPE,
};
