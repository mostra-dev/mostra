import { artifactListMethod, createDiagnostic, RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import type { InstanceConnection } from "../../src/client.ts";
import { daemonInstance } from "../../src/mcp.ts";

/** A stand-in for the home's daemon: each session it opens, and whether each was closed. */
function fakeDaemon(firstDies: boolean) {
  const sessions: { closed: boolean; dead: boolean }[] = [];
  const connect = async (): Promise<InstanceConnection> => {
    const index = sessions.length;
    const state = { closed: false, dead: firstDies && index === 0 };
    sessions.push(state);
    let close: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    return {
      summary: { home: "/h", socket: "/s", pid: 1, mode: "daemon", version: "0", started: false },
      warnings: [],
      async call() {
        // The first session's daemon restarts while both calls are on it.
        await new Promise((done) => setTimeout(done, 10));
        if (state.dead) {
          throw new RpcError(
            createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", { message: "restarted" }),
          );
        }
        return { artifacts: [] } as never;
      },
      onNotification() {},
      closed,
      close() {
        state.closed = true;
        close();
      },
    } as unknown as InstanceConnection;
  };
  return { sessions, connect: connect as never };
}

describe("the MCP server's session with the daemon (D164 item 5)", () => {
  it("leaves one session open when calls that met a restart ask again, and closes it (Opus review of WP-15, finding 1)", async () => {
    const daemon = fakeDaemon(true);
    const instance = daemonInstance({
      home: "/h",
      env: {},
      log: () => {},
      connect: daemon.connect,
    });
    const answers = await Promise.all([
      instance.call(artifactListMethod, {}),
      instance.call(artifactListMethod, {}),
      instance.call(artifactListMethod, {}),
    ]);
    expect(answers).toEqual([{ artifacts: [] }, { artifacts: [] }, { artifacts: [] }]);
    // The one that died and the one every call moved to; none opened behind another.
    expect(daemon.sessions).toHaveLength(2);
    instance.close();
    await new Promise((done) => setTimeout(done, 0));
    expect(daemon.sessions.filter((session) => !session.dead && !session.closed)).toEqual([]);
  });

  it("opens one session for calls made at once, and keeps it", async () => {
    const daemon = fakeDaemon(false);
    const instance = daemonInstance({
      home: "/h",
      env: {},
      log: () => {},
      connect: daemon.connect,
    });
    await Promise.all([
      instance.call(artifactListMethod, {}),
      instance.call(artifactListMethod, {}),
    ]);
    await instance.call(artifactListMethod, {});
    expect(daemon.sessions).toHaveLength(1);
    instance.close();
  });
});

describe("the HTTP server's bearer token (D164 item 3)", () => {
  it("takes a chosen token only when it is long and varied, and makes one otherwise (Opus review of WP-15, finding 10)", async () => {
    const { mcpToken } = await import("../../src/mcp.ts");
    const chosen = "S7kq2ZpXw9mRb4LvN0cTj6hY3dFg";
    expect(mcpToken({ MOSTRA_MCP_TOKEN: chosen })).toEqual({ token: chosen, generated: false });
    for (const bad of ["a".repeat(40), "abababababababababababababab", "short", `${chosen} x`]) {
      expect(() => mcpToken({ MOSTRA_MCP_TOKEN: bad }), bad).toThrow(/MOSTRA_MCP_TOKEN must be/);
    }
    const made = mcpToken({});
    expect(made.generated).toBe(true);
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{27}$/);
  });
});
