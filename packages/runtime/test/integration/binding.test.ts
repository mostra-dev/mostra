/**
 * The network binding, sign-in by the device grant and `hosted/push` (WP-29, RM-02; INTERFACES
 * §18.2, §18.5; D165 items 2, 3): through a real `mostra-runtime server`, an owner signs in as a
 * person would, dials `/host` with its access token, opens a session as a hosted home's host and
 * pushes a version, sending only the client files the server lacks and never server code.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HostedPushResult,
  hostedPushMethod,
  type ListingEntry,
  remoteTokenMethod,
  type VersionPush,
} from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type Binding, ownerInitialize, startBinding } from "../../src/link/index.ts";
import { silentLog } from "../../src/log.ts";
import { listingDigest, versionIdFor } from "../../src/publish/index.ts";
import {
  deviceSignIn,
  freePort,
  postForm,
  type RunningServer,
  type SignedIn,
  send,
  startServer,
  stopServer,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const running: RunningServer[] = [];
const bindings: Binding[] = [];
afterEach(async () => {
  for (const binding of bindings.splice(0)) await binding.stop();
  for (const server of running.splice(0)) await stopServer(server);
});

async function serve(): Promise<{ port: number; data: string; server: RunningServer }> {
  const port = await freePort();
  const data = tempDir("server-data");
  const server = await startServer({ data, port });
  running.push(server);
  return { port, data, server };
}

function bind(
  port: number,
  signedIn: SignedIn,
  extra: Partial<Parameters<typeof startBinding>[0]> = {},
): Binding {
  const binding = startBinding({
    server: `http://api.localhost:${port}`,
    connectTo: { host: "127.0.0.1", port },
    accessToken: async () => signedIn.accessToken,
    initialize: () =>
      ownerInitialize({
        name: "mostra-test",
        version: "0.0.0",
        instanceId: signedIn.instanceId,
        relayMark: 0,
      }),
    onRequest: () => ({ accepted: true }),
    log: silentLog,
    ...extra,
  });
  bindings.push(binding);
  return binding;
}

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A version as an owner would push it: two client files, a server bundle and the registry. */
function version(
  artifactId: string,
  marker: string,
): { push: VersionPush; files: Map<string, string> } {
  const files = new Map<string, string>([
    ["client/index.html", `<!doctype html><title>${marker}</title>`],
    ["client/assets/app.js", `console.log(${JSON.stringify(marker)});`],
    ["server/entry.mjs", `export const functions = {}; // SERVER-CODE-${marker}`],
    ["registry.json", JSON.stringify({ schemaVersion: 1, entry: "index.tsx", actions: [] })],
  ]);
  const listing: ListingEntry[] = [...files].map(([path, text]) => [
    path,
    false,
    sha(text),
    Buffer.byteLength(text),
  ]);
  const sourceDigest = sha(`source ${marker}`);
  const envDigest = sha("env");
  const versionId = versionIdFor(artifactId, sourceDigest, envDigest);
  const outputDigest = listingDigest(
    listing.map(([path, executable, hash]) => ({ path, executable, sha256: hash })),
  );
  return {
    files,
    push: {
      versionId,
      number: 1,
      sourceDigest,
      envDigest,
      outputDigest,
      manifest: JSON.stringify({
        schemaVersion: 1,
        artifactId,
        versionId,
        manifest: { title: marker },
      }),
      registry: files.get("registry.json") as string,
      lock: "lockfileVersion: 1\n",
      listing,
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("sign-in by the device grant (§18.5)", () => {
  it("links a machine once a person approves, and rotates refresh tokens", async () => {
    const { port } = await serve();
    const metadata = JSON.parse(
      (await send(port, `api.localhost:${port}`, "/.well-known/oauth-authorization-server")).body,
    );
    expect(metadata.grant_types_supported).toContain(
      "urn:ietf:params:oauth:grant-type:device_code",
    );

    // Polling before approval waits; the page warns what approving does.
    const started = JSON.parse(
      (await postForm(port, "/oauth/device", { client_id: "mostra-cli" })).body,
    );
    const pending = await postForm(port, "/oauth/token", {
      client_id: "mostra-cli",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: started.device_code,
    });
    expect(JSON.parse(pending.body).error).toBe("authorization_pending");
    const devicePage = await send(
      port,
      `api.localhost:${port}`,
      `/device?user_code=${started.user_code}`,
    );
    expect(devicePage.body).toContain("Approving links a machine to your account");
    // A form posted from another site approves nothing.
    const forged = await postForm(
      port,
      "/device",
      { user_code: started.user_code, name: "Mallory", provider: "dev", decision: "approve" },
      { origin: "http://evil.localhost" },
    );
    expect(forged.status).toBe(403);

    const ada = await deviceSignIn(port, "Ada");
    expect(ada.instanceId).toMatch(/^lnk_/);
    expect(ada.accountId).toMatch(/^acct_/);

    const refresh = (token: string) =>
      postForm(port, "/oauth/token", {
        client_id: "mostra-cli",
        grant_type: "refresh_token",
        refresh_token: token,
      });
    const first = JSON.parse((await refresh(ada.refreshToken)).body);
    expect(first.refresh_token).not.toBe(ada.refreshToken);
    // A parallel refresh within 30 s gets the same successor, never a second one.
    const again = JSON.parse((await refresh(ada.refreshToken)).body);
    expect(again.refresh_token).toBe(first.refresh_token);

    // The same machine signing in again keeps its instance link.
    const back = await deviceSignIn(port, "Ada", { mostra_instance: ada.instanceId });
    expect(back.instanceId).toBe(ada.instanceId);
    expect(back.accountId).toBe(ada.accountId);
  });
});

describe("the network binding (§18.2)", () => {
  it("refuses a dial without a valid token with 401 and the resource metadata", async () => {
    const { port } = await serve();
    const status = await new Promise<{ status: number; auth: string | undefined }>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/host`, "mostra.host", {
        headers: {
          host: `api.localhost:${port}`,
          authorization: "Bearer not-a-token-at-all-really",
        },
      });
      socket.on("unexpected-response", (_request, response) =>
        resolve({ status: response.statusCode ?? 0, auth: response.headers["www-authenticate"] }),
      );
      socket.on("error", () => {});
    });
    expect(status.status).toBe(401);
    expect(status.auth).toContain("resource_metadata=");
  });

  it("opens a hosted session, pushes only the missing client files and stores no server code", async () => {
    const { port, data } = await serve();
    const ada = await deviceSignIn(port, "Ada");
    const binding = bind(port, ada);
    const session = await binding.ready();
    expect(session.result.instance.mode).toBe("hosted");
    expect(session.result.instance.incarnation).toMatch(/^[0-9a-f]{32}$/);

    const artifactId = "art_01JZ0000000000000000000000";
    const { push, files } = version(artifactId, "first");
    const pushed: HostedPushResult = await session.call(hostedPushMethod, {
      artifactId,
      version: push,
    });
    expect(pushed.status).toBe("missing");
    if (pushed.status !== "missing") throw new Error("expected missing");
    expect(pushed.route.routeId).toMatch(/^rte_/);
    expect(pushed.route.label).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    // Only the client files are asked for, never the server bundle.
    const clientShas = [files.get("client/index.html"), files.get("client/assets/app.js")].map(
      (text) => sha(text as string),
    );
    expect([...pushed.files].sort()).toEqual([...clientShas].sort());

    // A file nobody asked for, and bytes that don't hash to their name, are refused.
    const auth = { authorization: `Bearer ${ada.accessToken}` };
    const stray = await send(port, `api.localhost:${port}`, `/files/${sha("stray")}`, {
      method: "PUT",
      headers: auth,
      body: "stray",
    });
    expect(stray.status).toBe(409);
    const wrong = await send(port, `api.localhost:${port}`, `/files/${clientShas[0]}`, {
      method: "PUT",
      headers: auth,
      body: "not it",
    });
    expect(wrong.status).toBe(400);
    for (const path of ["client/index.html", "client/assets/app.js"]) {
      const text = files.get(path) as string;
      const put = await send(port, `api.localhost:${port}`, `/files/${sha(text)}`, {
        method: "PUT",
        headers: auth,
        body: text,
      });
      expect(put.status).toBe(201);
    }
    const done = await session.call(hostedPushMethod, { artifactId, version: push });
    expect(done).toMatchObject({
      status: "complete",
      versionId: push.versionId,
      number: 1,
      route: pushed.route,
    });
    // Idempotent by version ID.
    expect(await session.call(hostedPushMethod, { artifactId, version: push })).toMatchObject({
      status: "complete",
    });

    // No server code anywhere in the data directory (D165 item 3).
    const marker = "SERVER-CODE-first";
    for (const file of walk(data)) {
      expect(readFileSync(file).includes(marker), file).toBe(false);
    }

    // A listing that doesn't match the output digest is refused before anything is kept.
    const tampered = { ...push, outputDigest: sha("other") };
    await expect(
      session.call(hostedPushMethod, { artifactId, version: tampered }),
    ).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_HOME_INTEGRITY" },
    });
  });

  it("tells one home nothing of another's files, and takes from it only what its own push asks for (RM-03)", async () => {
    const { port } = await serve();
    const ada = await deviceSignIn(port, "Ada");
    const grace = await deviceSignIn(port, "Grace");
    expect(grace.accountId).not.toBe(ada.accountId);
    const adas = await bind(port, ada).ready();
    const graces = await bind(port, grace).ready();
    // One copied project: the same artifact ID and the same version, byte for byte, in two homes.
    const artifactId = "art_01JZ0000000000000000000001";
    const { push, files } = version(artifactId, "copied");
    const clientShas = ["client/index.html", "client/assets/app.js"].map((path) =>
      sha(files.get(path) as string),
    );
    const upload = (who: SignedIn, text: string) =>
      send(port, `api.localhost:${port}`, `/files/${sha(text)}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${who.accessToken}` },
        body: text,
      });
    const first = await adas.call(hostedPushMethod, { artifactId, version: push });
    expect(first.status).toBe("missing");
    for (const path of ["client/index.html", "client/assets/app.js"]) {
      expect((await upload(ada, files.get(path) as string)).status).toBe(201);
    }
    const adaDone = await adas.call(hostedPushMethod, { artifactId, version: push });
    expect(adaDone.status).toBe("complete");

    // Grace's home is asked for every client file, though the server stores them already for Ada:
    // no answer says what another home holds, and a home must send every byte of its own versions.
    const second = await graces.call(hostedPushMethod, { artifactId, version: push });
    expect(second.status).toBe("missing");
    if (second.status !== "missing") throw new Error("expected missing");
    expect([...second.files].sort()).toEqual([...clientShas].sort());
    // Its own route: neither home can take the other's.
    expect(second.route.routeId).not.toBe(first.route.routeId);
    expect(second.route.label).not.toBe(first.route.label);
    // Only what its pending push names: a file of Ada's other versions isn't Grace's to send.
    expect((await upload(grace, "never asked for")).status).toBe(409);
    // Asking for a file directly tells nothing either: the same answer for a file the server holds
    // for another home as for one nobody has.
    for (const method of ["HEAD", "GET"]) {
      const held = await send(port, `api.localhost:${port}`, `/files/${clientShas[0]}`, {
        method,
        headers: { authorization: `Bearer ${grace.accessToken}` },
      });
      const none = await send(port, `api.localhost:${port}`, `/files/${sha("nobody's")}`, {
        method,
        headers: { authorization: `Bearer ${grace.accessToken}` },
      });
      expect(held.status, method).toBe(none.status);
      expect(held.status, method).not.toBe(200);
    }
    for (const path of ["client/index.html", "client/assets/app.js"]) {
      expect((await upload(grace, files.get(path) as string)).status).toBe(201);
    }
    const graceDone = await graces.call(hostedPushMethod, { artifactId, version: push });
    expect(graceDone).toMatchObject({ status: "complete", versionId: push.versionId });
  }, 120_000);

  it("refuses a listing path that would leave the version on any system (Opus review of WP-29, 5)", async () => {
    const { port } = await serve();
    const owner = await deviceSignIn(port, "Ada");
    const artifactId = "art_01JZ0000000000000000000009";
    const session = await bind(port, owner).ready();
    for (const path of [
      "client/..\\..\\..\\homes\\x",
      "client/C:\\x",
      "client/a:stream",
      "client/tab\tname",
      "client/cafe\u0301.js",
      "client/a/../../x",
    ]) {
      const { push, files } = version(artifactId, `escape ${path}`);
      const text = files.get("client/index.html") as string;
      const listing: ListingEntry[] = [
        ...push.listing,
        [path, false, sha(text), Buffer.byteLength(text)],
      ];
      const outputDigest = listingDigest(
        listing.map(([p, executable, hash]) => ({ path: p, executable, sha256: hash })),
      );
      await expect(
        session.call(hostedPushMethod, { artifactId, version: { ...push, listing, outputDigest } }),
        path,
      ).rejects.toMatchObject({ diagnostic: { code: "MOSTRA_HOME_INTEGRITY" } });
    }
  });

  it("never takes a binding without its own link for an owner (Opus review of WP-29, 6)", async () => {
    const { port } = await serve();
    const owner = await deviceSignIn(port, "Ada");
    const other = await deviceSignIn(port, "Ada");
    const artifactId = "art_01JZ000000000000000000000A";
    await (await bind(port, owner).ready()).call(hostedPushMethod, {
      artifactId,
      version: version(artifactId, "owned by Ada's first machine").push,
    });
    // Another machine of the account says it is the owner by its client name, with no link.
    const closed: string[] = [];
    bind(port, other, {
      initialize: () => {
        const { link: _link, ...rest } = ownerInitialize({
          name: owner.instanceId,
          version: "0.0.0",
          instanceId: other.instanceId,
          relayMark: 0,
        });
        return rest;
      },
      onClose: (why) => closed.push(why),
    });
    await eventually(() => /must name its own instance link/.test(closed.join(" ")));
    // A reader with no ports needs no link.
    const reader = await bind(port, other, {
      initialize: () => {
        const { link: _link, ...rest } = ownerInitialize({
          name: "a reader",
          version: "0.0.0",
          instanceId: other.instanceId,
          relayMark: 0,
        });
        return { ...rest, ports: [] };
      },
    }).ready();
    expect(reader.result.instance.mode).toBe("hosted");
  });

  it("refuses a push from another instance of the account, naming the owner", async () => {
    const { port } = await serve();
    const owner = await deviceSignIn(port, "Ada");
    const other = await deviceSignIn(port, "Ada");
    expect(other.instanceId).not.toBe(owner.instanceId);
    const artifactId = "art_01JZ0000000000000000000001";
    const { push } = version(artifactId, "owned");
    const first = await bind(port, owner).ready();
    await first.call(hostedPushMethod, { artifactId, version: push });
    const second = await bind(port, other).ready();
    await expect(
      second.call(hostedPushMethod, { artifactId, version: push }),
    ).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_REMOTE_NOT_OWNER_INSTANCE" },
    });
  });

  it("takes a fresh token in band, and closes the binding within the bound once its grant is revoked", async () => {
    const port = await freePort();
    const data = tempDir("server-data");
    const server = await startServer({ data, port, env: { MOSTRA_TEST_GRANT_RECHECK_MS: "200" } });
    running.push(server);
    const ada = await deviceSignIn(port, "Ada");
    const closes: string[] = [];
    const binding = bind(port, ada, { onClose: (why) => closes.push(why) });
    const session = await binding.ready();
    const refreshed = JSON.parse(
      (
        await postForm(port, "/oauth/token", {
          client_id: "mostra-cli",
          grant_type: "refresh_token",
          refresh_token: ada.refreshToken,
        })
      ).body,
    );
    const answer = await session.call(remoteTokenMethod, { accessToken: refreshed.access_token });
    expect(Date.parse(answer.expiresAt)).toBeGreaterThan(Date.now() + 50 * 60_000);
    // Another grant's token isn't this binding's.
    const other = await deviceSignIn(port, "Grace");
    await expect(
      session.call(remoteTokenMethod, { accessToken: other.accessToken }),
    ).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_REMOTE_LOGIN_FAILED" },
    });

    await postForm(port, "/oauth/revoke", { token: refreshed.refresh_token });
    const deadline = Date.now() + 5_000;
    while (!closes.some((why) => why.includes("4403")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(closes.some((why) => why.includes("4403"))).toBe(true);
  });
  it("closes a binding at its token's expiry unless the token was refreshed in band", async () => {
    const port = await freePort();
    const server = await startServer({
      data: tempDir("server-data"),
      port,
      env: { MOSTRA_TEST_GRANT_RECHECK_MS: "200", MOSTRA_TEST_ACCESS_TTL_MS: "3000" },
    });
    running.push(server);
    const ada = await deviceSignIn(port, "Ada");
    const closes: string[] = [];
    // Never refreshed: closed at the expiry, with 4401.
    const stale = bind(port, ada, { onClose: (why) => closes.push(why) });
    await stale.ready();
    const opened = Date.now();
    while (!closes.some((why) => why.includes("4401")) && Date.now() - opened < 8_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stale.stop();
    expect(closes.some((why) => why.includes("4401"))).toBe(true);
    expect(Date.now() - opened).toBeGreaterThan(1_500);
    // Refreshed in band before each expiry: it stays open past several.
    const fresh = await deviceSignIn(port, "Grace");
    const kept: string[] = [];
    const live = bind(port, fresh, { onClose: (why) => kept.push(why) });
    const session = await live.ready();
    let refresh = fresh.refreshToken;
    for (let round = 0; round < 4; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const answer = JSON.parse(
        (
          await postForm(port, "/oauth/token", {
            client_id: "mostra-cli",
            grant_type: "refresh_token",
            refresh_token: refresh,
          })
        ).body,
      );
      refresh = answer.refresh_token;
      await session.call(remoteTokenMethod, { accessToken: answer.access_token });
    }
    expect(kept).toEqual([]);
    live.stop();
  }, 60_000);

  it("rotates a hosted home's incarnation when restored by hand, and when it opens below its marks", async () => {
    const { port, data, server } = await serve();
    const ada = await deviceSignIn(port, "Ada");
    const incarnationNow = async (): Promise<string> => {
      const binding = bind(port, ada);
      try {
        return (await binding.ready()).result.instance.incarnation as string;
      } finally {
        binding.stop();
      }
    };
    const first = await incarnationNow();
    // A restart alone keeps it.
    await stopServer(server);
    const again = await startServer({ data, port });
    running.push(again);
    expect(await incarnationNow()).toBe(first);
    // `--restored all`: a self-hoster restored the directory by hand.
    await stopServer(again);
    const restored = await startServer({ data, port, args: ["--restored", "all"] });
    running.push(restored);
    const second = await incarnationNow();
    expect(second).not.toBe(first);
    // A home whose head is below what the directory recorded for it was restored too.
    await stopServer(restored);
    const directory = new Database(join(data, "server.sqlite"));
    directory.prepare("UPDATE home_cursor SET high_cursor = high_cursor + 1000").run();
    directory.close();
    const below = await startServer({ data, port });
    running.push(below);
    expect(await incarnationNow()).not.toBe(second);
  }, 120_000);
});
