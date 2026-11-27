/**
 * `kitPeersPlugin` (WP-19, D185 item 3): a kit file's import of one of the kit's on-demand
 * libraries resolves as the artifact's own root would import it, from the layout its lockfile
 * installed, never from wherever the kit itself sits (in this workspace the kit has its own copies
 * as dev dependencies; in the runtime bundle it has none), and never from a `node_modules` above
 * the home, which no digest covers (Opus review of WP-19, finding 1).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { kitPeersPlugin } from "../../src/builder/child/kit.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "mostra-kit-peers-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const kitDir = join(root, "kit");
const buildRoot = join(root, "build");
const kitFile = join(kitDir, "registry", "base", "components", "mostra", "map.tsx");
const ownFile = join(buildRoot, "source", "index.tsx");
/** The artifact's lockfile layout: the build's packages. */
const layout = join(root, "layout");
const inLayout = join(layout, "maplibre-gl", "index.js");
/** A `node_modules` above the home, which no digest covers. */
const above = join(root, "node_modules", "maplibre-gl", "index.js");
for (const file of [kitFile, ownFile, inLayout, above])
  mkdirSync(join(file, ".."), { recursive: true });
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
writeFileSync(inLayout, "export {};\n");
writeFileSync(above, "export {};\n");
symlinkSync(kitDir, join(buildRoot, "node_modules", "@mostra", "kit"), "junction");

/**
 * Calls the plugin's `resolveId` with a bundler whose own resolution finds `found` (or nothing),
 * recording who it was asked for.
 */
async function resolve(
  source: string,
  importer: string,
  found: string | null = inLayout,
): Promise<{ result: unknown; askedFrom: string[] }> {
  const plugin = kitPeersPlugin(buildRoot, [layout]);
  const hook = plugin.resolveId as (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: object,
  ) => Promise<unknown>;
  const askedFrom: string[] = [];
  const result = await hook.call(
    {
      resolve: async (_what: string, from: string) => {
        askedFrom.push(from);
        return found === null ? null : { id: found };
      },
      error: (message: string) => {
        throw new Error(message);
      },
    },
    source,
    importer,
    {},
  );
  return { result, askedFrom };
}

describe("a kit file's on-demand library (KT-01)", () => {
  it("resolves from the artifact's own root, whatever the kit has beside it", async () => {
    const plain = await resolve("maplibre-gl", kitFile);
    expect(plain.result).toEqual({ id: inLayout });
    expect(plain.askedFrom).toEqual([join(buildRoot, "index.html")]);
    const css = await resolve("maplibre-gl/dist/maplibre-gl.css", kitFile);
    expect(css.askedFrom).toEqual([join(buildRoot, "index.html")]);
  });

  it("refuses a copy found outside the build's packages, or none at all, naming the kit's pin (Opus review of WP-19, finding 1)", async () => {
    await expect(resolve("maplibre-gl", kitFile, above)).rejects.toThrow(
      /maplibre-gl isn't in the artifact's lockfile.*mostra add maplibre-gl@6\.19\.0/,
    );
    await expect(resolve("maplibre-gl", kitFile, null)).rejects.toThrow(
      /Could not resolve "maplibre-gl" from the kit's registry\/base\/components\/mostra\/map\.tsx/,
    );
  });

  it("leaves every other import to the build: the artifact's own, and a package the kit doesn't name", async () => {
    expect((await resolve("maplibre-gl", ownFile)).result).toBeNull();
    expect((await resolve("react", kitFile)).result).toBeNull();
    expect((await resolve("./tokens", kitFile)).result).toBeNull();
  });
});
