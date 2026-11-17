/**
 * The app channel (D175 item 4) through a real `mostra-runtime daemon`: an inline page, which an
 * MCP Apps host shows, opens a view with its link's secret (`app/open`) and reaches the same
 * browser-protocol routes a browser page does (`app/request`), behind the same session, link and
 * scope checks; a browser can never present an app session, nor an inline page a cookie.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_PROTOCOL_REVISION, linkSecret, MutationId, serializeAll } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { tempDir } from "../support.ts";

interface AppView {
  readonly artifactId: string;
  readonly viewId: string;
  readonly version: { readonly id: string; readonly number: number };
  readonly target: string;
  readonly session: string;
  readonly scopes: readonly string[];
  readonly viewer: { readonly id: string; readonly kind: string };
  readonly submitChannels: readonly string[];
}

interface Answer {
  readonly status: number;
  readonly body?: Record<string, unknown>;
  readonly lines?: readonly Record<string, unknown>[];
}

describe("the app channel (D175 item 4, MC-02)", () => {
  const gateway = new GatewayHome();
  let actions: Receipt & { dir: string };
  let other: Receipt & { dir: string };

  const open = async (url: string, artifactId: string, extra: Record<string, unknown> = {}) =>
    ok<AppView>(
      await gateway.client.call("app/open", {
        artifactId,
        token: linkSecret(url),
        ...extra,
      }),
    );
  const request = async (view: AppView, params: Record<string, unknown>): Promise<Answer> =>
    ok<Answer>(
      await gateway.client.call(
        "app/request",
        { artifactId: view.artifactId, session: view.session, ...params },
        60_000,
      ),
    );

  beforeAll(async () => {
    await gateway.start();
    actions = await gateway.publish("actions");
    other = await gateway.publish("single-tsx", "page.tsx");
  }, 240_000);

  afterAll(async () => {
    await gateway.stop();
  });

  it("opens a view of the link's version with an app session, as a frame ticket would", async () => {
    const view = await open(actions.url, actions.artifactId);
    expect(view.target).toBe("mcp-app");
    expect(view.version.id).toBe(actions.versionId);
    expect(view.session).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.viewer.kind).toBe("local");
    expect(view.submitChannels).toContain("artifact");
    expect(view.scopes).toContain("draft");
  });

  it("saves fields, reads them back in a snapshot, and submits on the artifact channel", async () => {
    const view = await open(actions.url, actions.artifactId);
    const mutated = await request(view, {
      route: "fields",
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: view.viewId,
        ops: [{ id: "answer", value: "inline" }],
      },
    });
    expect(mutated.status).toBe(200);
    expect(mutated.body?.["applied"]).toEqual(["answer"]);
    const poll = await request(view, { route: "events/poll", view: view.viewId, wait: 0 });
    expect(poll.status).toBe(200);
    const snapshot = poll.body?.["snapshot"] as { draft: { fields: Record<string, unknown> } };
    expect(JSON.stringify(snapshot.draft)).toContain("inline");
    const submitted = await request(view, {
      route: "submit",
      body: {
        viewId: view.viewId,
        expectedRevision: String(mutated.body?.["revision"]),
        channel: "artifact",
      },
    });
    expect(submitted.status).toBe(200);
    const results = ok<{ submission: { channel: string; viewId: string }; answers: unknown }>(
      await gateway.client.call("results/get", { artifact: { artifactId: actions.artifactId } }),
    );
    expect(results.submission.channel).toBe("artifact");
    expect(results.submission.viewId).toBe(view.viewId);
    expect(results.answers).toEqual({ answer: "inline" });
  });

  it("calls a server function and starts a run, as a page's runtime does", async () => {
    const view = await open(actions.url, actions.artifactId);
    const call = await request(view, {
      route: "call",
      fnId: "actions.ts#echo",
      body: { viewId: view.viewId, args: await serializeAll(["hi"], { mode: "argument" }) },
    });
    expect(call.status).toBe(200);
    expect(call.lines?.at(-1)).toMatchObject({ end: { status: "succeeded" } });
    const run = await request(view, {
      route: "runs",
      body: {
        viewId: view.viewId,
        fnId: "actions.ts#echo",
        args: await serializeAll(["again"], { mode: "argument" }),
        clientKey: "app-channel-run-0001",
      },
    });
    expect(run.status).toBe(200);
    const runId = (run.body as { runId?: string }).runId;
    expect(runId).toMatch(/^run_/);
    const attached = await request(view, {
      route: "runs/attach",
      body: { viewId: view.viewId, runIds: [runId] },
    });
    expect(attached.status).toBe(200);
  });

  it("refuses a link that isn't one, and a session for another artifact", async () => {
    expect(
      refused(
        await gateway.client.call("app/open", {
          artifactId: actions.artifactId,
          token: "0".repeat(26),
        }),
      ),
    ).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    // A link's secret opens only its own artifact.
    expect(
      refused(
        await gateway.client.call("app/open", {
          artifactId: other.artifactId,
          token: linkSecret(actions.url),
        }),
      ),
    ).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
    const view = await open(actions.url, actions.artifactId);
    const crossed = await request(
      { ...view, artifactId: other.artifactId },
      { route: "events/poll", view: view.viewId },
    );
    expect(crossed.status).toBe(401);
    const guessed = await request(
      { ...view, session: "1".repeat(26) },
      { route: "events/poll", view: view.viewId },
    );
    expect(guessed.status).toBe(401);
  });

  it("applies the link's scopes, as the HTTP runner does", async () => {
    const viewOnly = await gateway.link(actions.artifactId, { scopes: ["view"] });
    const view = await open(viewOnly.url, actions.artifactId);
    const write = await request(view, {
      route: "fields",
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: view.viewId,
        ops: [{ id: "answer", value: "no" }],
      },
    });
    expect(write.status).toBe(403);
    expect(write.body?.["code"]).toBe("MOSTRA_HYGIENE_SCOPE_DENIED");
    const call = await request(view, {
      route: "call",
      fnId: "actions.ts#echo",
      body: { viewId: view.viewId, args: await serializeAll([], { mode: "argument" }) },
    });
    expect(call.status).toBe(403);
  });

  it("stops working when its link is revoked", async () => {
    const link = await gateway.link(actions.artifactId);
    const view = await open(link.url, actions.artifactId);
    ok(await gateway.client.call("view/revoke", { tokenId: link.tokenId }));
    const poll = await request(view, { route: "events/poll", view: view.viewId });
    expect(poll.status).toBe(410);
    expect(
      refused(
        await gateway.client.call("app/open", {
          artifactId: actions.artifactId,
          token: linkSecret(link.url),
        }),
      ),
    ).toBe("MOSTRA_HYGIENE_TOKEN_REVOKED");
  });

  it("opens a pinned link at its version only", async () => {
    const pinned = await gateway.link(actions.artifactId, { version: 1 });
    expect((await open(pinned.url, actions.artifactId)).version.number).toBe(1);
    expect(
      refused(
        await gateway.client.call("app/open", {
          artifactId: actions.artifactId,
          token: linkSecret(pinned.url),
          version: 2,
        }),
      ),
    ).toBe("MOSTRA_HYGIENE_SCOPE_DENIED");
  });

  it("never lets a browser present an app session, nor the app channel a browser's", async () => {
    const view = await open(actions.url, actions.artifactId);
    const browser = new Browser();
    const opened = await openLink(browser, actions.url);
    const port = new URL(opened.frameOrigin).port;
    const path = `/_mostra/v/${BROWSER_PROTOCOL_REVISION}/events/poll?view=${opened.viewId}&wait=0`;
    // The frame's own session polls, as a page does: the request is a browser's, well formed.
    expect((await browser.fetchJson(opened.frameOrigin, path)).status).toBe(200);
    const key = [...browser.jar.keys()].find((name) => name.startsWith(`mostra-${port} `));
    const frameSession = key === undefined ? undefined : browser.jar.get(key);
    expect(frameSession).toBeDefined();
    // The same request with the app session in the cookie is refused: it is no cookie session.
    browser.jar.set(key as string, {
      ...(frameSession as NonNullable<typeof frameSession>),
      value: view.session,
    });
    expect((await browser.fetchJson(opened.frameOrigin, path)).status).toBe(401);
    // The frame's session, presented on the app channel, is no app session.
    const asApp = await request(
      { ...view, session: frameSession?.value ?? "" },
      { route: "events/poll", view: opened.viewId },
    );
    expect(asApp.status).toBe(401);
  });
});

describe("the MCP App every home has (D175 items 2, 3, MC-02)", () => {
  const gateway = new GatewayHome();
  let actions: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start();
    actions = await gateway.publish("actions");
  }, 240_000);

  afterAll(async () => {
    await gateway.stop();
  });

  it("lists the bundled exporter for the home, and refuses to remove it", async () => {
    const listed = ok<{ plugins: { package: string; scope: string; contributions: unknown[] }[] }>(
      await gateway.client.call("plugin/list", { home: true }),
    );
    const bundled = listed.plugins.find((plugin) => plugin.package === "@mostra/plugin-mcp-app");
    expect(bundled?.scope).toBe("bundled");
    expect(bundled?.contributions).toEqual([{ contract: "exporter", id: "mcp-app" }]);
    expect(
      refused(
        await gateway.client.call("plugin/remove", {
          home: true,
          packages: ["@mostra/plugin-mcp-app"],
        }),
      ),
    ).toBe("MOSTRA_PLUGIN_NOT_INSTALLED");
  });

  it("exports a version as an MCP App with nothing installed (plugin/export)", async () => {
    const out = join(tempDir("mcp-app-export"), "app");
    const exported = ok<{ files: string[]; entry?: string; exporter: { package: string } }>(
      await gateway.client.call(
        "plugin/export",
        { artifact: { artifactId: actions.artifactId }, exporter: "mcp-app", out },
        120_000,
      ),
    );
    expect(exported.exporter.package).toBe("@mostra/plugin-mcp-app");
    expect(exported.entry).toBe(join(out, "index.html"));
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain('<meta name="mostra-target" content="mcp-app" />');
    expect(html).toContain(`<meta name="mostra-version" content="${actions.versionId}" />`);
    // The version's server code never reaches an export (D172 item 11).
    expect(html).not.toContain("execFileSync");
    const description = JSON.parse(readFileSync(join(out, "mcp-app.json"), "utf8")) as {
      uri: string;
      mimeType: string;
    };
    expect(description.uri).toBe(`ui://mostra/view/${actions.versionId}`);
    expect(description.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("answers a version's MCP App (app/page), made once and kept", async () => {
    const first = ok<{ artifactId: string; uri: string; html: string; meta: unknown }>(
      await gateway.client.call("app/page", { versionId: actions.versionId }, 120_000),
    );
    expect(first.artifactId).toBe(actions.artifactId);
    expect(first.uri).toBe(`ui://mostra/view/${actions.versionId}`);
    expect(first.html.startsWith("<!doctype html>")).toBe(true);
    const cache = join(gateway.home.home, "cache", "mcp-app", actions.versionId);
    expect(readdirSync(cache)).toHaveLength(1);
    // The second answer is the kept page itself, never made again: marked here, it comes back so.
    const kept = join(cache, readdirSync(cache)[0] as string, "index.html");
    expect(readFileSync(kept, "utf8")).toBe(first.html);
    writeFileSync(kept, `${first.html}<!-- kept -->`);
    const again = ok<{ html: string }>(
      await gateway.client.call("app/page", { versionId: actions.versionId }),
    );
    expect(again.html).toBe(`${first.html}<!-- kept -->`);
    expect(
      refused(
        await gateway.client.call("app/page", { versionId: "ver_ABCDEFGHJKMNPQRSTVWXYZ0123" }),
      ),
    ).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
  });
});
