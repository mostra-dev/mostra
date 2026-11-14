/**
 * Source packs through a real daemon (D30, EX-03): shadcn's own registry items, unchanged
 * (`test/fixtures/shadcn`), installed with their registry dependencies from a local registry
 * server as shadcn would install them; GitHub registries through a local fake of GitHub; a
 * namespace `components.json` registers; a pack an installed plugin carries; and what an install
 * refuses before it writes anything: a file that exists, a place outside the artifact, a license
 * not acknowledged (D31), and an offline read.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pluginFixtures } from "../plugin-fixtures.ts";
import { type FakeRegistry, FIXTURE_PACKAGES, startRegistry } from "../registry.ts";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
  WINDOWS,
} from "../support.ts";

const SHADCN = fileURLToPath(new URL("../fixtures/shadcn/", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
/** shadcn's form for a header read from the environment, `${ACME_TOKEN}`, spelled out. */
const ACME_TOKEN_REFERENCE = ["$", "{ACME_TOKEN}"].join("");

interface Running {
  readonly home: TestHome;
  readonly daemon: RuntimeProcess & { status: DaemonStatus };
  readonly client: LineClient;
}

const running: Running[] = [];
let npm: FakeRegistry;
let web: Server;
let base: string;
const requests: string[] = [];

/** The GitHub repository the fake serves: `acme/ui` at {@link SHA}. */
const repo: Record<string, string> = {
  "registry.json": JSON.stringify({
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: "acme-ui",
    homepage: "https://example.com",
    include: ["items/registry.json"],
  }),
  "items/registry.json": JSON.stringify({
    items: [
      {
        name: "badge-row",
        type: "registry:component",
        registryDependencies: ["card"],
        files: [{ path: "badge-row.tsx", type: "registry:component" }],
        cssVars: { theme: { "color-badge": "oklch(0.7 0.1 140)" }, light: { badge: "#0a0" } },
        mostra: { base: "base", fields: ["badges.selected"] },
      },
      {
        name: "engine-panel",
        type: "registry:component",
        dependencies: ["fixture-engine@2.0.0"],
        files: [{ path: "engine-panel.tsx", type: "registry:component" }],
      },
      {
        name: "escape",
        type: "registry:file",
        files: [{ path: "badge-row.tsx", type: "registry:file", target: "~/../outside.tsx" }],
      },
    ],
  }),
  "items/badge-row.tsx":
    'import { Card } from "@/registry/new-york-v4/ui/card";\nexport function BadgeRow() {\n  return <Card className="text-badge">badges</Card>;\n}\n',
  "items/engine-panel.tsx": "export function EnginePanel() {\n  return <p>engine</p>;\n}\n",
};

beforeAll(async () => {
  npm = await startRegistry([...FIXTURE_PACKAGES, ...pluginFixtures()]);
  web = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push(url.pathname);
    // shadcn's registry: /r/styles/<style>/<name>.json
    const item = /^\/r\/styles\/([^/]+)\/([^/]+)\.json$/.exec(url.pathname);
    if (item) {
      const file = join(SHADCN, "styles", item[1] as string, `${item[2]}.json`);
      if (!existsSync(file)) return void response.writeHead(404).end();
      return void response
        .writeHead(200, { "content-type": "application/json" })
        .end(readFileSync(file));
    }
    // A namespace's registry: /acme/<name>.json
    const named = /^\/acme\/([^/]+)\.json$/.exec(url.pathname);
    if (named) {
      if (request.headers["x-token"] !== "s3cret") return void response.writeHead(401).end();
      const file = join(SHADCN, "styles", "new-york-v4", `${named[1]}.json`);
      if (!existsSync(file)) return void response.writeHead(404).end();
      return void response.writeHead(200).end(readFileSync(file));
    }
    // GitHub's API: a ref to its commit.
    const commit = /^\/api\/repos\/acme\/ui\/commits\/(.+)$/.exec(url.pathname);
    if (commit) {
      if (request.headers.accept !== "application/vnd.github.sha")
        return void response.writeHead(400).end();
      const ref = decodeURIComponent(commit[1] as string);
      if (ref !== "v1.0.0" && ref !== "HEAD") return void response.writeHead(422).end("{}");
      return void response.writeHead(200).end(SHA);
    }
    // GitHub's raw files, at a commit only.
    const raw = /^\/raw\/acme\/ui\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
    if (raw && raw[1] === SHA) {
      const text = repo[decodeURIComponent(raw[2] as string)];
      if (text === undefined) return void response.writeHead(404).end();
      return void response.writeHead(200).end(text);
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done) => web.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});
afterEach(async () => {
  for (const target of running.splice(0)) {
    await target.client.call("mostra/shutdown", {});
    await target.daemon.exited;
  }
});
afterAll(async () => {
  await npm.close();
  await new Promise((done) => web.close(done));
});

async function start(env: Record<string, string> = {}): Promise<Running> {
  const home = testHome();
  const user = tempDir("packs-user");
  const daemon = await startDaemon(home, {
    env: {
      ...home.env,
      HOME: user,
      ...(WINDOWS ? { USERPROFILE: user } : {}),
      npm_config_registry: npm.url,
      REGISTRY_URL: `${base}/r`,
      MOSTRA_TEST_GITHUB_API: `${base}/api`,
      MOSTRA_TEST_GITHUB_RAW: `${base}/raw`,
      ACME_TOKEN: "s3cret",
      ...env,
    },
  });
  const client = await connectTo(daemon.status.socket as string);
  expect((await client.call("mostra/initialize", initializeParams())).error).toBeUndefined();
  const started = { home, daemon, client };
  running.push(started);
  return started;
}

function artifact(files: Record<string, string> = {}): string {
  const dir = join(tempDir("packs-artifact"), "artifact");
  const all = {
    "index.tsx": "export default function Page() { return <p>Hello</p>; }\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

const ok = <T>(message: Message): T => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result as T;
};
const code = (message: Message): string | undefined => message.error?.data.code;

interface PackResult {
  readonly items: readonly { name: string; type: string; requiredBy?: string }[];
  readonly files: readonly { path: string; action: string }[];
  readonly packages: readonly { name: string; warm: boolean }[];
  readonly licenses: readonly { id: string; acknowledgment: string }[];
  readonly notes: readonly { code: string; message: string }[];
}

/** An item's file content as the fixture holds it. */
const itemFile = (name: string, index = 0): string =>
  (
    JSON.parse(readFileSync(join(SHADCN, "styles", "new-york-v4", `${name}.json`), "utf8")) as {
      files: { content: string }[];
    }
  ).files[index]?.content as string;

describe("shadcn's own items, unchanged (EX-03)", () => {
  it("installs a block with its registry dependencies as shadcn would, and the artifact builds with it", async () => {
    const target = await start();
    const dir = artifact();
    const result = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: dir },
        specs: [`${base}/r/styles/new-york-v4/login-01.json`],
      }),
    );
    // Dependencies first, each once: login-01 needs button, card, input, label and field, and field
    // needs label and separator.
    expect(result.items.map((item) => item.name)).toEqual([
      "button",
      "card",
      "input",
      "label",
      "separator",
      "field",
      "login-01",
    ]);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      "components/login-form.tsx",
      "components/ui/button.tsx",
      "components/ui/card.tsx",
      "components/ui/field.tsx",
      "components/ui/input.tsx",
      "components/ui/label.tsx",
      "components/ui/separator.tsx",
    ]);
    // Byte for byte what shadcn 4.23.0's own `shadcn add` wrote for the same block into a project
    // with these aliases and `rsc: true` (`fixtures/shadcn/expected`, VERIFIED_FACTS, WP-16).
    for (const file of result.files) {
      expect(readFileSync(join(dir, file.path), "utf8"), file.path).toBe(
        readFileSync(join(SHADCN, "expected", "login-01", file.path), "utf8"),
      );
    }
    // The block's page has no place in an artifact without pages/: said, not written.
    expect(result.notes.map((note) => note.code)).toContain("MOSTRA_PACK_NOT_APPLIED");
    expect(existsSync(join(dir, "app"))).toBe(false);
    // Its packages are the warm set's.
    expect(result.packages.every((pkg) => pkg.warm)).toBe(true);

    // The artifact uses it, and publishes: the files build as they are (the button's
    // class-variance-authority installs on demand from the local registry).
    writeFileSync(
      join(dir, "index.tsx"),
      'import { LoginForm } from "@/components/login-form";\nexport default function Page() { return <LoginForm />; }\n',
    );
    const receipt = ok<{ versionId: string }>(
      await target.client.call("artifact/publish", { source: { path: dir } }),
    );
    const lock = readFileSync(
      join(target.home.home, "versions", receipt.versionId, "lock.yaml"),
      "utf8",
    );
    expect(lock).toContain("class-variance-authority");
  });

  it("leaves identical files alone, refuses to replace changed ones, and replaces them with overwrite", async () => {
    const target = await start();
    const dir = artifact();
    const spec = `${base}/r/styles/new-york-v4/card.json`;
    ok(await target.client.call("pack/add", { artifact: { path: dir }, specs: [spec] }));
    const again = ok<PackResult>(
      await target.client.call("pack/add", { artifact: { path: dir }, specs: [spec] }),
    );
    expect(again.files).toEqual([{ path: "components/ui/card.tsx", action: "unchanged" }]);
    writeFileSync(join(dir, "components/ui/card.tsx"), "// mine\n");
    const refused = await target.client.call("pack/add", {
      artifact: { path: dir },
      specs: [spec],
    });
    expect(code(refused)).toBe("MOSTRA_PACK_FILE_EXISTS");
    expect(refused.error?.data.fix?.command).toContain("--overwrite");
    expect(readFileSync(join(dir, "components/ui/card.tsx"), "utf8")).toBe("// mine\n");
    const replaced = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: dir },
        specs: [spec],
        overwrite: true,
      }),
    );
    expect(replaced.files).toEqual([{ path: "components/ui/card.tsx", action: "overwritten" }]);
    expect(readFileSync(join(dir, "components/ui/card.tsx"), "utf8")).toBe(itemFile("card"));
  });

  it("reads a namespace the artifact's components.json registers, with its headers", async () => {
    const target = await start();
    const dir = artifact({
      "components.json": JSON.stringify({
        aliases: { ui: "@/ui" },
        registries: {
          "@acme": {
            url: `${base}/acme/{name}.json`,
            headers: { "x-token": ACME_TOKEN_REFERENCE },
          },
        },
      }),
    });
    const result = ok<PackResult>(
      await target.client.call("pack/add", { artifact: { path: dir }, specs: ["@acme/input"] }),
    );
    expect(result.files).toEqual([{ path: "ui/input.tsx", action: "created" }]);
    // Where components.json registers no `@mostra`, `@mostra/…` is the scoped npm package it
    // looks like, as `mostra add @tanstack/react-table` always was.
    const npm = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: artifact() },
        specs: ["@mostra/react"],
      }),
    );
    expect(npm.items).toEqual([]);
    expect(npm.packages).toMatchObject([{ name: "@mostra/react", warm: true }]);
  });
});

describe("GitHub registries and Mostra's own packs", () => {
  it("installs from a repository's registry at the commit its ref names, with the item's CSS", async () => {
    const target = await start();
    const dir = artifact();
    const result = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: dir },
        specs: ["acme/ui/badge-row#v1.0.0"],
      }),
    );
    expect(result.items.map((item) => item.name)).toEqual(["card", "badge-row"]);
    expect(readFileSync(join(dir, "components/badge-row.tsx"), "utf8")).toContain(
      'from "@/components/ui/card"',
    );
    const css = readFileSync(join(dir, "styles.css"), "utf8");
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("--color-badge: oklch(0.7 0.1 140);");
    expect(css).toContain("/* mostra add badge-row: begin */");
    // The entry doesn't import the stylesheet yet: said.
    expect(result.notes.map((note) => note.code)).toContain("MOSTRA_PACK_CSS_UNIMPORTED");
    expect(requests).toContain(`/raw/acme/ui/${SHA}/items/badge-row.tsx`);
    const missing = await target.client.call("pack/add", {
      artifact: { path: dir },
      specs: ["acme/ui/badge-row#nope"],
    });
    expect(code(missing)).toBe("MOSTRA_PACK_ITEM_NOT_FOUND");
  });

  it("installs a pack an installed plugin carries", async () => {
    const target = await start();
    const dir = artifact({
      "index.tsx": 'import "./styles.css";\nexport default function Page() { return <p />; }\n',
    });
    ok(
      await target.client.call("plugin/add", {
        artifact: { path: dir },
        packages: ["mostra-fixture-pack@1.0.0"],
      }),
    );
    const result = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: dir },
        specs: ["plugin:mostra-fixture-pack/greeting"],
      }),
    );
    expect(result.files.map((file) => file.path)).toEqual([
      "components/greeting.tsx",
      "styles.css",
    ]);
    expect(result.notes.map((note) => note.code)).not.toContain("MOSTRA_PACK_CSS_UNIMPORTED");
  });
});

describe("what an install refuses before it writes anything", () => {
  it("refuses a file that would land outside the artifact", async () => {
    const target = await start();
    const dir = artifact();
    const refused = await target.client.call("pack/add", {
      artifact: { path: dir },
      specs: ["acme/ui/escape"],
    });
    expect(code(refused)).toBe("MOSTRA_PACK_TARGET_INVALID");
    expect(existsSync(join(dir, "..", "outside.tsx"))).toBe(false);
  });

  it("asks for a license an item's package brings, and records the acknowledgment (D31)", async () => {
    const target = await start();
    const dir = artifact();
    const refused = await target.client.call("pack/add", {
      artifact: { path: dir },
      specs: ["acme/ui/engine-panel"],
    });
    expect(code(refused)).toBe("MOSTRA_LICENSE_UNACCEPTED");
    const id = /--accept-license (\S+)/.exec(refused.error?.data.fix?.command ?? "")?.[1] as string;
    expect(id).toBe("LicenseRef-npm-fixture-engine");
    expect(existsSync(join(dir, "components/engine-panel.tsx"))).toBe(false);
    const accepted = ok<PackResult>(
      await target.client.call("pack/add", {
        artifact: { path: dir },
        specs: ["acme/ui/engine-panel"],
        acceptLicenses: [id],
      }),
    );
    expect(accepted.licenses).toContainEqual(
      expect.objectContaining({ id, acknowledgment: "accepted" }),
    );
    expect(existsSync(join(dir, "components/engine-panel.tsx"))).toBe(true);
  });

  it("says it is offline at once, with nothing written", async () => {
    const target = await start({ MOSTRA_OFFLINE: "1" });
    const dir = artifact();
    const refused = await target.client.call("pack/add", {
      artifact: { path: dir },
      specs: [`${base}/r/styles/new-york-v4/card.json`],
    });
    expect(code(refused)).toBe("MOSTRA_PACK_OFFLINE");
    expect(existsSync(join(dir, "components"))).toBe(false);
  });

  it("refuses an address that isn't https, and an item that isn't one", async () => {
    const target = await start();
    expect(
      code(
        await target.client.call("pack/add", {
          artifact: { path: artifact() },
          specs: ["http://example.com/x.json"],
        }),
      ),
    ).toBe("MOSTRA_PACK_ADDRESS_INVALID");
    const bad = join(tempDir("packs-item"), "bad.json");
    // No name, and files that aren't a list.
    writeFileSync(bad, JSON.stringify({ type: "registry:ui", files: "button.tsx" }));
    expect(
      code(await target.client.call("pack/add", { artifact: { path: artifact() }, specs: [bad] })),
    ).toBe("MOSTRA_PACK_ITEM_INVALID");
  });
});
