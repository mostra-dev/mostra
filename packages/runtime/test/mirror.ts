/**
 * A local npm registry that serves packages as this workspace has them installed (WP-19): the
 * closure of some packages, read from pnpm's store beside the kit, so a suite installs the kit's
 * on-demand libraries (MapLibre, three.js, Excalidraw …) through Mostra's real install child with no
 * network (STANDARDS: real side effects go to local fakes). Each package is packed the first time
 * its packument is asked for, once, at the version installed here, which is the kit's pin.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";

/** A running mirror. */
export interface Mirror {
  /** Its URL, with a trailing slash, for `npm_config_registry`. */
  readonly url: string;
  /** The packages it serves, `name@version`. */
  readonly packages: readonly string[];
  /** Every request path it received, in order. */
  readonly requests: string[];
  close(): Promise<void>;
}

interface Found {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
}

/** Writes `value` as a NUL-terminated octal field of `size` bytes at `offset`. */
function octal(header: Buffer, offset: number, size: number, value: number): void {
  header.write(`${value.toString(8).padStart(size - 1, "0")}\0`, offset, size, "ascii");
}

/** A ustar header for `path` (split into prefix and name when longer than 100 bytes). */
function header(path: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) {
      throw new Error(`${path} is too long for a ustar archive`);
    }
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  block.write(name, 0, 100, "utf8");
  octal(block, 100, 8, 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, size);
  octal(block, 136, 12, 0);
  block.write("        ", 148, 8, "ascii");
  block.write("0", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

/** The package directory `dir` as an npm tarball: every file under `package/`, no `node_modules`. */
function pack(dir: string): Buffer {
  const blocks: Buffer[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() ||
        (entry.isSymbolicLink() && lstatSync(realpathSync(path)).isFile())
      ) {
        const data = readFileSync(path);
        const inside = relative(dir, path).split("\\").join("/");
        blocks.push(
          header(`package/${inside}`, data.length),
          data,
          Buffer.alloc((512 - (data.length % 512)) % 512),
        );
      }
    }
  };
  walk(dir);
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 1 });
}

/** Where pnpm put package `name` for the package installed at `dir`: beside it in its store entry. */
function besideIn(dir: string, name: string): string | undefined {
  // `<store>/<entry>/node_modules/<name of dir>`: its dependencies are the entry's other folders.
  const own = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string })
    .name;
  const modules = own.startsWith("@") ? dirname(dirname(dir)) : dirname(dir);
  for (const candidate of [join(modules, name), join(dir, "node_modules", name)]) {
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  return undefined;
}

/**
 * The installed closure of `roots` (package names, found from `from`, a package directory whose
 * `node_modules` has them): every dependency, optional dependency and peer that is installed, by
 * the copy pnpm resolved for its dependent. `skip` names packages the artifact has anyway (the
 * warm set), whose closures aren't followed.
 */
export function installedClosure(
  from: string,
  roots: readonly string[],
  skip: (name: string) => boolean = () => false,
): Found[] {
  const found = new Map<string, Found>();
  const visit = (dir: string): void => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    > & { name: string; version: string };
    const key = `${manifest.name}@${manifest.version}`;
    if (found.has(key)) return;
    found.set(key, { name: manifest.name, version: manifest.version, dir, manifest });
    const names = new Set<string>();
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      for (const name of Object.keys((manifest[field] as Record<string, string>) ?? {})) {
        names.add(name);
      }
    }
    for (const name of names) {
      if (skip(name)) continue;
      const at = besideIn(dir, name);
      if (at !== undefined) visit(at);
    }
  };
  for (const root of roots) {
    const at = join(from, "node_modules", root);
    if (!existsSync(join(at, "package.json")))
      throw new Error(`${root} isn't installed at ${from}`);
    visit(realpathSync(at));
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Starts a mirror serving `packages`; each is packed when its packument is first asked for. */
export async function startMirror(packages: readonly Found[]): Promise<Mirror> {
  const byName = new Map<string, Found[]>();
  for (const found of packages) {
    byName.set(found.name, [...(byName.get(found.name) ?? []), found]);
  }
  const packed = new Map<string, Buffer>();
  const tgz = (found: Found): Buffer => {
    const key = `${found.name}@${found.version}`;
    let bytes = packed.get(key);
    if (bytes === undefined) {
      bytes = pack(found.dir);
      packed.set(key, bytes);
    }
    return bytes;
  };
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/").slice(1);
    requests.push(path);
    try {
      const marker = path.lastIndexOf("/-/");
      if (marker !== -1 && path.endsWith(".tgz")) {
        const name = path.slice(0, marker);
        const stem = path.slice(marker + 3, -".tgz".length);
        const base = `${name.split("/").pop()}-`;
        const version = stem.startsWith(base) ? stem.slice(base.length) : "";
        const found = byName.get(name)?.find((entry) => entry.version === version);
        if (found) {
          response.writeHead(200, { "content-type": "application/octet-stream" });
          response.end(tgz(found));
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
        const bytes = tgz(entry);
        const { devDependencies: _dev, ...manifest } = entry.manifest;
        versions[entry.version] = {
          ...manifest,
          dist: {
            tarball: `${host}/${path}/-/${path.split("/").pop()}-${entry.version}.tgz`,
            integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
            shasum: createHash("sha1").update(bytes).digest("hex"),
          },
        };
        // Older than every release age: these are the versions this workspace already vetted.
        time[entry.version] = "2026-01-01T00:00:00.000Z";
      }
      const latest = list.at(-1)?.version;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ name: path, "dist-tags": { latest }, versions, time }));
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    packages: packages.map((found) => `${found.name}@${found.version}`),
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
