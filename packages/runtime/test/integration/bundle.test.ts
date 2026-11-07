/**
 * The portable artifact package (RM-01, INTERFACES §15): a version exported as a `bundle` from one
 * home and imported into another (`artifact/import`, what `mostra run <bundle>` calls) is the same
 * version there, with the same artifact ID, version ID, digests and number, and its server code
 * runs in the importing home's workers. A bundle whose bytes don't match what it records is refused
 * before anything is kept.
 */
import { chmodSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPage } from "../action-page.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { tempDir } from "../support.ts";

interface Detail {
  readonly id: string;
  readonly versions: {
    id: string;
    number: number;
    sourceDigest: string;
    envDigest: string;
    outputDigest: string;
  }[];
}

describe("bundles move a version between homes with its identity (RM-01)", () => {
  const from = new GatewayHome();
  const to = new GatewayHome();
  let published: Receipt & { dir: string };
  let second: Receipt;
  const out = tempDir("bundles", true);

  beforeAll(async () => {
    await from.start();
    await to.start();
    published = await from.publish("actions");
    // A second version, so the number a bundle keeps isn't the default 1 by chance.
    writeFileSync(join(published.dir, "extra.ts"), "export const extra = 1;\n");
    second = ok<Receipt>(
      await from.client.call("artifact/publish", { source: { path: published.dir } }, 120_000),
    );
  }, 240_000);

  afterAll(async () => {
    await from.stop();
    await to.stop();
  });

  const exported = async (
    path: string,
    version?: number,
  ): Promise<{ files: string[]; versionId: string }> =>
    ok(
      await from.client.call("artifact/export", {
        artifact: { artifactId: published.artifactId },
        ...(version !== undefined ? { version } : {}),
        as: "bundle",
        out: path,
      }),
    );

  it("imports a directory bundle as the same artifact, version, digests and number, and runs its server code", async () => {
    expect(second.version).toBe(2);
    const bundle = join(out, "dir-bundle");
    const written = await exported(bundle);
    expect(written).toEqual({ files: [bundle], versionId: second.versionId });
    const receipt = ok<Receipt>(await to.client.call("artifact/import", { bundle }, 120_000));
    expect(receipt).toMatchObject({
      artifactId: published.artifactId,
      versionId: second.versionId,
      version: 2,
      reused: false,
    });
    const source = ok<Detail>(
      await from.client.call("artifact/get", { artifact: { artifactId: published.artifactId } }),
    ).versions.find((version) => version.id === second.versionId);
    const imported = ok<Detail>(
      await to.client.call("artifact/get", { artifact: { artifactId: published.artifactId } }),
    ).versions;
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      id: source?.id,
      number: source?.number,
      sourceDigest: source?.sourceDigest,
      envDigest: source?.envDigest,
      outputDigest: source?.outputDigest,
    });
    // The importing home serves it, and runs its server code in a worker of its own.
    const page = await openPage(receipt.url);
    const echoed = await page.call("actions.ts#echo", ["from another home"]);
    expect(echoed.status).toBe(200);
    expect(echoed.value).toMatchObject({ args: ["from another home"] });
  }, 120_000);

  it("imports an archive bundle, and an import repeated finds the version it made (reused)", async () => {
    const archive = join(out, "first.tar.zst");
    expect((await exported(archive, 1)).versionId).toBe(published.versionId);
    const first = ok<Receipt>(
      await to.client.call("artifact/import", { bundle: archive }, 120_000),
    );
    expect(first).toMatchObject({ versionId: published.versionId, version: 1, reused: false });
    const again = ok<Receipt>(
      await to.client.call("artifact/import", { bundle: archive }, 120_000),
    );
    expect(again).toMatchObject({ versionId: published.versionId, version: 1, reused: true });
  }, 120_000);

  it("refuses a bundle whose build, source, manifest or identity was changed, keeping nothing", async () => {
    const pristine = join(out, "pristine");
    await exported(pristine);
    const third = new GatewayHome();
    await third.start();
    try {
      const tamper = async (name: string, change: (dir: string) => void): Promise<string> => {
        const dir = join(out, name);
        cpSync(pristine, dir, { recursive: true });
        change(dir);
        return refused(await third.client.call("artifact/import", { bundle: dir }, 60_000));
      };
      const edit = (file: string, from: string, to: string) => (dir: string) => {
        const path = join(dir, ...file.split("/"));
        chmodSync(path, 0o644);
        const text = readFileSync(path, "utf8");
        expect(text).toContain(from);
        writeFileSync(path, text.replace(from, to));
      };
      // A changed client file.
      expect(
        await tamper("client", (dir) => {
          const path = join(dir, "version", "client", "index.html");
          chmodSync(path, 0o644);
          writeFileSync(path, `${readFileSync(path, "utf8")}<script>steal()</script>`);
        }),
      ).toBe("MOSTRA_ARTIFACT_BUNDLE_INVALID");
      // A file added beside the version's own.
      expect(
        await tamper("extra", (dir) => writeFileSync(join(dir, "version", "planted.js"), "x")),
      ).toBe("MOSTRA_ARTIFACT_BUNDLE_INVALID");
      // A manifest that grants what the source doesn't (the copy no digest covers).
      expect(
        await tamper(
          "manifest",
          edit(
            "version/manifest.json",
            '"title": "',
            '"hosted": { "actions": "link" },\n    "title": "',
          ),
        ),
      ).toBe("MOSTRA_ARTIFACT_BUNDLE_INVALID");
      // Another artifact's identity.
      expect(
        await tamper(
          "identity",
          edit("mostra-bundle.json", published.artifactId, "art_01JB8Z3QF6S7W3N8D5K2C4V9XG"),
        ),
      ).toBe("MOSTRA_ARTIFACT_BUNDLE_INVALID");
      // A changed source snapshot.
      expect(
        await tamper("source", (dir) => {
          const path = join(dir, "source.tar.zst");
          chmodSync(path, 0o644);
          writeFileSync(path, Buffer.from("not zstd"));
        }),
      ).toBe("MOSTRA_ARTIFACT_BUNDLE_INVALID");
      // Nothing of any of them was kept.
      expect(
        refused(
          await third.client.call("artifact/get", {
            artifact: { artifactId: published.artifactId },
          }),
        ),
      ).toBe("MOSTRA_ARTIFACT_NOT_FOUND");
    } finally {
      await third.stop();
    }
  }, 180_000);

  it("refuses to write over a path that exists", async () => {
    const taken = join(out, "taken");
    writeFileSync(taken, "mine");
    expect(
      refused(
        await from.client.call("artifact/export", {
          artifact: { artifactId: published.artifactId },
          as: "bundle",
          out: taken,
        }),
      ),
    ).toBe("MOSTRA_ARTIFACT_DIR_NOT_EMPTY");
    expect(readFileSync(taken, "utf8")).toBe("mine");
  });
});
