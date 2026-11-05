/**
 * The owner instance's link (WP-29, RM-02; INTERFACES §18.2, §18.7; D165 items 1, 2): a real
 * instance signs in to a real `mostra-runtime server` by the device grant, keeps its refresh token
 * in the home and none in its ledger or logs, dials the server's binding and keeps it, keeps its
 * instance link across a sign-out unless told to forget it, and dials again after a restart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
} from "../server-support.ts";
import { eventually, tempDir, WINDOWS } from "../support.ts";

interface Link {
  readonly server: string;
  readonly instanceId: string;
  readonly state: string;
  readonly default: boolean;
  readonly account: { id: string; name?: string };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.isFile()
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("the owner instance's link (§18.2)", () => {
  let port: number;
  let server: RunningServer;
  const owner = new GatewayHome();
  const status = async (): Promise<Link[]> =>
    ok<{ links: Link[] }>(await owner.client.call("remote/status", {})).links;

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({ data: tempDir("server-data"), port });
    await owner.start({ env: ownerEnv(port) });
  }, 120_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  it("signs in by the device grant and keeps its binding open", async () => {
    const signedIn = await ownerSignIn(owner.client, port, "Ada");
    expect(signedIn.instanceId).toMatch(/^lnk_/);
    await eventually(async () => (await status())[0]?.state === "connected", 15_000);
    const [link] = await status();
    expect(link).toMatchObject({
      server: `http://api.localhost:${port}`,
      instanceId: signedIn.instanceId,
      default: true,
      account: { id: signedIn.account.id, name: "Ada" },
    });

    // The refresh token lives in the home's keys, owner-only, and nowhere else Mostra writes.
    const keys = join(owner.home.home, "keys", "remote");
    const [file] = readdirSync(keys);
    const { refreshToken } = JSON.parse(readFileSync(join(keys, file as string), "utf8")) as {
      refreshToken: string;
    };
    expect(refreshToken.length).toBeGreaterThan(20);
    if (!WINDOWS) expect(statSync(join(keys, file as string)).mode & 0o077).toBe(0);
    for (const path of walk(owner.home.home)) {
      if (path.startsWith(keys)) continue;
      expect(readFileSync(path).includes(refreshToken), path).toBe(false);
    }
  });

  it("dials again by itself after the instance restarts", async () => {
    const before = (await status())[0];
    await owner.stop();
    await owner.start({ env: ownerEnv(port) });
    await eventually(async () => (await status())[0]?.state === "connected", 15_000);
    expect((await status())[0]?.instanceId).toBe(before?.instanceId);
  }, 60_000);

  it("keeps its instance link across a sign-out, and forgets it only when told to", async () => {
    const first = (await status())[0]?.instanceId;
    expect(
      ok<{ servers: string[] }>(await owner.client.call("remote/logout", {})).servers,
    ).toHaveLength(1);
    expect((await status())[0]).toMatchObject({ state: "signed-out", instanceId: first });
    expect(readdirSync(join(owner.home.home, "keys", "remote"))).toEqual([]);

    const again = await ownerSignIn(owner.client, port, "Ada");
    expect(again.instanceId).toBe(first);

    ok(await owner.client.call("remote/logout", { forget: true }));
    const fresh = await ownerSignIn(owner.client, port, "Ada");
    expect(fresh.instanceId).not.toBe(first);
    // A second instance link of the account isn't its default instance.
    expect((await status())[0]?.default).toBe(false);
  }, 60_000);

  it("names no server by default", async () => {
    const other = new GatewayHome();
    await other.start({ env: ownerEnv(port) });
    try {
      const answer = await other.client.call("remote/login", {});
      expect(answer.error?.data.code).toBe("MOSTRA_HOST_INVALID_PARAMS");
      expect(answer.error?.data.message).toContain("mostra login <server>");
    } finally {
      await other.stop();
    }
  });
});
