/// <reference lib="dom" />
/**
 * The shell ↔ artifact bridge (SH-04): exact source and origin checks, schema validation, and
 * message names that match MCP Apps where the concept is shared.
 */
import { readFileSync } from "node:fs";
import {
  BRIDGE_MESSAGES,
  type BridgeEvent,
  type BridgeRejection,
  connectBridge,
  MCP_APPS_PROTOCOL_VERSION,
  mostraReady,
  uiInitialize,
  uiInitialized,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

/** A fake window: delivers posted messages to its listeners as `MessageEvent`s from `source`. */
class FakeWindow {
  readonly listeners = new Set<(event: BridgeEvent) => void>();
  readonly posted: { message: unknown; targetOrigin: string }[] = [];
  readonly origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }
  addEventListener(_type: "message", listener: (event: BridgeEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: BridgeEvent) => void): void {
    this.listeners.delete(listener);
  }
  postMessage(message: unknown, targetOrigin: string): void {
    this.posted.push({ message, targetOrigin });
  }
  /** Delivers `data` to this window as if `source` (at `origin`) had posted it. */
  deliver(data: unknown, source: unknown, origin: string): void {
    for (const listener of this.listeners) listener({ data, source, origin });
  }
}

const SHELL = "http://127.0.0.1:23456";
const ARTIFACT = "http://127.0.0.1:23457";

/** A shell window and an artifact frame wired to each other, with the bridge on both ends. */
function pair() {
  const shellWindow = new FakeWindow(SHELL);
  const frameWindow = new FakeWindow(ARTIFACT);
  // Posting to a window delivers to it, from the other window, as a browser does when the target
  // origin matches; a mismatched target origin is dropped, as browsers drop it.
  shellWindow.postMessage = (message, targetOrigin) => {
    shellWindow.posted.push({ message, targetOrigin });
    if (targetOrigin === SHELL)
      queueMicrotask(() => shellWindow.deliver(message, frameWindow, ARTIFACT));
  };
  frameWindow.postMessage = (message, targetOrigin) => {
    frameWindow.posted.push({ message, targetOrigin });
    if (targetOrigin === ARTIFACT)
      queueMicrotask(() => frameWindow.deliver(message, shellWindow, SHELL));
  };
  const rejected: { side: string; reason: BridgeRejection }[] = [];
  const notifications: string[] = [];
  const shell = connectBridge({
    side: "shell",
    receiver: shellWindow,
    peer: () => frameWindow,
    peerOrigin: ARTIFACT,
    onRequest: (message) =>
      message === uiInitialize
        ? {
            protocolVersion: MCP_APPS_PROTOCOL_VERSION,
            hostInfo: { name: "mostra-shell", version: "0.0.0" },
            hostCapabilities: {},
            hostContext: { displayMode: "fullscreen", platform: "web" },
          }
        : undefined,
    onNotification: (message) => notifications.push(message.method),
    onRejected: (reason) => rejected.push({ side: "shell", reason }),
  });
  const artifact = connectBridge({
    side: "artifact",
    receiver: frameWindow,
    peer: () => shellWindow,
    peerOrigin: SHELL,
    onRejected: (reason) => rejected.push({ side: "artifact", reason }),
  });
  return { shellWindow, frameWindow, shell, artifact, rejected, notifications };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the bridge (SH-04)", () => {
  it("runs the MCP Apps handshake between the two ends", async () => {
    const { artifact, notifications, frameWindow, shellWindow } = pair();
    const result = await artifact.call(uiInitialize, {
      appInfo: { name: "mostra-artifact", version: "0.0.0" },
      appCapabilities: {},
      protocolVersion: MCP_APPS_PROTOCOL_VERSION,
    });
    expect(result.hostInfo.name).toBe("mostra-shell");
    expect(result.hostContext.displayMode).toBe("fullscreen");
    artifact.notify(uiInitialized, {});
    artifact.notify(mostraReady, {});
    await flush();
    expect(notifications).toEqual(["ui/notifications/initialized", "mostra/ready"]);
    // Every message went to the exact peer origin, never "*".
    expect(shellWindow.posted.length).toBe(3);
    expect(shellWindow.posted.every((entry) => entry.targetOrigin === SHELL)).toBe(true);
    expect(frameWindow.posted.length).toBe(1);
    expect(frameWindow.posted.every((entry) => entry.targetOrigin === ARTIFACT)).toBe(true);
  });

  it("drops a message from the right window at the wrong origin", async () => {
    const { shellWindow, frameWindow, rejected, notifications } = pair();
    shellWindow.deliver(
      { jsonrpc: "2.0", method: "mostra/ready", params: {} },
      frameWindow,
      "http://127.0.0.1:9999",
    );
    await flush();
    expect(rejected).toEqual([{ side: "shell", reason: "wrong-origin" }]);
    expect(notifications).toEqual([]);
  });

  it("drops a message from another window, even at the right origin", async () => {
    const { shellWindow, rejected, notifications } = pair();
    const stranger = new FakeWindow(ARTIFACT);
    shellWindow.deliver({ jsonrpc: "2.0", method: "mostra/ready", params: {} }, stranger, ARTIFACT);
    await flush();
    expect(rejected).toEqual([{ side: "shell", reason: "wrong-source" }]);
    expect(notifications).toEqual([]);
  });

  it("drops malformed messages, unknown methods, wrong directions and invalid params", async () => {
    const { shellWindow, frameWindow, rejected, notifications } = pair();
    for (const data of [
      "not json-rpc",
      { jsonrpc: "1.0", method: "mostra/ready" },
      [{ jsonrpc: "2.0", method: "mostra/ready" }],
      { jsonrpc: "2.0", method: "mostra/unheard-of", params: {} },
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: "wide" } },
    ]) {
      shellWindow.deliver(data, frameWindow, ARTIFACT);
    }
    // The shell never accepts what the shell itself sends: here, the artifact can't send a
    // shell-side request (there is none yet), so a request named like an artifact message, sent
    // the other way, is refused by the artifact end.
    frameWindow.deliver({ jsonrpc: "2.0", method: "mostra/ready", params: {} }, shellWindow, SHELL);
    await flush();
    expect(rejected.map((entry) => `${entry.side}:${entry.reason}`)).toEqual([
      "shell:not-json-rpc",
      "shell:not-json-rpc",
      "shell:not-json-rpc",
      "shell:unknown-method",
      "shell:invalid-params",
      "artifact:wrong-direction",
    ]);
    expect(notifications).toEqual([]);
  });

  it("answers a bad request from the right window with an error, never with a result", async () => {
    const { shellWindow, frameWindow, rejected } = pair();
    shellWindow.deliver(
      { jsonrpc: "2.0", id: 7, method: "ui/initialize", params: { appInfo: 1 } },
      frameWindow,
      ARTIFACT,
    );
    await flush();
    expect(rejected).toEqual([{ side: "shell", reason: "invalid-params" }]);
    const answer = frameWindow.posted.at(-1);
    expect(answer?.targetOrigin).toBe(ARTIFACT);
    expect(answer?.message).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32602, data: { code: "MOSTRA_HOST_INVALID_PARAMS" } },
    });
    expect(answer?.message).not.toHaveProperty("result");
  });

  it("refuses to send what the other side sends", () => {
    const { shell } = pair();
    expect(() =>
      shell.call(uiInitialize, {
        appInfo: { name: "x", version: "1" },
        appCapabilities: {},
        protocolVersion: MCP_APPS_PROTOCOL_VERSION,
      }),
    ).toThrow(/doesn't send ui\/initialize/);
  });

  it("uses MCP Apps' names, directions and shapes for every shared message", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/mcp-apps-2026-01-26.json", import.meta.url), "utf8"),
    ) as {
      protocolVersion: string;
      messages: Record<
        string,
        { from: string; kind: string; params?: string[]; result?: string[] }
      >;
    };
    expect(MCP_APPS_PROTOCOL_VERSION).toBe(fixture.protocolVersion);
    for (const message of BRIDGE_MESSAGES) {
      if (message.method.startsWith("mostra/")) continue;
      const spec = fixture.messages[message.method];
      expect(spec, `${message.method} is an MCP Apps message`).toBeDefined();
      if (!spec) continue;
      expect(message.kind).toBe(spec.kind);
      expect(message.from).toBe(spec.from === "view" ? "artifact" : "shell");
    }
    // Every message outside the mostra/ namespace is an MCP Apps message; Mostra's own are named
    // mostra/….
    expect(
      BRIDGE_MESSAGES.every((m) => m.method.startsWith("ui/") || m.method.startsWith("mostra/")),
    ).toBe(true);
    // ui/initialize's params and result carry MCP Apps' required members.
    const init = fixture.messages["ui/initialize"];
    const params = Object.fromEntries(
      (init?.params ?? []).map((key) => [
        key,
        key === "appInfo"
          ? { name: "a", version: "1" }
          : key === "protocolVersion"
            ? "2026-01-26"
            : {},
      ]),
    );
    expect(uiInitialize.params.safeParse(params).success).toBe(true);
    for (const key of init?.params ?? []) {
      const missing = { ...params };
      delete missing[key];
      expect(uiInitialize.params.safeParse(missing).success, `without ${key}`).toBe(false);
    }
  });
});
