/**
 * The MCP Apps reference host's page (WP-17, MC-02): what a web chat host does with a tool's UI,
 * on ext-apps' own AppBridge (2.0.4). It frames a sandbox proxy on another origin, which loads the
 * view's HTML under the CSP its resource declares, hands the view the tool's input and result, and
 * passes the view's tool calls and resource reads to the host's MCP client, which runs in Node as
 * a desktop host's does (exposed by the test as `mcpCallTool` and `mcpReadResource`).
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface Setup {
  /** The tool call the view is shown for. */
  readonly toolInput: Record<string, unknown>;
  readonly toolResult: Record<string, unknown>;
  /** The view's resource, as the host read it. */
  readonly html: string;
  readonly csp: Record<string, string[]> | undefined;
  /** The sandbox proxy's page, on its own origin. */
  readonly sandbox: string;
  readonly hostContext: Record<string, unknown>;
  /** A host whose server has no app-only tools: every `app_*` call fails (MC-03). */
  readonly refuseTools?: boolean;
}

declare global {
  interface Window {
    mcpCallTool(params: unknown): Promise<Record<string, unknown>>;
    mcpReadResource(params: unknown): Promise<Record<string, unknown>>;
    hostSetup: Setup;
    /** What the view asked the host to do, for the test to read. */
    hostLog: { openedLinks: string[]; heights: number[]; initialized: boolean };
    hostBridge: AppBridge;
  }
}

const setup = window.hostSetup;
window.hostLog = { openedLinks: [], heights: [], initialized: false };
const frame = document.createElement("iframe");
frame.id = "sandbox";
frame.title = "app";
frame.style.cssText = "width: 720px; height: 320px; border: 1px solid #ccc";
const csp = setup.csp === undefined ? "" : `?csp=${encodeURIComponent(JSON.stringify(setup.csp))}`;
frame.src = `${setup.sandbox}${csp}`;
document.body.append(frame);

const bridge = new AppBridge(
  null,
  { name: "mostra-reference-host", version: "1.0.0" },
  { openLinks: {}, serverTools: {}, serverResources: {}, logging: {} },
  { hostContext: setup.hostContext as never },
);
window.hostBridge = bridge;
bridge.oncalltool = async (params) => {
  if (setup.refuseTools && params.name.startsWith("app_")) {
    throw new Error(`Unknown tool: ${params.name}`);
  }
  return (await window.mcpCallTool(params)) as never;
};
bridge.onreadresource = (params) => window.mcpReadResource(params) as never;
bridge.onopenlink = async ({ url }) => {
  window.hostLog.openedLinks.push(url);
  return {};
};
bridge.onsizechange = ({ height }) => {
  if (typeof height === "number") {
    window.hostLog.heights.push(height);
    frame.style.height = `${Math.min(height, 4000)}px`;
  }
};
bridge.onsandboxready = () => {
  void bridge.sendSandboxResourceReady({
    html: setup.html,
    ...(setup.csp ? { csp: setup.csp } : {}),
  });
};
bridge.oninitialized = () => {
  window.hostLog.initialized = true;
  void bridge.sendToolInput({ arguments: setup.toolInput });
  void bridge.sendToolResult(setup.toolResult as never);
};
// The frame's window exists once it is in the document, before its page loads: the bridge hears
// the proxy's first message.
const view = frame.contentWindow as Window;
void bridge.connect(new PostMessageTransport(view, view));
