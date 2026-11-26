/**
 * The kit's on-demand libraries (WP-19, D65, M105): a page that imports `@mostra/kit/map`,
 * `/scene` or `/whiteboard` gets MapLibre and deck.gl, three.js and react-three-fiber, or Excalidraw
 * installed with it, at exactly the versions the kit pins, through Mostra's real install child
 * against a local mirror of this workspace's copies (no network); its type check reads those
 * libraries' own types; the map's worker and the whiteboard's fonts are served from the page's own
 * origin; and the editor's and the whiteboard's fields are in the version's coverage.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VerifyVerdict } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kitPeers } from "../../src/builder/index.ts";
import { parseLock } from "../../src/deps/index.ts";
import { installedClosure, type Mirror, startMirror } from "../mirror.ts";
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
  verifiedHome,
} from "../support.ts";

const KIT = fileURLToPath(new URL("../../../kit/", import.meta.url));
const VERIFY_MS = 420_000;

let mirror: Mirror;
let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

function artifact(name: string, files: Record<string, string>): string {
  const dir = join(tempDir(`kitlib-${name}`), name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

async function verify(path: string): Promise<VerifyVerdict> {
  const message = await client.call("artifact/verify", { source: { path } }, VERIFY_MS);
  return VerifyVerdict.parse(result(message));
}

async function publish(path: string): Promise<{ versionId: string }> {
  return result(await client.call("artifact/publish", { source: { path } }, VERIFY_MS)) as {
    versionId: string;
  };
}

/** The exact versions a version's lockfile pins, by package. */
function pinned(versionId: string): Readonly<Record<string, string>> {
  return parseLock(readFileSync(join(home.home, "versions", versionId, "lock.yaml"), "utf8"))
    .packages;
}

/** Every file of a version's client build, relative to `client/`. */
function clientFiles(versionId: string): string[] {
  const root = join(home.home, "versions", versionId, "client");
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(root, "");
  return out;
}

const errors = (verdict: VerifyVerdict): string[] =>
  verdict.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

const PINS = kitPeers(KIT);

beforeAll(async () => {
  // Every pinned library the kit installs for its own tests (deck.gl's other layers are pinned
  // without being installed, so a page that adds one gets the version its map needs).
  const installed = [...PINS.keys()].filter((name) =>
    existsSync(join(KIT, "node_modules", name, "package.json")),
  );
  mirror = await startMirror(installedClosure(KIT, installed));
  home = verifiedHome();
  // The registry is the mirror's (the variable wins over any user's `.npmrc`); the user's home
  // stays, since verify's browser is found there.
  daemon = await startDaemon(home, { env: { ...home.env, npm_config_registry: mirror.url } });
  client = await connectTo(daemon.status.socket as string);
  result(await client.call("mostra/initialize", initializeParams()));
}, 120_000);

afterAll(async () => {
  await client?.call("mostra/shutdown", {});
  await daemon?.exited;
  await mirror?.close();
});

describe("the kit's on-demand libraries (WP-19, D65)", () => {
  it("installs three.js, react-three-fiber and drei at the kit's pins for a scene, whose elements are typed", async () => {
    const dir = artifact("scene", {
      "index.tsx": `import { Scene, useTokens } from "@mostra/kit/scene";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "A knot" });

function Knot() {
  const tokens = useTokens();
  return (
    <mesh rotation={[0.4, 0.2, 0]}>
      <torusKnotGeometry args={[0.8, 0.25, 96, 12]} />
      <meshStandardMaterial color={tokens.chart[0]} />
    </mesh>
  );
}

export default function Page() {
  return (
    <main>
      <h1>A knot</h1>
      <Scene title="The knot">
        <Knot />
      </Scene>
    </main>
  );
}
`,
    });
    const verdict = await verify(dir);
    // A three.js element the page draws is checked against react-three-fiber's own JSX types:
    // without them, <mesh> would be no intrinsic element at all (TS2339).
    expect(errors(verdict)).toEqual([]);
    expect(verdict.status).toBe("pass");
    const { versionId } = await publish(dir);
    const pins = pinned(versionId);
    for (const name of ["three", "@react-three/fiber", "@react-three/drei"]) {
      expect(pins[name], name).toBe(PINS.get(name));
    }
  }, 900_000);

  it("installs MapLibre and every deck.gl package at one pinned version, and serves the map's worker itself", async () => {
    const dir = artifact("map", {
      "index.tsx": `import { MapView } from "@mostra/kit/map";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Offices" });

export default function Page() {
  return (
    <main>
      <h1>Offices</h1>
      <MapView title="Offices" center={[8, 48]} zoom={3} markers={[{ position: [13.4, 52.5], label: "Berlin" }]} />
    </main>
  );
}
`,
    });
    const verdict = await verify(dir);
    expect(errors(verdict)).toEqual([]);
    // No tile server: the world outline is the kit's, so nothing is asked of another origin.
    expect(
      verdict.diagnostics.filter((d) => d.code.startsWith("MOSTRA_NETWORK")).map((d) => d.message),
    ).toEqual([]);
    const { versionId } = await publish(dir);
    const pins = pinned(versionId);
    expect(pins["maplibre-gl"]).toBe(PINS.get("maplibre-gl"));
    for (const name of ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/mapbox"]) {
      expect(pins[name], name).toBe(PINS.get(name));
    }
    expect(clientFiles(versionId).some((file) => /maplibre-gl-worker.*\.m?js$/.test(file))).toBe(
      true,
    );
  }, 900_000);

  it("serves Excalidraw's fonts from the page's origin, but the CJK face, and saves the drawing as a field", async () => {
    const dir = artifact("whiteboard", {
      "index.tsx": `import { Whiteboard } from "@mostra/kit/whiteboard";
import { defineArtifact } from "@mostra/react";

export const artifact = defineArtifact({ title: "Sketch" });

export default function Page() {
  return (
    <main>
      <h1>Sketch</h1>
      <Whiteboard id="sketch" label="Sketch the layout" height={320} />
    </main>
  );
}
`,
    });
    const verdict = await verify(dir);
    expect(errors(verdict)).toEqual([]);
    const { versionId } = await publish(dir);
    expect(pinned(versionId)["@excalidraw/excalidraw"]).toBe(PINS.get("@excalidraw/excalidraw"));
    const fonts = clientFiles(versionId).filter((file) =>
      file.startsWith("kit-assets/excalidraw/fonts/"),
    );
    expect(fonts.some((file) => file.includes("/Excalifont/"))).toBe(true);
    expect(fonts.some((file) => file.includes("/Xiaolai/"))).toBe(false);
    const registry = JSON.parse(
      readFileSync(join(home.home, "versions", versionId, "registry.json"), "utf8"),
    ) as { fields: { open: boolean; entries: { id?: string; label?: string }[] } };
    expect(registry.fields.open).toBe(false);
    expect(registry.fields.entries).toContainEqual(
      expect.objectContaining({ id: "sketch", label: "Sketch the layout" }),
    );
  }, 900_000);

  it("pins a kit library an artifact imports itself to the kit's version", async () => {
    const dir = artifact("own-three", {
      "index.tsx": `import { defineArtifact } from "@mostra/react";
import { Color } from "three";

export const artifact = defineArtifact({ title: "A colour" });

export default function Page() {
  return (
    <main>
      <h1>A colour</h1>
      <p>{new Color("#ff0000").getHexString()}</p>
    </main>
  );
}
`,
    });
    const { versionId } = await publish(dir);
    expect(pinned(versionId)["three"]).toBe(PINS.get("three"));
    expect(existsSync(join(home.home, "versions", versionId, "client", "index.html"))).toBe(true);
  }, 900_000);
});
