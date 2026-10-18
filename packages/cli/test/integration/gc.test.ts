/**
 * VR-06 and LL-05 through the built `mostra` against a real daemon. gc never removes a version a
 * view, a live pinned link or the artifact's latest names; it lists exactly what it then collects;
 * a collected version keeps its ID and number, can't be linked, and comes back when its exact
 * source is published again (D140 item 14). doctor warns about artifacts with submission policy
 * `none` in a home without a login service, and stops once `daemon install` wrote one (D96).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cli, envelope, type TestHome, testHome, Viewer } from "../support.ts";

let home: TestHome;
let dir = "";
let artifactId = "";
let template = "";

/** Publishes the artifact with `marker` in its page; returns the receipt. */
async function publish(
  marker: string,
  flags: string[] = [],
): Promise<{ versionId: string; version: number; url: string }> {
  writeFileSync(
    join(dir, "index.tsx"),
    template.replace("{artifact.title}", `{artifact.title} ${marker}`),
  );
  const ran = await cli(["publish", dir, ...flags, "--json"], { env: home.env });
  const value = envelope(ran);
  expect(value.ok, ran.stderr).toBe(true);
  return value.result as { versionId: string; version: number; url: string };
}

async function json(
  args: string[],
): Promise<{ ok: boolean; result: unknown; error?: { code: string } }> {
  return envelope(await cli([...args, "--json"], { env: home.env })) as {
    ok: boolean;
    result: unknown;
    error?: { code: string };
  };
}

beforeAll(async () => {
  home = testHome();
  dir = join(home.root, "dashboard");
  const created = await json(["new", dir, "--title", "Dashboard"]);
  artifactId = (created.result as { artifactId: string }).artifactId;
  template = readFileSync(join(dir, "index.tsx"), "utf8");
});

afterAll(async () => {
  await home.cleanup();
});

describe("VR-06: gc keeps every referenced version", () => {
  it("collects only the unreferenced version, keeps its ID and number, and restores it on republish", async () => {
    const v1 = await publish("one");
    // A view of v1: a viewer opened it.
    await new Viewer().open(v1.url);
    const v2 = await publish("two");
    // A live link pinned to v2.
    const pinned = await json(["open", artifactId, "--version", "2", "--no-browser"]);
    const pinnedToken = (pinned.result as { tokenId: string }).tokenId;
    const v3 = await publish("three");
    const v4 = await publish("four");
    expect([v1.version, v2.version, v3.version, v4.version]).toEqual([1, 2, 3, 4]);

    const dry = (await json(["gc", "--dry-run"])).result as {
      dryRun: boolean;
      versions: { versionId: string; number: number }[];
    };
    expect(dry.dryRun).toBe(true);
    expect(dry.versions.map((version) => version.number)).toEqual([3]);
    // A dry run removes nothing.
    expect(existsSync(join(home.home, "versions", v3.versionId))).toBe(true);

    const real = (await json(["gc"])).result as {
      versions: { versionId: string; number: number }[];
    };
    expect(real.versions).toEqual(dry.versions);
    expect(existsSync(join(home.home, "versions", v3.versionId))).toBe(false);
    for (const kept of [v1, v2, v4])
      expect(existsSync(join(home.home, "versions", kept.versionId))).toBe(true);

    // The tombstone: v3 keeps its row, ID and number, marked collected; no link opens it.
    const detail = (await json(["status", artifactId])).result as {
      versions: { id: string; number: number; collected?: string }[];
    };
    const tomb = detail.versions.find((version) => version.number === 3);
    expect(tomb?.id).toBe(v3.versionId);
    expect(tomb?.collected).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const refused = await json(["open", artifactId, "--version", "3", "--no-browser"]);
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("MOSTRA_ARTIFACT_VERSION_COLLECTED");

    // A second run finds nothing more while the references hold.
    expect(((await json(["gc", "--dry-run"])).result as { versions: unknown[] }).versions).toEqual(
      [],
    );

    // Revoking the pinned link frees v2.
    await json(["open", artifactId, "--revoke", pinnedToken]);
    const freed = (await json(["gc"])).result as { versions: { number: number }[] };
    expect(freed.versions.map((version) => version.number)).toEqual([2]);

    // Republishing v3's exact source restores its files under the same ID and number.
    const again = await publish("three");
    expect(again.versionId).toBe(v3.versionId);
    expect(again.version).toBe(3);
    expect(existsSync(join(home.home, "versions", v3.versionId, "manifest.json"))).toBe(true);
    const restored = (await json(["status", artifactId])).result as {
      versions: { number: number; collected?: string }[];
    };
    expect(restored.versions.find((version) => version.number === 3)?.collected).toBeUndefined();
    // It is the latest again, so gc keeps it; v4 is now the unreferenced one.
    const next = (await json(["gc", "--dry-run"])).result as { versions: { number: number }[] };
    expect(next.versions.map((version) => version.number)).toEqual([4]);
  });

  it("doctor doesn't report a collected version as damaged", async () => {
    const doctor = await json(["doctor", "--deep"]);
    const versions = (doctor.result as { checks: { name: string; status: string }[] }).checks.find(
      (check) => check.name === "versions",
    );
    expect(versions?.status).toBe("ok");
  });
});

describe("LL-05: doctor warns about long-lived artifacts without an always-on daemon", () => {
  it("warns for policy none without a login service, and not once daemon install wrote one", async () => {
    const other = testHome();
    try {
      const longLived = join(other.root, "tasks");
      const run = async (args: string[]) =>
        envelope(await cli([...args, "--json"], { env: other.env }));
      await run(["new", longLived, "--title", "Tasks"]);
      const quiet = await run(["doctor"]);
      expect(
        (quiet.result as { checks: { name: string; status: string }[] }).checks.find(
          (check) => check.name === "always-on",
        )?.status,
      ).toBe("ok");
      await run(["publish", longLived, "--policy", "none"]);
      const warned = await run(["doctor"]);
      const check = (
        warned.result as {
          checks: { name: string; status: string; diagnostic?: { code: string } }[];
        }
      ).checks.find((entry) => entry.name === "always-on");
      expect(check?.status).toBe("warning");
      expect(check?.diagnostic?.code).toBe("MOSTRA_HOME_NOT_ALWAYS_ON");
      // A warning isn't a failure: doctor still exits 0.
      expect(warned.ok).toBe(true);
      // The login service's file, written without asking launchd or systemd to load it.
      await run(["daemon", "install", "--no-start"]);
      const settled = await run(["doctor"]);
      expect(
        (settled.result as { checks: { name: string; status: string }[] }).checks.find(
          (entry) => entry.name === "always-on",
        )?.status,
      ).toBe("ok");
      await run(["daemon", "uninstall", "--no-start"]);
    } finally {
      await other.cleanup();
    }
  });
});
