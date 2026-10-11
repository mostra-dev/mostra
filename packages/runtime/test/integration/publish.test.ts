/**
 * Publishing through the real host protocol (WP-03): a `mostra-runtime daemon` builds artifacts in
 * builder children and commits versions (AU-01 to AU-04, AU-07, VR-01, VR-11).
 */
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listingDigest, readTar, sha256Hex } from "../../src/publish/index.ts";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  removeAll,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
} from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts/", import.meta.url));

/** A fresh copy of a fixture artifact. */
function copyFixture(name: string): string {
  const target = join(tempDir(`art-${name}`), name);
  cpSync(join(FIXTURES, name), target, { recursive: true });
  return target;
}

/** Every path under `dir` with its size and modification time, to show nothing was written there. */
function treeState(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const info = statSync(path);
      out.push(`${prefix}${name} ${info.isDirectory() ? "dir" : `${info.size} ${info.mtimeMs}`}`);
      if (info.isDirectory()) walk(path, `${prefix}${name}/`);
    }
  };
  walk(dir, "");
  return out;
}

interface Receipt {
  artifactId: string;
  versionId: string;
  version: number;
  cursor: string;
  reused: boolean;
  url?: string;
}

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

const ok = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};
const publish = async (path: string, extra: Record<string, unknown> = {}): Promise<Receipt> =>
  ok(await client.call("artifact/publish", { source: { path }, ...extra })) as Receipt;
const failure = async (
  path: string,
): Promise<{ code: string; message: string; location?: unknown }> => {
  const response = await client.call("artifact/publish", { source: { path } });
  if (!response.error) throw new Error(`publishing ${path} succeeded`);
  return response.error.data as { code: string; message: string; location?: unknown };
};

beforeAll(async () => {
  home = testHome();
  daemon = await startDaemon(home);
  client = await connectTo(daemon.status.socket as string);
  ok(await client.call("mostra/initialize", initializeParams()));
});

afterAll(async () => {
  await client.call("mostra/shutdown", {});
  await daemon.exited;
});

describe("artifacts build with no configuration (AU-01, AU-02, AU-03)", () => {
  it("publishes a single plain React page, writing nothing into its directory", async () => {
    const dir = copyFixture("single-tsx");
    const before = treeState(dir);
    const receipt = await publish(join(dir, "page.tsx"));
    expect(receipt).toMatchObject({ version: 1, reused: false });
    expect(receipt.versionId).toMatch(/^ver_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(receipt.url).toBeUndefined(); // D90: the gateway (WP-05) adds it.
    expect(treeState(dir)).toEqual(before);
    const version = join(home.home, "versions", receipt.versionId);
    expect(readFileSync(join(version, "client/index.html"), "utf8")).toContain(
      "<title>single-tsx</title>",
    );
    expect(readdirSync(join(version, "client/assets")).some((file) => file.endsWith(".css"))).toBe(
      true,
    );
    expect(existsSync(join(version, "server"))).toBe(false);
    const registry = JSON.parse(readFileSync(join(version, "registry.json"), "utf8"));
    expect(registry).toMatchObject({ entry: "page.tsx", actions: [], pages: [], liveSources: [] });
    expect(readFileSync(join(version, "lock.yaml"), "utf8")).toContain('"react": "19.3.0"');
  });

  it("publishes a single MDX page with frontmatter as its manifest", async () => {
    const dir = copyFixture("single-mdx");
    const receipt = await publish(join(dir, "page.mdx"));
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    );
    expect(detail).toMatchObject({
      title: "Release notes review",
      description: "What changed in 2.4, for sign-off.",
      family: "review",
      mode: "spa",
    });
  });

  it("publishes a directory with pages, components, server modules, live sources, data and assets", async () => {
    const dir = copyFixture("directory");
    const before = treeState(dir);
    const receipt = await publish(dir);
    expect(treeState(dir)).toEqual(before);
    const version = join(home.home, "versions", receipt.versionId);
    const registry = JSON.parse(readFileSync(join(version, "registry.json"), "utf8"));
    expect(registry.pages).toEqual([
      { path: "/", file: "pages/index.tsx" },
      { path: "/reports/:id", file: "pages/reports/[id].tsx" },
      { path: "/settings", file: "pages/settings.tsx" },
    ]);
    expect(registry.actions).toEqual([
      { id: "actions.ts#archive", module: "actions.ts", export: "archive", dryRun: true },
      { id: "actions.ts#notify", module: "actions.ts", export: "notify", dryRun: false },
    ]);
    expect(registry.liveSources).toEqual([{ key: "openWork" }]);
    expect(readFileSync(join(version, "client/logo.svg"), "utf8")).toContain("<svg");
    // The server function body never reaches the browser; the server bundle has it.
    const client = readdirSync(join(version, "client/assets"))
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFileSync(join(version, "client/assets", file), "utf8"))
      .join("\n");
    expect(client).toContain("actions.ts#archive");
    expect(client).not.toContain("server-only-archive-implementation");
    expect(readFileSync(join(version, "server/entry.mjs"), "utf8")).toContain(
      "server-only-archive-implementation",
    );
  });
});

describe("metadata round-trips (AU-04)", () => {
  it("returns title, description, family, links, policy and the default mode through artifact/get and artifact/list", async () => {
    const dir = copyFixture("directory");
    const receipt = await publish(dir);
    const byPath = ok(await client.call("artifact/get", { artifact: { path: dir } })) as Record<
      string,
      unknown
    >;
    expect(byPath).toMatchObject({
      id: receipt.artifactId,
      title: "Team dashboard",
      description: "Open work and weekly reports.",
      family: "dashboard",
      links: [{ rel: "follows", artifact: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" }],
      mode: "spa",
      policy: { policy: "none" },
      manifest: { title: "Team dashboard", family: "dashboard" },
      latestVersion: { id: receipt.versionId, number: 1 },
    });
    const dashboards = ok(
      await client.call("artifact/list", { filter: { family: "dashboard" } }),
    ) as {
      artifacts: { id: string; family: string }[];
    };
    expect(dashboards.artifacts.map((artifact) => artifact.id)).toContain(receipt.artifactId);
    expect(dashboards.artifacts.every((artifact) => artifact.family === "dashboard")).toBe(true);
  });

  it("lets the host's publish policy override the manifest's request (D39)", async () => {
    const dir = copyFixture("directory");
    const receipt = await publish(dir, { policy: { policy: "once", scope: "per-viewer" } });
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    );
    expect(detail).toMatchObject({ policy: { policy: "once", scope: "per-viewer" } });
  });
});

describe("content-addressed versions (VR-01)", () => {
  it("publishes the same source again as the existing version, and a change as a new one", async () => {
    const dir = copyFixture("single-tsx");
    const file = join(dir, "page.tsx");
    const first = await publish(file);
    const again = await publish(file);
    expect(again).toEqual({ ...first, reused: true });
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
    const changed = await publish(file);
    expect(changed).toMatchObject({ artifactId: first.artifactId, version: 2, reused: false });
    expect(changed.versionId).not.toBe(first.versionId);
    const detail = ok(await client.call("artifact/get", { artifact: { path: file } })) as {
      versions: { id: string; number: number; outputDigest: string }[];
    };
    expect(detail.versions.map((version) => version.number)).toEqual([2, 1]);
    expect(detail.versions.every((version) => /^[0-9a-f]{64}$/.test(version.outputDigest))).toBe(
      true,
    );
  });

  it("ignores node_modules, .git, editor files and .mostraignore'd paths", async () => {
    const dir = copyFixture("directory");
    // .mostraignore is itself part of the source, so it is in place before the first publish.
    writeFileSync(join(dir, ".mostraignore"), "notes/\n");
    const first = await publish(dir);
    // Each ignored path, added one at a time, leaves the version as it was.
    for (const [path, text] of [
      ["node_modules/x/index.js", "x"],
      ["components/node_modules/y.js", "y"],
      [".git/HEAD", "ref"],
      [".mostra/cache.json", "{}"],
      ["index.tsx.swp", "swap"],
      ["draft.md~", "backup"],
      [".DS_Store", "finder"],
      ["notes/draft.md", "draft"],
    ] as const) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
      expect(await publish(dir), path).toEqual({ ...first, reused: true });
    }
    // A file that isn't ignored makes a new version.
    writeFileSync(join(dir, "notes.md"), "kept");
    expect((await publish(dir)).versionId).not.toBe(first.versionId);
  });

  it("gives two artifacts with identical files two versions (D89)", async () => {
    const a = copyFixture("single-tsx");
    const b = copyFixture("single-tsx");
    const first = await publish(join(a, "page.tsx"));
    const second = await publish(join(b, "page.tsx"));
    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.version).toBe(1);
  });

  it("seals the version directory read-only (invariant 3)", async () => {
    const dir = copyFixture("single-tsx");
    const receipt = await publish(join(dir, "page.tsx"));
    const version = join(home.home, "versions", receipt.versionId);
    expect(statSync(join(version, "client/index.html")).mode & 0o222).toBe(0);
    // Root writes through any mode, so the refusal is checked only for an ordinary user (as CI runs).
    if (process.getuid?.() !== 0) {
      expect(() => writeFileSync(join(version, "client/index.html"), "tampered")).toThrow();
    }
  });
});

describe("identity (AU-07)", () => {
  it("keeps a moved source's artifact through its manifest id, and refuses a copy that claims it", async () => {
    const created = ok(
      await client.call("artifact/create", {
        dir: join(tempDir("create"), "plan"),
        title: "Q3 plan",
      }),
    ) as { artifactId: string; dir: string; files: string[] };
    expect(created.files).toEqual(["index.tsx"]);
    const first = await publish(created.dir);
    expect(first.artifactId).toBe(created.artifactId);

    const moved = join(tempDir("moved"), "plan");
    renameSync(created.dir, moved);
    const afterMove = await publish(moved);
    expect(afterMove).toMatchObject({ artifactId: created.artifactId, reused: true });

    const copy = join(tempDir("copy"), "plan");
    cpSync(moved, copy, { recursive: true });
    writeFileSync(join(copy, "extra.ts"), "export const x = 1;\n");
    const conflict = await failure(copy);
    expect(conflict.code).toBe("MOSTRA_PUBLISH_ID_CONFLICT");
    expect(conflict.message).toContain(moved);
  });

  it("reports a non-literal manifest with its location", async () => {
    const dir = tempDir("nonliteral");
    writeFileSync(
      join(dir, "index.tsx"),
      [
        'import { defineArtifact } from "@mostra/react";',
        'const TITLE = "Computed";',
        "export const artifact = defineArtifact({",
        "  title: TITLE,",
        "});",
        "export default function Page() { return <p>x</p>; }",
        "",
      ].join("\n"),
    );
    const error = await failure(dir);
    expect(error).toMatchObject({
      code: "MOSTRA_MANIFEST_NOT_LITERAL",
      location: { file: "index.tsx", line: 4, column: 10 },
    });
    const list = ok(await client.call("artifact/list", {})) as { artifacts: { source?: string }[] };
    expect(list.artifacts.some((artifact) => artifact.source === dir)).toBe(false);
  });

  it("refuses artifact/create into a non-empty directory and an unknown template", async () => {
    const dir = copyFixture("single-tsx");
    const notEmpty = await client.call("artifact/create", { dir });
    expect(notEmpty.error?.data.code).toBe("MOSTRA_ARTIFACT_DIR_NOT_EMPTY");
    const template = await client.call("artifact/create", {
      dir: join(tempDir("t"), "x"),
      template: "deck",
    });
    expect(template.error?.data.code).toBe("MOSTRA_ARTIFACT_TEMPLATE_UNKNOWN");
  });

  it("names a missing source, a directory without an entry and an unknown artifact", async () => {
    expect((await failure(join(tempDir("gone"), "nothing"))).code).toBe(
      "MOSTRA_ARTIFACT_SOURCE_MISSING",
    );
    expect((await failure(tempDir("empty"))).code).toBe("MOSTRA_ARTIFACT_NO_ENTRY");
    const unknown = await client.call("artifact/get", {
      artifact: { artifactId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" },
    });
    expect(unknown.error?.data.code).toBe("MOSTRA_ARTIFACT_NOT_FOUND");
  });

  it("replays a publish with the same requestId (H-03)", async () => {
    const dir = copyFixture("single-tsx");
    const file = join(dir, "page.tsx");
    const first = await publish(file, { requestId: "req-1" });
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed after the first request\n`);
    const replay = await publish(file, { requestId: "req-1" });
    expect(replay).toEqual(first);
  });
});

describe("versions outlive their source directory (VR-11)", () => {
  it("keeps the artifact, its versions and its source snapshot readable after the directory is deleted", async () => {
    const dir = copyFixture("directory");
    const receipt = await publish(dir);
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    ) as {
      latestVersion: { sourceDigest: string };
    };
    rmSync(dir, { recursive: true });
    const afterById = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    );
    const afterByPath = ok(await client.call("artifact/get", { artifact: { path: dir } }));
    expect(afterById).toEqual(afterByPath);
    expect(afterById).toMatchObject({
      title: "Team dashboard",
      versions: [{ id: receipt.versionId }],
    });
    expect(existsSync(join(home.home, "versions", receipt.versionId, "client/index.html"))).toBe(
      true,
    );

    const archive = join(
      home.home,
      "sources",
      receipt.artifactId,
      `${detail.latestVersion.sourceDigest}.tar.zst`,
    );
    const files = readTar(zstdDecompressSync(readFileSync(archive)));
    expect(files.map((file) => file.path)).toContain("pages/reports/[id].tsx");
    const listing = files.map((file) => ({
      path: file.path,
      executable: file.executable,
      sha256: sha256Hex(file.data),
    }));
    expect(listingDigest(listing)).toBe(detail.latestVersion.sourceDigest);

    const republish = await client.call("artifact/publish", {
      source: { artifactId: receipt.artifactId },
    });
    expect(republish.error?.data.code).toBe("MOSTRA_ARTIFACT_SOURCE_MISSING");
  });
});

describe("review findings (D80)", () => {
  it("redacts capability material that reaches an error (finding 1)", async () => {
    const dir = copyFixture("single-tsx");
    const file = join(dir, "page.tsx");
    writeFileSync(
      file,
      `import data from "./missing.json?t=CAPABILITY_SECRET_12345";\nvoid data;\n${readFileSync(file, "utf8")}`,
    );
    const response = await client.call("artifact/publish", { source: { path: file } });
    expect(response.error?.data.code).toBe("MOSTRA_BUILD_UNRESOLVED");
    expect(JSON.stringify(response)).not.toContain("CAPABILITY_SECRET_12345");
    expect(response.error?.data.message).toContain("t=[redacted]");
  });

  it("refuses imports from outside the artifact, which no digest would cover (finding 5)", async () => {
    const parent = tempDir("outside");
    const dir = join(parent, "artifact");
    cpSync(join(FIXTURES, "single-tsx"), dir, { recursive: true });
    writeFileSync(join(parent, "shared.ts"), "export const shared = 1;\n");
    const file = join(dir, "page.tsx");
    writeFileSync(
      file,
      `import { shared } from "../shared";\nvoid shared;\n${readFileSync(file, "utf8")}`,
    );
    // The snapshot holds only the artifact, so a relative import out of it finds nothing.
    expect((await failure(file)).code).toBe("MOSTRA_BUILD_UNRESOLVED");
    writeFileSync(
      file,
      `import { shared } from ${JSON.stringify(join(parent, "shared.ts"))};\nvoid shared;\n${readFileSync(join(FIXTURES, "single-tsx/page.tsx"), "utf8")}`,
    );
    // An absolute path would resolve; it is refused, because no digest covers its bytes.
    const absolute = await failure(file);
    expect(absolute.code).toBe("MOSTRA_BUILD_UNRESOLVED");
    expect(absolute.message).toContain("outside the artifact");
    // Plain text: the bundler's terminal colours are stripped.
    expect(stripVTControlCharacters(absolute.message)).toBe(absolute.message);
  });

  it("records an outputDigest that the stored version reproduces, execute bits and all (findings 6, 7)", async () => {
    const dir = copyFixture("directory");
    writeFileSync(join(dir, "public/tool.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(dir, "public/tool.sh"), 0o755);
    const receipt = await publish(dir);
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    ) as {
      latestVersion: { outputDigest: string };
    };
    // The listing of the stored, sealed tree, built here from DATA_MODEL §2's rules alone.
    const version = join(home.home, "versions", receipt.versionId);
    const listing: { path: string; executable: boolean; sha256: string }[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
        else {
          const handle = openSync(path, "r");
          try {
            listing.push({
              path: `${prefix}${entry.name}`,
              executable: (fstatSync(handle).mode & 0o111) !== 0,
              sha256: sha256Hex(readFileSync(handle)),
            });
          } finally {
            closeSync(handle);
          }
        }
      }
    };
    walk(join(version, "client"), "client/");
    walk(join(version, "server"), "server/");
    listing.push({
      path: "registry.json",
      executable: false,
      sha256: sha256Hex(readFileSync(join(version, "registry.json"))),
    });
    expect(listing.map((file) => file.path)).toContain("client/tool.sh");
    expect(listingDigest(listing)).toBe(detail.latestVersion.outputDigest);
  });

  it("publishes a single file whose name isn't in NFC (finding 9)", async () => {
    const dir = tempDir("nfc");
    const file = join(dir, "cafe\u0301.tsx");
    cpSync(join(FIXTURES, "single-tsx/page.tsx"), file);
    const receipt = await publish(file);
    expect(receipt).toMatchObject({ version: 1, reused: false });
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: receipt.artifactId } }),
    );
    expect(detail).toMatchObject({ title: "caf\u00e9" });
  });

  it("keeps a .cts server module's body out of the client, source maps included (Claude finding 2)", async () => {
    const dir = join(tempDir("cts"), "artifact");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "actions.cts"),
      '"use server";\nexport async function secretThing() { return "CTS_SERVER_BODY_MARKER"; }\n',
    );
    writeFileSync(
      join(dir, "index.tsx"),
      'import { secretThing } from "./actions.cts";\nexport default function Page() { return <button onClick={() => void secretThing()}>go</button>; }\n',
    );
    const receipt = await publish(dir);
    const version = join(home.home, "versions", receipt.versionId);
    const registry = JSON.parse(readFileSync(join(version, "registry.json"), "utf8")) as {
      actions: { id: string }[];
    };
    expect(registry.actions.map((action) => action.id)).toEqual(["actions.cts#secretThing"]);
    const client: string[] = [];
    const walk = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(path, entry.name));
        else client.push(readFileSync(join(path, entry.name), "utf8"));
      }
    };
    walk(join(version, "client"));
    expect(client.join("\n")).not.toContain("CTS_SERVER_BODY_MARKER");
    expect(readFileSync(join(version, "server", "entry.mjs"), "utf8")).toContain(
      "CTS_SERVER_BODY_MARKER",
    );
  });

  it("rebuilds a lost or altered version directory when the same source is published again (Claude finding 3)", async () => {
    const dir = join(copyFixture("single-tsx"), "page.tsx");
    const first = await publish(dir);
    const version = join(home.home, "versions", first.versionId);
    const recorded = (): string =>
      (JSON.parse(readFileSync(join(version, "manifest.json"), "utf8")) as { outputDigest: string })
        .outputDigest;

    removeAll(version);
    expect(await publish(dir)).toEqual({ ...first, reused: true });
    expect(existsSync(join(version, "client", "index.html"))).toBe(true);
    expect(statSync(version).mode & 0o777).toBe(0o555);
    const restored = recorded();

    // An edit inside the sealed directory is damage too.
    chmodSync(version, 0o755);
    chmodSync(join(version, "client"), 0o755);
    chmodSync(join(version, "client", "index.html"), 0o644);
    writeFileSync(join(version, "client", "index.html"), "<p>tampered</p>");
    expect(await publish(dir)).toEqual({ ...first, reused: true });
    expect(readFileSync(join(version, "client", "index.html"), "utf8")).not.toContain("tampered");
    expect(recorded()).toBe(restored);

    // The artifact still has one version, number 1.
    const detail = ok(
      await client.call("artifact/get", { artifact: { artifactId: first.artifactId } }),
    ) as { versions: unknown[] };
    expect(detail.versions).toHaveLength(1);
  });

  it("finds an artifact by any spelling of its path that the file system accepts (Claude finding 4)", async () => {
    const parent = tempDir("spelling");
    const dir = join(parent, "CasePlan");
    cpSync(join(FIXTURES, "single-tsx"), dir, { recursive: true });
    renameSync(join(dir, "page.tsx"), join(dir, "index.tsx"));
    const other = join(parent, "caseplan");
    // Only a case-insensitive file system (macOS's default) has a second spelling to test.
    if (!existsSync(other)) return;
    const receipt = await publish(other);
    const detail = ok(await client.call("artifact/get", { artifact: { path: other } })) as {
      id: string;
    };
    expect(detail.id).toBe(receipt.artifactId);
  });

  it("lists the artifact published most recently first, a republished earlier version included (Claude finding 5)", async () => {
    const x = join(copyFixture("single-tsx"), "page.tsx");
    const original = readFileSync(x, "utf8");
    const first = await publish(x);
    writeFileSync(x, `${original}\n// v2\n`);
    await publish(x);
    const y = await publish(join(copyFixture("single-mdx"), "page.mdx"));
    writeFileSync(x, original);
    expect(await publish(x)).toMatchObject({ versionId: first.versionId, reused: true });
    const ids = (
      ok(await client.call("artifact/list", {})) as { artifacts: { id: string }[] }
    ).artifacts.map((artifact) => artifact.id);
    expect(ids.indexOf(first.artifactId)).toBeLessThan(ids.indexOf(y.artifactId));
    expect(ids[0]).toBe(first.artifactId);
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports an entry the publisher can't read as unreadable, not as an internal error (Claude finding 7)",
    async () => {
      const dir = copyFixture("directory");
      chmodSync(join(dir, "index.tsx"), 0o000);
      try {
        const failed = await failure(dir);
        expect(failed.code).toBe("MOSTRA_ARTIFACT_SOURCE_UNREADABLE");
        expect(failed.message).toContain("index.tsx");
      } finally {
        chmodSync(join(dir, "index.tsx"), 0o644);
      }
    },
  );
});
