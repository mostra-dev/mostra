/**
 * A local npm registry for tests (STANDARDS: real side effects go to local fakes). It serves
 * packuments and tarballs for the packages it is given, records every request, and can stop
 * answering, so installs, offline behavior and lifecycle scripts are tested against a real pnpm
 * without the network.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";

/** A package the registry serves. */
export interface FixturePackage {
  readonly name: string;
  readonly version: string;
  /** Files besides `package.json`, by path inside the package. */
  readonly files?: Readonly<Record<string, string>>;
  /** Extra `package.json` fields: `dependencies`, `peerDependencies`, `scripts`, `type`, `main` … */
  readonly manifest?: Readonly<Record<string, unknown>>;
  /** The publish time; default 2026-01-01, well past the one-day release age (D95). */
  readonly time?: string;
}

/** A running registry. */
export interface FakeRegistry {
  /** Its URL, with a trailing slash, for `npm_config_registry`. */
  readonly url: string;
  /** Every request path it received, in order. */
  readonly requests: string[];
  close(): Promise<void>;
}

/** A ustar archive of `files` under `package/`, gzipped: what npm tarballs are. */
function tarball(files: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** Starts a registry serving `packages` on a loopback port. */
export async function startRegistry(packages: readonly FixturePackage[]): Promise<FakeRegistry> {
  const byName = new Map<
    string,
    { version: string; manifest: Record<string, unknown>; tgz: Buffer; time: string }[]
  >();
  for (const fixture of packages) {
    const manifest = { name: fixture.name, version: fixture.version, ...fixture.manifest };
    const tgz = tarball({ "package.json": JSON.stringify(manifest, null, 2), ...fixture.files });
    const list = byName.get(fixture.name) ?? [];
    list.push({
      version: fixture.version,
      manifest,
      tgz,
      time: fixture.time ?? "2026-01-01T00:00:00.000Z",
    });
    byName.set(fixture.name, list);
  }
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/").slice(1);
    requests.push(path);
    // Tarballs live at `<name>/-/<basename>-<version>.tgz`; parsed without a backtracking regex.
    const marker = path.lastIndexOf("/-/");
    const tarballFile = marker === -1 ? "" : path.slice(marker + 3);
    if (marker !== -1 && tarballFile.endsWith(".tgz")) {
      const name = path.slice(0, marker);
      const stem = tarballFile.slice(0, -".tgz".length);
      const base = `${name.split("/").pop()}-`;
      const version = stem.startsWith(base) ? stem.slice(base.length) : "";
      const found = byName.get(name)?.find((entry) => entry.version === version);
      if (found) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(found.tgz);
        return;
      }
    }
    const list = byName.get(path);
    if (!list) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"Not found"}');
      return;
    }
    const host = `http://${request.headers.host}`;
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = {};
    for (const entry of list) {
      versions[entry.version] = {
        ...entry.manifest,
        dist: {
          tarball: `${host}/${path}/-/${path.split("/").pop()}-${entry.version}.tgz`,
          integrity: `sha512-${createHash("sha512").update(entry.tgz).digest("base64")}`,
          shasum: createHash("sha1").update(entry.tgz).digest("hex"),
        },
      };
      time[entry.version] = entry.time;
    }
    const latest = [...list].sort((a, b) => (a.time < b.time ? -1 : 1)).at(-1)?.version;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ name: path, "dist-tags": { latest }, versions, time }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * The packages the dependency tests install. `mostra-fixture-peer` peer-depends on React and
 * renders with hooks from its own `react` import, so a second React would break it (DP-01).
 * `mostra-fixture-postinstall` records the process its lifecycle script runs in (DP-05).
 */
export const FIXTURE_PACKAGES: readonly FixturePackage[] = [
  ...["1.0.0", "1.1.0"].map(
    (version): FixturePackage => ({
      name: "mostra-fixture-peer",
      version,
      manifest: {
        type: "module",
        main: "index.js",
        peerDependencies: { react: "^19" },
        dependencies: { "mostra-fixture-util": "^1.0.0" },
      },
      files: {
        "index.js": [
          'import * as React from "react";',
          'import { label } from "mostra-fixture-util";',
          "export const ReactFromPeer = React;",
          `export const peerVersion = ${JSON.stringify(version)};`,
          "export function Counter() {",
          "  const [count, setCount] = React.useState(0);",
          '  return React.createElement("button", { id: "counter", onClick: () => setCount(count + 1) }, label + ": " + count);',
          "}",
          "",
        ].join("\n"),
      },
    }),
  ),
  {
    name: "mostra-fixture-util",
    version: "1.0.0",
    manifest: { type: "module", main: "index.js" },
    files: { "index.js": 'export const label = "clicks";\n' },
  },
  {
    name: "mostra-fixture-postinstall",
    version: "1.0.0",
    manifest: { main: "index.js", scripts: { postinstall: "node record.cjs" } },
    files: {
      "index.js": "module.exports = { installed: true };\n",
      // Records the script's own process and its ancestors (PID, command, working directory),
      // read while they still run, and its environment.
      "record.cjs": [
        'const { execFileSync } = require("node:child_process");',
        'const { writeFileSync, readlinkSync } = require("node:fs");',
        'const { join } = require("node:path");',
        "const ancestors = [];",
        "let pid = process.ppid;",
        "while (pid > 1 && ancestors.length < 8) {",
        '  const line = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], { encoding: "utf8" }).trim();',
        "  const [parent, ...command] = line.split(/\\s+/);",
        "  let cwd = null;",
        '  try { cwd = process.platform === "linux" ? readlinkSync("/proc/" + pid + "/cwd") : execFileSync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], { encoding: "utf8" }).split("\\n").find((l) => l.startsWith("n")).slice(1); } catch {}',
        '  ancestors.push({ pid, command: command.join(" "), cwd });',
        "  pid = Number(parent);",
        "}",
        'writeFileSync(join(__dirname, "record.json"), JSON.stringify({ pid: process.pid, cwd: process.cwd(), env: process.env, ancestors }, null, 1));',
        "",
      ].join("\n"),
    },
  },
  {
    name: "mostra-fixture-failing",
    version: "1.0.0",
    manifest: {
      main: "index.js",
      scripts: {
        postinstall: "node -e \"console.error('FIXTURE_SCRIPT_FAILED'); process.exit(3)\"",
      },
    },
    files: { "index.js": "module.exports = 1;\n" },
  },
  {
    name: "mostra-fixture-slow",
    version: "1.0.0",
    manifest: {
      main: "index.js",
      // Records its PID where the install runs (INIT_CWD, the lock layout), then never ends.
      scripts: { postinstall: "node wait.cjs" },
    },
    files: {
      "index.js": "module.exports = 1;\n",
      "wait.cjs":
        'require("node:fs").writeFileSync(require("node:path").join(process.env.INIT_CWD, "slow.pid"), String(process.pid));\nsetTimeout(() => {}, 600000);\n',
    },
  },
  {
    name: "mostra-fixture-fresh",
    version: "1.0.0",
    time: new Date().toISOString(),
    manifest: { type: "module", main: "index.js" },
    files: { "index.js": 'export const fresh = "FRESH";\n' },
  },
  {
    name: "leftpad-x",
    version: "1.0.0",
    manifest: { type: "module", main: "index.js" },
    files: { "index.js": 'export const marker = "REGISTRY_PACKAGE";\n' },
  },
  {
    // Imports leftpad-x without declaring it: a phantom dependency, found only by walking up.
    name: "mostra-fixture-phantom",
    version: "1.0.0",
    manifest: { type: "module", main: "index.js" },
    files: { "index.js": 'export { marker } from "leftpad-x";\n' },
  },
];
