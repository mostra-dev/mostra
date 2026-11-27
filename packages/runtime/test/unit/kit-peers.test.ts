/**
 * `kitPeersPlugin` (WP-19, D185 item 3): a kit file's import of one of the kit's on-demand
 * libraries resolves as the artifact's own root would import it, from the layout its lockfile
 * installed, never from wherever the kit itself sits (in this workspace the kit has its own copies
 * as dev dependencies; in the runtime bundle it has none).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { kitPeersPlugin } from "../../src/builder/child/kit.ts";

const root = mkdtempSync(join(tmpdir(), "mostra-kit-peers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const kitDir = join(root, "kit");
const buildRoot = join(root, "build");
const kitFile = join(kitDir, "registry", "base", "components", "mostra", "map.tsx");
const ownFile = join(buildRoot, "source", "index.tsx");
mkdirSync(join(kitFile, ".."), { recursive: true });
mkdirSync(join(ownFile, ".."), { recursive: true });
mkdirSync(join(buildRoot, "node_modules", "@mostra"), { recursive: true });
writeFileSync(
  join(kitDir, "package.json"),
  JSON.stringify({
    name: "@mostra/kit",
    peerDependencies: { "maplibre-gl": "6.19.0" },
    peerDependenciesMeta: { "maplibre-gl": { optional: true } },
  }),
);
writeFileSync(kitFile, 'import "maplibre-gl";\n');
writeFileSync(ownFile, 'import "maplibre-gl";\n');
symlinkSync(kitDir, join(buildRoot, "node_modules", "@mostra", "kit"), "junction");

/** Calls the plugin's `resolveId` with a bundler whose own resolution names who asked. */
async function resolve(source: string, importer: string): Promise<unknown> {
  const plugin = kitPeersPlugin(buildRoot);
  const hook = plugin.resolveId as (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: object,
  ) => Promise<unknown>;
  return hook.call(
    { resolve: async (what: string, from: string) => ({ id: `${what} from ${from}` }) },
    source,
    importer,
    {},
  );
}

describe("a kit file's on-demand library (KT-01)", () => {
  it("resolves from the artifact's own root, whatever the kit has beside it", async () => {
    expect(await resolve("maplibre-gl", kitFile)).toEqual({
      id: `maplibre-gl from ${join(buildRoot, "index.html")}`,
    });
    expect(await resolve("maplibre-gl/dist/maplibre-gl.css", kitFile)).toEqual({
      id: `maplibre-gl/dist/maplibre-gl.css from ${join(buildRoot, "index.html")}`,
    });
  });

  it("leaves every other import to the build: the artifact's own, and a package the kit doesn't name", async () => {
    expect(await resolve("maplibre-gl", ownFile)).toBeNull();
    expect(await resolve("react", kitFile)).toBeNull();
    expect(await resolve("./tokens", kitFile)).toBeNull();
  });
});
