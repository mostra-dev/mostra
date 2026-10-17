/**
 * The five seams of D19 that make a later `rsc` render mode additive (RS-01), through a real
 * daemon: seam 1, the manifest's `mode`; seam 2, `"use server"` functions with React's Server
 * Function type set, compiled to stubs in the client; seam 3, each call's context from
 * AsyncLocalStorage in the worker; seam 5, building and serving through the `RenderMode` contract.
 * Seam 4 (a `"use client"` runtime) is `@mostra/react`'s own test (`test/seams.test.ts`).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpaRenderMode } from "../../src/builder/index.ts";
import { openPage } from "../action-page.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { tempDir } from "../support.ts";

interface Detail {
  manifest: { mode?: string };
  versions: { envDigest: string; id: string }[];
}

describe("the five seams of D19 (RS-01)", () => {
  const gateway = new GatewayHome();
  let actions: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start();
    actions = await gateway.publish("actions");
  }, 240_000);
  afterAll(() => gateway.stop());

  const detail = async (artifactId: string): Promise<Detail> =>
    ok<Detail>(await gateway.client.call("artifact/get", { artifact: { artifactId } }));

  it("seam 1: the manifest declares `mode`, `spa` by default and part of the version's identity", async () => {
    const page = (mode: string) =>
      `import { defineArtifact } from "@mostra/react";\nexport const artifact = defineArtifact({ title: "Modes"${mode} });\nexport default function Page() { return <p>modes</p>; }\n`;
    const dir = join(tempDir("modes"), "modes");
    mkdirSync(dir);
    writeFileSync(join(dir, "index.tsx"), page(""));
    const implicit = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    );
    // Saying `spa` explicitly is the same build: the mode is in `envDigest` as `spa` either way.
    writeFileSync(join(dir, "index.tsx"), page(', mode: "spa"'));
    ok(await gateway.client.call("artifact/publish", { source: { path: dir } }, 120_000));
    const versions = (await detail(implicit.artifactId)).versions;
    expect(versions).toHaveLength(2);
    expect(versions[0]?.envDigest).toBe(versions[1]?.envDigest);
    expect((await detail(implicit.artifactId)).manifest.mode).toBe("spa");
    // A mode this release doesn't build is refused, never built as something else.
    writeFileSync(join(dir, "index.tsx"), page(', mode: "rsc"'));
    const refused = await gateway.client.call(
      "artifact/publish",
      { source: { path: dir } },
      120_000,
    );
    expect(refused.error?.data.code).toBe("MOSTRA_MANIFEST_INVALID");
  });

  it("seam 2: `use server` functions take and return React's Server Function types, as stubs in the client", async () => {
    const page = await openPage((await gateway.link(actions.artifactId)).url);
    const form = new FormData();
    form.set("name", "Ada");
    form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    const args = [
      "text",
      42,
      -0,
      Number.NaN,
      10n ** 20n,
      true,
      null,
      undefined,
      // A sparse array keeps its hole, as React's Server Functions do.
      // biome-ignore lint/suspicious/noSparseArray: the hole is what this case checks.
      [1, , 3],
      { nested: { deep: [new Date(0)] } },
      new Map<unknown, unknown>([["k", new Set([1, 2])]]),
      new Uint8Array([1, 2, 3]),
      form,
    ];
    const echoed = await page.call("actions.ts#echo", args);
    expect(echoed.end).toEqual({ status: "succeeded" });
    const value = echoed.value as { args: unknown[] };
    expect(value.args.slice(0, 12)).toEqual(args.slice(0, 12));
    const received = value.args[12] as FormData;
    expect(received.get("name")).toBe("Ada");
    expect(await (received.get("file") as File).text()).toBe("hello");
    // A registered symbol is a result, never an argument: `Symbol.for` would keep a page's names
    // for the life of the worker (D136, as React's reply codec refuses it).
    expect((await page.call("actions.ts#symbolic", [])).value).toBe(Symbol.for("mostra.seam"));
    await expect(page.call("actions.ts#echo", [Symbol.for("mostra.seam")])).rejects.toMatchObject({
      code: "MOSTRA_ACTION_UNSERIALIZABLE",
    });
    // Outside the type set is refused at the boundary, naming the argument.
    class Mail {}
    await expect(page.call("actions.ts#echo", [new Mail()])).rejects.toMatchObject({
      code: "MOSTRA_ACTION_UNSERIALIZABLE",
    });
    // The client build holds the stub with the function's ID, never its body.
    const version = join(gateway.home.home, "versions", actions.versionId);
    const client = readdirSync(join(version, "client/assets"))
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFileSync(join(version, "client/assets", file), "utf8"))
      .join("\n");
    expect(client).toContain("actions.ts#echo");
    expect(client).not.toContain("from a process");
    expect(readFileSync(join(version, "server/entry.mjs"), "utf8")).toContain("from a process");
  });

  it("seam 3: each call's context comes from AsyncLocalStorage, across awaits and concurrent calls", async () => {
    const ada = await openPage(
      (await gateway.link(actions.artifactId, { viewer: { ref: "ada", name: "Ada" } })).url,
    );
    const bob = await openPage(
      (await gateway.link(actions.artifactId, { viewer: { ref: "bob", name: "Bob" } })).url,
    );
    // Interleaved in one worker: Ada's call waits longest, Bob's starts after it and ends first.
    const [slow, fast] = await Promise.all([
      ada.call("actions.ts#whoAfter", [600]),
      new Promise((resolve) => setTimeout(resolve, 100)).then(() =>
        bob.call("actions.ts#whoAfter", [50]),
      ),
    ]);
    expect(slow.value).toBe("Ada");
    expect(fast.value).toBe("Bob");
  });

  it("seam 5: building and serving go through the RenderMode contract, with SPA its first mode", async () => {
    const spa = createSpaRenderMode({
      processes: undefined as never,
      log: undefined as never,
    });
    expect(spa.id).toBe("spa");
    expect(spa.capabilities({ hasServerCode: false })).toEqual({
      staticExport: true,
      mcpApp: true,
      needsWorker: false,
    });
    expect(spa.capabilities({ hasServerCode: true }).needsWorker).toBe(true);
    // What a worker loads from a version is the render mode's answer: the server bundle when the
    // version has server code, nothing otherwise.
    const version = join(gateway.home.home, "versions", actions.versionId);
    expect(spa.serverEntry(version)).toBe(join(version, "server/entry.mjs"));
    const clientOnly = await gateway.publish("single-tsx", "page.tsx");
    expect(
      spa.serverEntry(join(gateway.home.home, "versions", clientOnly.versionId)),
    ).toBeUndefined();
  });
});
