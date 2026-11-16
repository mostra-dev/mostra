/**
 * Mostra in an MCP Apps host (D175, INTERFACES §12): the messages a page exchanges with a chat
 * host that renders it as an MCP App, the app-only tools the page acts through, and the handles
 * `artifact_open`'s result gives the page. The page is MCP Apps' View and its chat host the Host
 * (VERIFIED_FACTS, WP-17); it speaks the same JSON-RPC core as Mostra's shell bridge
 * ({@link connectBridge} with {@link MCP_APPS_MESSAGES} and the peer origin `"*"`, since a host's
 * sandbox origin isn't known in advance), so the page's client runtime only swaps its transport.
 */
import * as z from "zod";
import {
  type AnyBridgeMessage,
  type BridgeHostContext,
  type BridgeImplementation,
  type BridgeMessage,
  type UiInitializeParams,
  type UiInitializeResult,
  uiInitialized,
  uiOpenLink,
  uiSizeChanged,
} from "./bridge.ts";

/** The MIME type of an MCP App's resource (MCP Apps, `RESOURCE_MIME_TYPE`). */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The MCP extension a host names when it renders MCP Apps (MCP Apps, capability negotiation). */
export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";

/**
 * The loader `artifact_open` declares as its view (D175 item 1): MCP Apps names a tool's view on
 * its definition, so one page reads each version's MCP App itself.
 */
export const MCP_APP_LOADER_URI = "ui://mostra/app";

/** The `ui://` URI of a version's MCP App (INTERFACES §12): what `mcp-app` exports. */
export function mcpAppUri(versionId: string): string {
  return `ui://mostra/view/${versionId}`;
}

/** The version a {@link mcpAppUri} names, or `undefined` for another URI. */
export function versionOfMcpAppUri(uri: string): string | undefined {
  const match = /^ui:\/\/mostra\/view\/(ver_[0-9A-HJKMNP-TV-Z]{26})$/.exec(uri);
  return match?.[1];
}

/** What a resource declares of its view (MCP Apps' `UIResourceMeta`, the part Mostra sets). */
export interface McpAppResourceMeta {
  /** The origins the page reaches (MCP Apps' `McpUiResourceCsp`); absent: none. */
  readonly csp?: {
    readonly connectDomains?: readonly string[];
    readonly resourceDomains?: readonly string[];
    readonly frameDomains?: readonly string[];
    readonly baseUriDomains?: readonly string[];
  };
  /** Whether the host draws a border and background around the page. */
  readonly prefersBorder?: boolean;
}

const Origins = z.array(z.string().min(1).max(512)).max(64).readonly().exactOptional();

/** The Zod schema of the `McpAppResourceMeta` type. */
export const McpAppResourceMeta: z.ZodType<McpAppResourceMeta> = z.looseObject({
  csp: z
    .looseObject({
      connectDomains: Origins,
      resourceDomains: Origins,
      frameDomains: Origins,
      baseUriDomains: Origins,
    })
    .exactOptional(),
  prefersBorder: z.boolean().exactOptional(),
}) as z.ZodType<McpAppResourceMeta>;

/**
 * What `artifact_open` hands the page in its result's `structuredContent.mostra` (D175 item 1):
 * the link the page acts through (its secret in the URL's fragment) and the version it shows.
 */
export interface McpAppHandles {
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  /** The capability link (`…#t=<secret>`), the same the model hands the person. */
  readonly url: string;
}

/** The Zod schema of the `McpAppHandles` type. */
export const McpAppHandles: z.ZodType<McpAppHandles> = z.looseObject({
  artifactId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  version: z.int().min(1),
  url: z.string().min(1).max(8192),
}) as z.ZodType<McpAppHandles>;

/** The secret of a capability link: its fragment's `t` (D97). */
export function linkSecret(url: string): string | undefined {
  const hash = url.indexOf("#");
  if (hash === -1) return undefined;
  for (const part of url.slice(hash + 1).split("&")) {
    if (!part.startsWith("t=")) continue;
    const value = part.slice(2);
    return /^[0-9A-Za-z]{1,256}$/.test(value) ? value : undefined;
  }
  return undefined;
}

/**
 * The app-only tools an inline page acts through (D175 item 5), each one browser-protocol route
 * over `app/request`, plus `app_open`. Their names are a contract between `@mostra/react` and
 * `@mostra/mcp`.
 */
export const APP_TOOLS = {
  open: "app_open",
  fields: "app_fields",
  submit: "app_submit",
  signal: "app_signal",
  call: "app_call",
  run: "app_run",
  runStatus: "app_run_status",
  runCancel: "app_run_cancel",
  live: "app_live",
  respondents: "app_respondents",
  events: "app_events",
} as const;

/** One of {@link APP_TOOLS}' names. */
export type AppToolName = (typeof APP_TOOLS)[keyof typeof APP_TOOLS];

// ── The messages (MCP Apps 2026-01-26) ───────────────────────────────────────────────────

const Implementation: z.ZodType<BridgeImplementation> = z.looseObject({
  name: z.string(),
  version: z.string(),
  title: z.string().exactOptional(),
});

/**
 * A host's context as MCP Apps sends it: any object, read field by field where it is used, so a
 * host's value this release doesn't know never costs the page its context.
 */
const HostContext: z.ZodType<BridgeHostContext> = z.record(
  z.string(),
  z.unknown(),
) as z.ZodType<BridgeHostContext>;

/**
 * `ui/initialize` with an MCP Apps host: the page introduces itself, and the host answers with its
 * context. A host's answer is read leniently (a missing `hostCapabilities` or `hostContext` is
 * empty), so a host that sends less than the specification still shows the page.
 */
export const mcpUiInitialize: BridgeMessage<UiInitializeParams, UiInitializeResult> = {
  method: "ui/initialize",
  from: "artifact",
  kind: "request",
  params: z.looseObject({
    appInfo: Implementation,
    appCapabilities: z.record(z.string(), z.unknown()),
    protocolVersion: z.string().min(1),
  }) as z.ZodType<UiInitializeParams>,
  result: z.looseObject({
    protocolVersion: z.string().catch(""),
    hostInfo: Implementation.catch({ name: "", version: "" }),
    hostCapabilities: z.record(z.string(), z.unknown()).catch({}),
    hostContext: HostContext.catch({}),
  }) as unknown as z.ZodType<UiInitializeResult>,
};

/** A tool's result (MCP's `CallToolResult`), as a host passes it on. */
export interface McpCallToolResult {
  readonly content?: readonly { readonly type: string; readonly [key: string]: unknown }[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

const CallToolResult: z.ZodType<McpCallToolResult> = z.looseObject({
  content: z
    .array(z.looseObject({ type: z.string() }))
    .readonly()
    .exactOptional(),
  structuredContent: z.record(z.string(), z.unknown()).exactOptional(),
  isError: z.boolean().exactOptional(),
  _meta: z.record(z.string(), z.unknown()).exactOptional(),
}) as z.ZodType<McpCallToolResult>;

/** `tools/call`: the page calls a tool of its server through the host (an app-only tool). */
export const mcpToolsCall: BridgeMessage<
  { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> },
  McpCallToolResult
> = {
  method: "tools/call",
  from: "artifact",
  kind: "request",
  params: z.looseObject({
    name: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()).exactOptional(),
  }),
  result: CallToolResult,
};

/** One resource's contents, as `resources/read` answers it. */
export interface McpResourceContents {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** `resources/read`: the page reads a resource of its server through the host (the loader). */
export const mcpResourcesRead: BridgeMessage<
  { readonly uri: string },
  { readonly contents: readonly McpResourceContents[] }
> = {
  method: "resources/read",
  from: "artifact",
  kind: "request",
  params: z.looseObject({ uri: z.string().min(1).max(2048) }),
  result: z.looseObject({
    contents: z
      .array(
        z.looseObject({
          uri: z.string(),
          mimeType: z.string().exactOptional(),
          text: z.string().exactOptional(),
          blob: z.string().exactOptional(),
          _meta: z.record(z.string(), z.unknown()).exactOptional(),
        }),
      )
      .readonly(),
  }) as z.ZodType<{ readonly contents: readonly McpResourceContents[] }>,
};

/** `notifications/message`: a log line the page gives its host. */
export const mcpLogMessage: BridgeMessage<
  { readonly level: string; readonly data: unknown; readonly logger?: string },
  undefined
> = {
  method: "notifications/message",
  from: "artifact",
  kind: "notification",
  params: z.looseObject({
    level: z.string(),
    data: z.unknown(),
    logger: z.string().exactOptional(),
  }) as z.ZodType<{ readonly level: string; readonly data: unknown; readonly logger?: string }>,
  result: z.undefined(),
};

/** `ui/notifications/tool-input`: the arguments of the tool call the page was shown for. */
export const mcpToolInput: BridgeMessage<
  { readonly arguments?: Readonly<Record<string, unknown>> },
  undefined
> = {
  method: "ui/notifications/tool-input",
  from: "shell",
  kind: "notification",
  params: z.looseObject({ arguments: z.record(z.string(), z.unknown()).exactOptional() }),
  result: z.undefined(),
};

/** `ui/notifications/tool-input-partial`: arguments while the model still streams them. */
export const mcpToolInputPartial: BridgeMessage<
  { readonly arguments?: Readonly<Record<string, unknown>> },
  undefined
> = {
  method: "ui/notifications/tool-input-partial",
  from: "shell",
  kind: "notification",
  params: z.looseObject({ arguments: z.record(z.string(), z.unknown()).exactOptional() }),
  result: z.undefined(),
};

/** `ui/notifications/tool-result`: the result of the tool call the page was shown for. */
export const mcpToolResult: BridgeMessage<McpCallToolResult, undefined> = {
  method: "ui/notifications/tool-result",
  from: "shell",
  kind: "notification",
  params: CallToolResult,
  result: z.undefined(),
};

/** `ui/notifications/tool-cancelled`: the tool call the page was shown for was cancelled. */
export const mcpToolCancelled: BridgeMessage<{ readonly reason?: string }, undefined> = {
  method: "ui/notifications/tool-cancelled",
  from: "shell",
  kind: "notification",
  params: z.looseObject({ reason: z.string().exactOptional() }),
  result: z.undefined(),
};

/** `ui/notifications/host-context-changed`: part of the host's context changed (merge it). */
export const mcpHostContextChanged: BridgeMessage<BridgeHostContext, undefined> = {
  method: "ui/notifications/host-context-changed",
  from: "shell",
  kind: "notification",
  params: HostContext,
  result: z.undefined(),
};

/** `ui/resource-teardown`: the host will remove the page; it answers once its work is saved. */
export const mcpResourceTeardown: BridgeMessage<
  { readonly reason?: string },
  Readonly<Record<string, unknown>>
> = {
  method: "ui/resource-teardown",
  from: "shell",
  kind: "request",
  params: z.looseObject({ reason: z.string().exactOptional() }),
  result: z.record(z.string(), z.unknown()),
};

/** Every message a page and its MCP Apps host exchange (D175). */
export const MCP_APPS_MESSAGES: readonly AnyBridgeMessage[] = [
  mcpUiInitialize,
  uiInitialized,
  uiSizeChanged,
  uiOpenLink,
  mcpToolsCall,
  mcpResourcesRead,
  mcpLogMessage,
  mcpToolInput,
  mcpToolInputPartial,
  mcpToolResult,
  mcpToolCancelled,
  mcpHostContextChanged,
  mcpResourceTeardown,
] as readonly AnyBridgeMessage[];

/**
 * The global the loader (`ui://mostra/app`) leaves a version's page it starts (D175 item 1): the
 * host connection it opened, so the page initializes once. Internal to Mostra's loader and client
 * runtime; its shape is {@link McpAppHandoff}.
 */
export const MCP_APP_HANDOFF = "__mostraMcpApp";

/** What the loader hands the page it starts. */
export interface McpAppHandoff {
  /** The host's answer to the loader's `ui/initialize`. */
  readonly initialize: UiInitializeResult;
  /** The tool call's arguments and result, as the host sent them. */
  readonly toolInput?: Readonly<Record<string, unknown>>;
  readonly toolResult?: McpCallToolResult;
  /**
   * Takes over the host connection: the loader stops reading the window's messages and returns
   * those that arrived since it read its last (the page's listener, added in the same task, hears
   * every later one, so none is lost or heard twice). Its own requests used string IDs
   * (`mostra-loader-<n>`), so the page's numbered ones never meet them.
   */
  claim(): readonly { readonly data: unknown; readonly origin: string; readonly source: unknown }[];
}
