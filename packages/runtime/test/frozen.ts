/**
 * Frozen versions (VR-10, D111): a version published at a browser-protocol revision and kept, its
 * bytes unchanged, in `test/fixtures/browser-revisions/<revision>/` (`scripts/
 * freeze-browser-revision.ts` writes one). {@link importFrozen} brings it into a home that no
 * instance holds, through the registry's own commit, keeping its artifact and version IDs as a
 * bundle import does (RM-01), so a later gateway serves exactly what an older release built.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactManifest } from "@mostra/protocol";
import { openLedger } from "../src/ledger/index.ts";
import { silentLog } from "../src/log.ts";
import { openRegistry } from "../src/registry/index.ts";
import { tempDir } from "./support.ts";

/** Where frozen versions live, one directory per browser-protocol revision. */
export const FROZEN: string = fileURLToPath(
  new URL("./fixtures/browser-revisions/", import.meta.url),
);

/** What a frozen version records about itself. */
export interface FrozenFixture {
  readonly revision: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly sourceDigest: string;
  readonly envDigest: string;
  readonly outputDigest: string;
  readonly manifest: ArtifactManifest;
}

/** The revisions that have a frozen version, oldest first. */
export function frozenRevisions(): string[] {
  if (!existsSync(FROZEN)) return [];
  return readdirSync(FROZEN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Brings the version frozen at `revision` into `home`, which no instance holds. */
export async function importFrozen(home: string, revision: string): Promise<FrozenFixture> {
  const dir = join(FROZEN, revision);
  const fixture = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as FrozenFixture;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const opening = openLedger({
    storeDir: join(home, "store"),
    runtimeVersion: "0.0.0",
    owner: { pid: process.pid, startTime: "import/1" },
    log: silentLog,
  });
  if (!opening.ok) throw new Error("the home is held by an instance");
  const { ledger } = opening;
  try {
    const registry = await openRegistry({ home, ledger });
    const built = join(tempDir("mostra-frozen"), "version");
    cpSync(join(dir, "version"), built, { recursive: true });
    await registry.store.promote(built, fixture.versionId);
    registry.commit({
      artifactId: fixture.artifactId,
      bindingPath: join(dir, "source"),
      manifestId: undefined,
      versionId: fixture.versionId,
      sourceDigest: fixture.sourceDigest,
      envDigest: fixture.envDigest,
      outputDigest: fixture.outputDigest,
      manifest: fixture.manifest,
      policy: undefined,
      forcedCodes: [],
      stillClaims: () => false,
    });
  } finally {
    ledger.close();
  }
  return fixture;
}
