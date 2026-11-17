"use client";

/**
 * A page's connection to an MCP Apps host (D175 items 1, 6): the chat host that shows it inline.
 * It speaks MCP Apps' view-to-host messages over `postMessage` with the window that frames the
 * page, whatever its origin (an MCP Apps host's sandbox can't be known in advance), and accepts
 * messages from that window only. Started by the loader (`ui://mostra/app`), it takes over the
 * loader's connection (`window.__mostraMcpApp`), so the page never initializes twice; opened by a
 * host directly, it initializes itself and waits for the tool result that names its view.
 */
import {
  type Bridge,
  connectBridge,
  MCP_APP_HANDOFF,
  MCP_APPS_MESSAGES,
  MCP_APPS_PROTOCOL_VERSION,
  type McpAppHandoff,
  type McpCallToolResult,
  mcpHostContextChanged,
  mcpResourceTeardown,
  mcpToolCancelled,
  mcpToolResult,
  mcpToolsCall,
  mcpUiInitialize,
  type UiInitializeResult,
  uiInitialized,
  uiOpenLink,
  uiSizeChanged,
} from "@mostra/protocol";

/** The version this page's build belongs to (`<meta name="mostra-version">`). */
function builtVersion(): string | undefined {
  const content = document.querySelector('meta[name="mostra-version"]')?.getAttribute("content");
  return content ? content : undefined;
}

/** What artifact_open hands the page (`structuredContent.mostra`). */
export interface McpAppHandles {
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  readonly url: string;
}

/** A host's context, as the page reads it. */
export type McpHostContext = Readonly<Record<string, unknown>>;

/** The connection, once established. */
export interface McpHostConnection {
  /** The host's answer to the handshake. */
  readonly host: UiInitializeResult;
  /** The host's context now: the handshake's, with every later change merged in. */
  context(): McpHostContext;
  /** Hears changes to the host's context; returns the function that stops. */
  onContext(listener: (context: McpHostContext) => void): () => void;
  /** The tool result the page was shown for: its handles, or `undefined` without them. */
  readonly handles: McpAppHandles | undefined;
  /** Whether the host passes the page's tool calls to its server (`serverTools`). */
  readonly tools: boolean;
  /** Calls one of the server's tools, through the host. */
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallToolResult>;
  /** Asks the host to open a link; whether it did. */
  openLink(url: string): Promise<boolean>;
  /** Tells the host the page's height, so it sizes the frame. */
  reportHeight(height: number): void;
  /** Runs `task` before the host removes the page (`ui/resource-teardown`), and answers then. */
  onTeardown(task: () => Promise<void>): void;
}

/** How long a page a host opened directly waits for the tool result that names its view. */
const RESULT_WAIT_MS = 10_000;
/** How long the handshake with a host may take. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** The handles a tool result names: `structuredContent.mostra`, checked field by field. */
export function handlesOf(result: McpCallToolResult | undefined): McpAppHandles | undefined {
  if (result === undefined || result.isError === true) return undefined;
  const mostra = (result.structuredContent as { mostra?: Record<string, unknown> } | undefined)
    ?.mostra;
  if (mostra === undefined || mostra === null || typeof mostra !== "object") return undefined;
  const { artifactId, versionId, version, url } = mostra;
  if (
    typeof artifactId !== "string" ||
    typeof versionId !== "string" ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    typeof url !== "string" ||
    !/^https?:\/\//.test(url)
  ) {
    return undefined;
  }
  return { artifactId, versionId, version, url };
}

let connecting: Promise<McpHostConnection | undefined> | undefined;

/**
 * Connects this page to the MCP Apps host that frames it, once; later calls return the same
 * connection. `undefined` when the page isn't framed, or the host doesn't answer.
 */
export function connectMcpHost(): Promise<McpHostConnection | undefined> {
  connecting ??= start();
  return connecting;
}

async function start(): Promise<McpHostConnection | undefined> {
  if (typeof window === "undefined" || window.parent === window) return undefined;
  const handoff = (window as unknown as Record<string, McpAppHandoff | undefined>)[MCP_APP_HANDOFF];
  let context: McpHostContext = {};
  const contextListeners = new Set<(context: McpHostContext) => void>();
  let resultArrived: ((result: McpCallToolResult | undefined) => void) | undefined;
  const result = new Promise<McpCallToolResult | undefined>((resolve) => {
    resultArrived = resolve;
  });
  let teardown: (() => Promise<void>) | undefined;
  const bridge: Bridge = connectBridge({
    side: "artifact",
    receiver: window,
    peer: () => window.parent,
    peerOrigin: "*",
    messages: MCP_APPS_MESSAGES,
    onRequest: async (message) => {
      if (message.method === mcpResourceTeardown.method) {
        // The page saves what the person typed before the host removes it (IN-02).
        await teardown?.().catch(() => undefined);
        return {};
      }
      throw new Error(`The page doesn't answer ${message.method}.`);
    },
    onNotification: (message, params) => {
      if (message.method === mcpHostContextChanged.method) {
        context = { ...context, ...(params as McpHostContext) };
        for (const listener of contextListeners) listener(context);
      } else if (message.method === mcpToolResult.method) {
        resultArrived?.(params as McpCallToolResult);
      } else if (message.method === mcpToolCancelled.method) {
        resultArrived?.(undefined);
      }
    },
  });
  let host: UiInitializeResult;
  let toolResult: McpCallToolResult | undefined;
  if (handoff !== undefined) {
    // The loader's connection: what arrived since it read its last is heard again, here, in the
    // same task as the bridge began listening, so nothing is lost or heard twice.
    host = handoff.initialize;
    toolResult = handoff.toolResult;
    for (const kept of handoff.claim()) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: kept.data,
          origin: kept.origin,
          source: kept.source as MessageEventSource,
        }),
      );
    }
  } else {
    try {
      host = await bridge.call(
        mcpUiInitialize,
        {
          appInfo: { name: "mostra", version: builtVersion() ?? "0" },
          appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
        },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
    } catch {
      bridge.close();
      return undefined;
    }
    bridge.notify(uiInitialized, {});
    toolResult = await Promise.race([
      result,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RESULT_WAIT_MS)),
    ]);
  }
  context = { ...(host.hostContext as McpHostContext) };
  const capabilities = host.hostCapabilities as Record<string, unknown>;
  return {
    host,
    context: () => context,
    onContext(listener) {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
    handles: handlesOf(toolResult),
    tools: capabilities["serverTools"] !== undefined,
    callTool: (name, args) => bridge.call(mcpToolsCall, { name, arguments: args }),
    async openLink(url) {
      try {
        const answer = await bridge.call(uiOpenLink, { url });
        return (answer as { isError?: boolean }).isError !== true;
      } catch {
        return false;
      }
    },
    reportHeight(height) {
      bridge.notify(uiSizeChanged, { height });
    },
    onTeardown(task) {
      teardown = task;
    },
  };
}
